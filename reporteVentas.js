import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, obtenerFechaActualISO, esc, mensajeErrorFuncion } from './utils.js';

export async function inicializarReporteVentas() {
  await cargarSelectClientesFiltro();

  const hoy = obtenerFechaActualISO(); // fecha local (Argentina), no UTC
  const inputDesde = document.getElementById('filtro-prod-fecha-desde');
  const inputHasta = document.getElementById('filtro-prod-fecha-hasta');

  if (inputDesde && !inputDesde.value) inputDesde.value = hoy;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  await generarResumenVentasProductos();
}

export async function cargarSelectClientesFiltro() {
  const select = document.getElementById('filtro-prod-cliente');
  if (!select) return;

  const { data: clientes } = await supabaseAdmin
    .from('TB_BCLIENTES')
    .select('id, nombre')
    .order('nombre');

  if (clientes) {
    select.innerHTML = '<option value="">-- Todos los Clientes --</option>' + 
      clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  }
}

export async function generarResumenVentasProductos() {
  const fDesde = document.getElementById('filtro-prod-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-prod-fecha-hasta')?.value;
  const idCliente = document.getElementById('filtro-prod-cliente')?.value;

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }

  // Aviso aparte de los pedidos entregados y todavía sin cobrar (no suman a los totales).
  // No se espera: se completa solo cuando llega la respuesta.
  mostrarNotaImpagos(fDesde, fHasta, idCliente);

  // 1. Ventas por producto según los PAGOS del rango (script 50): la venta cuenta el día en que se cobra
  //    (aunque el pedido se retire después) y cada pago se reparte entre las líneas de su pedido en proporción a lo
  //    cobrado. Una devolución resta el día en que ocurre. La base devuelve una fila por producto; el renglón de
  //    descuento por docena (producto 999) viene con monto negativo.
  const { data: filas, error: errVentas } = await supabaseAdmin.rpc('ventas_por_producto', {
    p_desde: fDesde,
    p_hasta: fHasta,
    p_id_cliente: idCliente ? Number(idCliente) : null
  });

  const tbody = document.getElementById('tbody-resumen-productos');
  const tfoot = document.getElementById('tfoot-resumen-productos');

  if (errVentas) {
    mostrarNotificacion('Error al consultar las ventas: ' + mensajeErrorFuncion(errVentas, 'reporte'), 'danger');
    return;
  }

  if (!filas || filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay ventas cobradas para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    renderizarTarjetasGrupos({});
    mostrarNotaDescuento(0);
    return;
  }

  // 2. Agrupar por Grupo y por Producto
  const gruposAcumulados = {};
  const productosAgrupados = {};
  // Suma (negativa) de los descuentos por docena: no se muestra como fila, pero se resta de los totales.
  let descuentoTotal = 0;

  filas.forEach(item => {
    // El renglón de descuento (producto 999) guarda "docenas" en cantidad:
    // suma el monto (negativo) pero no cuenta como unidades vendidas.
    const esDescuento = Number(item.id_producto) === 999;
    const cant = esDescuento ? 0 : Number(item.unidades || 0);
    const monto = Number(item.monto || 0);

    let grupoNombre = String(item.grupo || 'OTROS').toUpperCase().trim();
    const catNombre = item.categoria || 'Sin Categoría';

    // 💡 SI ES UN DESCUENTO POR DOCENA, SE LO ASIGNAMOS AL GRUPO 'EMPANADAS'
    if (grupoNombre === 'SISTEMA' || String(item.producto || '').toLowerCase().includes('docena')) {
      grupoNombre = 'EMPANADAS';
    }

    // Acumulador de KPI por grupo
    if (!gruposAcumulados[grupoNombre]) {
      gruposAcumulados[grupoNombre] = { unidades: 0, monto: 0 };
    }
    gruposAcumulados[grupoNombre].unidades += cant;
    gruposAcumulados[grupoNombre].monto += monto;

    // La bonificación (producto 999) no se muestra como producto: solo se acumula su monto.
    if (esDescuento) {
      descuentoTotal += monto;
      return;
    }

    productosAgrupados[item.id_producto] = {
      grupo: grupoNombre,
      categoria: catNombre,
      producto: item.producto,
      permiteDocena: Boolean(item.permite_docena),
      unidades: cant,
      montoTotal: monto
    };
  });

  // Las unidades pueden quedar con decimales si hubo cobros parciales o devoluciones: se redondean a 2.
  const redondearUnidades = (n) => Math.round(n * 100) / 100;
  Object.values(gruposAcumulados).forEach(g => { g.unidades = redondearUnidades(g.unidades); });
  Object.values(productosAgrupados).forEach(r => { r.unidades = redondearUnidades(r.unidades); });

  // 3. Renderizar KPIs visuales superiores
  renderizarTarjetasGrupos(gruposAcumulados);

  // 4. Renderizar Tabla de Detalle
  const listaConsolidada = Object.values(productosAgrupados).sort((a, b) =>
    a.grupo.localeCompare(b.grupo) || a.categoria.localeCompare(b.categoria) || a.producto.localeCompare(b.producto)
  );

  // Sin filas que mostrar (por ejemplo, solo había un descuento): mismo aviso que sin ventas.
  if (listaConsolidada.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay ventas cobradas para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    mostrarNotaDescuento(0);
    return;
  }

  let totalUnidadesGral = 0;
  // El total arranca en el descuento (negativo): así sigue siendo lo realmente vendido
  // aunque la fila del descuento ya no se vea.
  let totalMontoGral = descuentoTotal;

  tbody.innerHTML = listaConsolidada.map(row => {
    totalUnidadesGral += row.unidades;
    totalMontoGral += row.montoTotal;

    const textoDocenas = row.permiteDocena
      ? `${(row.unidades / 12).toFixed(1)} doc.`
      : '-';

    return `
      <tr>
        <td>${esc(row.categoria)}</td>
        <td class="font-weight-bold">${esc(row.producto)}</td>
        <td class="text-center">${row.unidades} u.</td>
        <td class="text-center text-muted">${textoDocenas}</td>
        <td class="text-right font-weight-bold">$${row.montoTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');

  if (tfoot) {
   tfoot.style.display = 'table-footer-group';
    document.getElementById('total-resumen-unidades').innerText = `${redondearUnidades(totalUnidadesGral)} u.`;

    // Opcional: Para el Total General podés mostrar solo las docenas del grupo de Empanadas
    const unidadesEmpanadas = gruposAcumulados['EMPANADAS']?.unidades || 0;
    document.getElementById('total-resumen-docenas').innerText = `${(unidadesEmpanadas / 12).toFixed(1)} doc.`;

    document.getElementById('total-resumen-monto').innerText = `$${totalMontoGral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }

  mostrarNotaDescuento(descuentoTotal);
}

// -----------------------------------------------------------------------------
// mostrarNotaImpagos  (interna)
//   Avisa cuántos pedidos están entregados pero con saldo sin cobrar y por cuánto. Se buscan por su
//   FECHA DE PEDIDO dentro del rango (y del cliente, si hay uno elegido). Esa plata NO está en los totales:
//   entra al reporte el día que se cobra. Si no hay ninguno, la nota se oculta.
//   (Antes eran los pedidos ENTREGADO_IMPAGO; ahora es ENTREGADO con saldo mayor a cero, de VW_PEDIDO_SALDO.)
// -----------------------------------------------------------------------------
async function mostrarNotaImpagos(fDesde, fHasta, idCliente) {
  const nota = document.getElementById('nota-resumen-impagos');
  if (!nota) return;

  let query = supabaseAdmin
    .from('VW_PEDIDO_SALDO')
    .select('id_pedido, saldo')
    .eq('estado', 'ENTREGADO')
    .gt('saldo', 0)
    .gte('fecha', fDesde)
    .lte('fecha', fHasta);
  if (idCliente) query = query.eq('id_cliente', idCliente);

  const { data, error } = await query;

  // Si la consulta falla, no se muestra nada: es solo un aviso extra, el reporte sigue igual.
  if (error || !data || data.length === 0) {
    nota.classList.add('d-none');
    return;
  }

  const cantidad = data.length;
  const monto = data.reduce((suma, p) => suma + Number(p.saldo || 0), 0)
    .toLocaleString('es-AR', { minimumFractionDigits: 2 });
  nota.innerText = `Hay ${cantidad} ${cantidad === 1 ? 'pedido entregado' : 'pedidos entregados'} con saldo sin cobrar en este período, por $${monto}. No están incluidos en los totales: aparecen cuando se cobran.`;
  nota.classList.remove('d-none');
}


// -----------------------------------------------------------------------------
// mostrarNotaDescuento  (interna)
//   Como la bonificación no es una fila, los totales ya la traen restada. Esta nota lo
//   aclara debajo de la tabla. Con 0 se oculta.
// -----------------------------------------------------------------------------
function mostrarNotaDescuento(descuento) {
  const nota = document.getElementById('nota-resumen-descuento');
  if (!nota) return;
  const hay = Number(descuento) !== 0;
  nota.classList.toggle('d-none', !hay);
  if (hay) {
    const monto = Math.abs(descuento).toLocaleString('es-AR', { minimumFractionDigits: 2 });
    nota.innerText = `Los totales incluyen descuentos por docena por -$${monto}.`;
  }
}

function renderizarTarjetasGrupos(grupos) {
  const cont = document.getElementById('contenedor-kpis-grupos');
  if (!cont) return;

  const emp = grupos['EMPANADAS'] || { unidades: 0, monto: 0 };
  const piz = grupos['PIZZAS'] || { unidades: 0, monto: 0 };
  const otros = grupos['OTROS'] || { unidades: 0, monto: 0 };

  const docenasEmp = (emp.unidades / 12).toFixed(1);

  cont.innerHTML = `
    <div class="row mb-3">
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-warning text-white" style="font-size: 1.8rem;">🥟</span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Empanadas y Canastitas</span>
            <span class="info-box-number text-dark">${emp.unidades} u. <small class="text-muted">(${docenasEmp} doc.)</small></span>
            <span class="progress-description text-success font-weight-bold">$${emp.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>

      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-danger text-white"><i class="fas fa-pizza-slice"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Pizzas</span>
            <span class="info-box-number text-dark">${piz.unidades} u.</span>
            <span class="progress-description text-success font-weight-bold">$${piz.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>

      <div class="col-md-4 col-sm-12 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-info text-white"><i class="fas fa-box"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Otros / Varios</span>
            <span class="info-box-number text-dark">${otros.unidades} u.</span>
            <span class="progress-description text-success font-weight-bold">$${otros.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}