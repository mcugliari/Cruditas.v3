import { supabaseAdmin } from './config.js';
import { formatearFechaAR, obtenerFechaActualISO } from './utils.js';

let resumenCierreActual = {
  totalesPorMedio: {},
  efectivoSistema: 0,
  totalGeneral: 0,
  cantidadPedidos: 0
};

// -----------------------------------------------------------------------------
// 1. Cargar el resumen de ventas del día y verificar estado del cierre
// -----------------------------------------------------------------------------
export async function cargarResumenVentasDia() {
  const contenedor = document.getElementById('contenedor-resumen-cierre');
  if (!contenedor) return;

  contenedor.innerHTML = `
    <div class="text-center py-3">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Cargando totales del día...
    </div>
  `;
  const fechaISO = obtenerFechaActualISO();
  const fechaTextoAR = formatearFechaAR(fechaISO);

  try {
    const { data: cierreExistente, error: errCierre } = await supabaseAdmin
      .from('TB_TCIERRE_CAJA')
      .select('id, total_general, diferencia_efectivo, observaciones, estado')
      .eq('fecha', fechaISO)
      .eq('estado', 'CERRADO')
      .maybeSingle();

    if (errCierre) throw errCierre;

    if (cierreExistente) {
      contenedor.innerHTML = `
        <div class="alert alert-warning text-center my-2 p-3">
          <h6 class="font-weight-bold mb-1">🔒 La caja de hoy (${fechaTextoAR}) ya se encuentra CERRADA.</h6>
          <p class="small mb-2">
            Total rendido: <strong>$${Number(cierreExistente.total_general).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong> | 
            Dif. Efectivo: <strong>$${Number(cierreExistente.diferencia_efectivo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>
          </p>
          <button type="button" class="btn btn-sm btn-outline-danger font-weight-bold mt-1" id="btn-anular-cierre" data-id="${cierreExistente.id}">
            ⚠️ ANULAR CIERRE Y REABRIR CAJA
          </button>
        </div>
      `;

      alternarCamposFormulario(true);

      document.getElementById('btn-anular-cierre')?.addEventListener('click', async () => {
        if (!confirm('¿Estás seguro de anular el cierre actual? Quedará registrado en el historial como ANULADO y podrás efectuar un nuevo cierre.')) return;
        await anularCierreCaja(cierreExistente.id);
      });

      return;
    }

    alternarCamposFormulario(false);

    const { data: pedidos, error: errPedidos } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('importe_total, id_medio_pago, estado, fecha, TB_BMEDIO_PAGO(nombre)')
      .eq('fecha', fechaISO);

    if (errPedidos) throw errPedidos;

    const totalesPorMedio = {};
    let totalGeneral = 0;
    let efectivoSistema = 0;
    let pedidosActivos = 0;

    (pedidos || []).forEach(p => {
      if (p.estado !== 'COMPLETADO') return;

      pedidosActivos++;
      const idMedio = p.id_medio_pago || 1;
      const nombreMedio = p.TB_BMEDIO_PAGO?.nombre || 'Efectivo';
      const monto = Number(p.importe_total || 0);

      if (!totalesPorMedio[idMedio]) {
        totalesPorMedio[idMedio] = { id: idMedio, nombre: nombreMedio, total: 0, cantidad: 0 };
      }

      totalesPorMedio[idMedio].total += monto;
      totalesPorMedio[idMedio].cantidad += 1;
      totalGeneral += monto;

      if (nombreMedio.toLowerCase().includes('efectivo')) {
        efectivoSistema += monto;
      }
    });

    resumenCierreActual = {
      totalesPorMedio,
      efectivoSistema,
      totalGeneral,
      cantidadPedidos: pedidosActivos
    };

    if (pedidosActivos === 0) {
      contenedor.innerHTML = `
        <div class="alert alert-info text-center mb-0">
          No hay ventas completadas/cobradas para hoy (<strong>${fechaTextoAR}</strong>).
        </div>
      `;
      return;
    }

    // C. Renderizar desglose por medio de pago
    let html = '<div class="list-group mb-2">';
    Object.values(totalesPorMedio).forEach(item => {
      html += `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
          <span><strong>${item.nombre}</strong> (${item.cantidad} ped.)</span>
          <span class="font-weight-bold text-dark">$${item.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
        </div>
      `;
    });

    html += `
        <div class="list-group-item d-flex justify-content-between align-items-center bg-light py-2">
          <span class="h6 mb-0 text-uppercase">TOTAL SISTEMA:</span>
          <span class="h6 mb-0 text-success font-weight-bold">$${totalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    `;

    contenedor.innerHTML = html;

    const inputEf = document.getElementById('input-efectivo-real');
    if (inputEf) inputEf.value = '';
    actualizarDiferenciaEfectivo();

  } catch (err) {
    console.error('Error al cargar resumen de caja:', err);
    contenedor.innerHTML = `
      <div class="alert alert-danger mb-0">
        <small><strong>Error al cargar la información:</strong><br>${err.message || err}</small>
      </div>
    `;
  }
}

// -----------------------------------------------------------------------------
// 2. Auxiliares UI y Cálculo de Arqueo
// -----------------------------------------------------------------------------
function alternarCamposFormulario(deshabilitar) {
  const inputEf = document.getElementById('input-efectivo-real');
  const inputObs = document.getElementById('cierre-observaciones');
  const btnConf = document.getElementById('btn-confirmar-cierre');

  if (inputEf) inputEf.disabled = deshabilitar;
  if (inputObs) inputObs.disabled = deshabilitar;
  if (btnConf) btnConf.disabled = deshabilitar;

  const contDif = document.getElementById('contenedor-diferencia-efectivo');
  if (contDif && deshabilitar) contDif.innerHTML = '';
}

function actualizarDiferenciaEfectivo() {
  const inputEf = document.getElementById('input-efectivo-real');
  const contDif = document.getElementById('contenedor-diferencia-efectivo');
  if (!inputEf || !contDif || inputEf.disabled) return;

  const valorRealStr = inputEf.value.trim();
  if (valorRealStr === '') {
    contDif.innerHTML = `<span class="text-muted">Efectivo esperado por sistema: $${resumenCierreActual.efectivoSistema.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>`;
    return;
  }

  const efectivoReal = Number(valorRealStr) || 0;
  const dif = efectivoReal - resumenCierreActual.efectivoSistema;

  if (dif === 0) {
    contDif.innerHTML = `<span class="text-success">✔ Caja conforme (sin diferencia).</span>`;
  } else if (dif > 0) {
    contDif.innerHTML = `<span class="text-info">ℹ Sobrante de efectivo: +$${dif.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>`;
  } else {
    contDif.innerHTML = `<span class="text-danger">⚠️ Faltante de efectivo: -$${Math.abs(dif).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>`;
  }
}

// -----------------------------------------------------------------------------
// 3. Acciones: Anular Cierre y Confirmar Nuevo Cierre
// -----------------------------------------------------------------------------
export async function anularCierreCaja(idCierre) {
  try {
    const { error } = await supabaseAdmin
      .from('TB_TCIERRE_CAJA')
      .update({ estado: 'ANULADO' })
      .eq('id', idCierre);

    if (error) throw error;

    alert('Cierre de caja anulado con éxito. Ya podés realizar el nuevo arqueo.');
    await cargarResumenVentasDia();

  } catch (err) {
    console.error('Error al anular cierre:', err);
    alert('Error al anular el cierre: ' + (err.message || err));
  }
}

export function inicializarCierreCaja() {
  // Disparar carga al abrir el modal
  $('#modalCierreCaja').on('show.bs.modal', function () {
    cargarResumenVentasDia();
  });

  // Evento de entrada en el input de efectivo real
  document.getElementById('input-efectivo-real')?.addEventListener('input', actualizarDiferenciaEfectivo);

  // Confirmar y Guardar
  document.getElementById('btn-confirmar-cierre')?.addEventListener('click', async () => {
    const inputEf = document.getElementById('input-efectivo-real');
    if (!inputEf || inputEf.value.trim() === '') {
      alert('Por favor ingresá la cantidad de efectivo real contado en caja.');
      inputEf.focus();
      return;
    }

    if (!confirm('¿Estás seguro de confirmar y cerrar la caja diaria?')) return;

    const btn = document.getElementById('btn-confirmar-cierre');
    btn.disabled = true;
    btn.innerText = 'Guardando cierre...';

    const hoyObj = new Date();
    const hoy = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;
    const efectivoReal = Number(inputEf.value) || 0;
    const diferencia = efectivoReal - resumenCierreActual.efectivoSistema;
    const obs = document.getElementById('cierre-observaciones')?.value || null;

    try {
      // 1. Insertar Cabecera (TB_TCIERRE_CAJA)
      const { data: cierre, error: errCab } = await supabaseAdmin
        .from('TB_TCIERRE_CAJA')
        .insert([{
          fecha: hoy,
          efectivo_sistema: resumenCierreActual.efectivoSistema,
          efectivo_real: efectivoReal,
          diferencia_efectivo: diferencia,
          total_general: resumenCierreActual.totalGeneral,
          gastos_efectivo: 0, // Campo preparado para módulo de gastos
          gastos_banco: 0,    // Campo preparado para módulo de gastos
          total_gastos: 0,    // Campo preparado para módulo de gastos
          cantidad_pedidos: resumenCierreActual.cantidadPedidos,
          observaciones: obs,
          estado: 'CERRADO'
        }])
        .select('id')
        .single();

      if (errCab) throw errCab;

      // 2. Insertar Detalle por Medio de Pago (TB_DCIERRE_CAJA)
      const detalles = Object.values(resumenCierreActual.totalesPorMedio).map(m => ({
        id_cierre: cierre.id,
        id_medio_pago: m.id,
        monto: m.total,
        egresos: 0,        // Campo preparado para módulo de gastos
        saldo_neto: m.total,
        cantidad_transacciones: m.cantidad
      }));

      if (detalles.length > 0) {
        const { error: errDet } = await supabaseAdmin
          .from('TB_DCIERRE_CAJA')
          .insert(detalles);

        if (errDet) throw errDet;
      }

      alert('¡Cierre de caja guardado con éxito!');
      $('#modalCierreCaja').modal('hide');

    } catch (err) {
      console.error('Error al guardar el cierre de caja:', err);
      alert('Error al registrar el cierre de caja: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.innerText = 'CONFIRMAR Y CERRAR CAJA';
    }
  });
}

// -----------------------------------------------------------------------------
// HISTORIAL DE CIERRES
// -----------------------------------------------------------------------------
export async function inicializarHistorialCierres() {
  const inputDesde = document.getElementById('filtro-cierre-desde');
  const inputHasta = document.getElementById('filtro-cierre-hasta');

  // Setear por defecto el mes actual
  const hoyObj = new Date();
  const primerDiaMes = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-01`;
  const hoyStr = `${hoyObj.getFullYear()}-${String(hoyObj.getMonth() + 1).padStart(2, '0')}-${String(hoyObj.getDate()).padStart(2, '0')}`;

  if (inputDesde && !inputDesde.value) inputDesde.value = primerDiaMes;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoyStr;

  await cargarTablaHistorialCierres();
}

export async function cargarTablaHistorialCierres() {
  const contenedor = document.getElementById('tabla-historial-cierres-body');
  if (!contenedor) return;

  const desde = document.getElementById('filtro-cierre-desde')?.value;
  const hasta = document.getElementById('filtro-cierre-hasta')?.value;

  if (!desde || !hasta) {
    alert('Ingresá ambas fechas para consultar.');
    return;
  }

  contenedor.innerHTML = `<tr><td colspan="7" class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> Buscando cierres...</td></tr>`;

  try {
    const { data: cierres, error } = await supabaseAdmin
      .from('TB_TCIERRE_CAJA')
      .select(`
        id, fecha, total_general, efectivo_real, diferencia_efectivo, observaciones, estado,
        TB_DCIERRE_CAJA (
          monto, cantidad_transacciones, TB_BMEDIO_PAGO ( nombre )
        )
      `)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false });

    if (error) throw error;

    if (!cierres || cierres.length === 0) {
      contenedor.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No se encontraron cierres entre ${desde} y ${hasta}.</td></tr>`;
      return;
    }

    let html = '';
    cierres.forEach(c => {
      const esCerrado = c.estado === 'CERRADO';
      const badgeClass = esCerrado ? 'badge-success' : 'badge-danger';
      const dif = Number(c.diferencia_efectivo || 0);
      const difClass = dif === 0 ? 'text-dark' : (dif > 0 ? 'text-info' : 'text-danger');

      html += `
        <tr>
          <td><strong>#${c.id}</strong></td>
          <td>${formatearFechaAR(c.fecha)}</td>
          <td><span class="badge ${badgeClass}">${c.estado}</span></td>
          <td>$${Number(c.total_general).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td>$${Number(c.efectivo_real).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td class="${difClass} font-weight-bold">$${dif.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          <td class="text-center">
            <button class="btn btn-sm btn-outline-info" data-action="ver-detalle-cierre" data-id="${c.id}">
              👁️ Ver Detalle
            </button>
          </td>
        </tr>
      `;
    });

    contenedor.innerHTML = html;

    // Guardar en cache temporal para consultar el detalle sin volver a pedir a BD
    window.cacheHistorialCierres = cierres;

  } catch (err) {
    console.error('Error al cargar historial:', err);
    contenedor.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Error al obtener historial: ${err.message || err}</td></tr>`;
  }
}

export function verDetalleCierre(idCierre) {
  const cierres = window.cacheHistorialCierres || [];
  const cierre = cierres.find(c => Number(c.id) === Number(idCierre));

  if (!cierre) return;

  document.getElementById('titulo-modal-detalle-cierre').innerText = `Detalle Cierre #${cierre.id} (${cierre.fecha})`;

  let htmlDetalle = '<div class="list-group mb-3">';
  (cierre.TB_DCIERRE_CAJA || []).forEach(d => {
    const medio = d.TB_BMEDIO_PAGO?.nombre || 'Medio Pago';
    htmlDetalle += `
      <div class="list-group-item d-flex justify-content-between align-items-center py-2">
        <span><strong>${medio}</strong> (${d.cantidad_transacciones} op.)</span>
        <span class="font-weight-bold">$${Number(d.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
      </div>
    `;
  });

  const dif = Number(cierre.diferencia_efectivo || 0);

  htmlDetalle += `
      <div class="list-group-item d-flex justify-content-between align-items-center bg-light py-2">
        <span><strong>TOTAL GENERAL:</strong></span>
        <strong class="text-success">$${Number(cierre.total_general).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>
      </div>
    </div>

    <div class="p-2 bg-light rounded mb-2 border">
      <small class="d-block"><strong>Efectivo Contado:</strong> $${Number(cierre.efectivo_real).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</small>
      <small class="d-block"><strong>Diferencia Caja:</strong> <span class="${dif < 0 ? 'text-danger' : 'text-success'} font-weight-bold">$${dif.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span></small>
      <small class="d-block text-muted"><strong>Observaciones:</strong> ${cierre.observaciones || 'Sin observaciones'}</small>
    </div>
  `;

  document.getElementById('body-modal-detalle-cierre').innerHTML = htmlDetalle;
  $('#modalDetalleCierre').modal('show');
}