import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, obtenerFechaActualISO, esc, mensajeErrorFuncion } from './utils.js';

// =============================================================================
// Ventas por Período (pantalla #sec-ventas-periodo)
//   Etapa 1: solapa "Por medio de pago" -> función ventas_por_medio_pago (script 66).
//   Las próximas solapas (día/semana/mes, canal, día de semana y hora) se suman acá, cada una con su función.
//
// Criterio de fecha: la del PAGO (igual que la solapa "Cobrado" de Ventas por Producto).
//   Los cobros suman, las devoluciones restan el día en que ocurren y los traspasos no se cuentan
//   (su efecto neto sobre un medio de pago es cero).
// =============================================================================

// Formato propio de este reporte (mismo criterio que reporteVentas.js): siempre 2 decimales, coma decimal.
// Es solo de pantalla; los valores que llegan de la base no se modifican.
// El signo va antes del $ (-$30.500,00), no en el medio ($-30.500,00).
const formatearPesos = (n) => {
  const valor = Number(n || 0);
  const texto = Math.abs(valor).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (valor < 0 ? '-$' : '$') + texto;
};
const formatearPorcentaje = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

let eventosEnlazados = false;

// Entrada desde el menú (main.js, navegarA). Deja las fechas en "hoy" la primera vez y consulta.
export async function inicializarVentasPeriodo() {
  enlazarEventos();

  const hoy = obtenerFechaActualISO(); // fecha de Argentina, no UTC
  const inputDesde = document.getElementById('filtro-per-fecha-desde');
  const inputHasta = document.getElementById('filtro-per-fecha-hasta');
  if (inputDesde && !inputDesde.value) inputDesde.value = hoy;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  await generarVentasPorMedioPago();
}

// El botón "Filtrar" se enlaza una sola vez (la pantalla se inicializa cada vez que se entra).
function enlazarEventos() {
  if (eventosEnlazados) return;
  eventosEnlazados = true;
  document.getElementById('btn-filtrar-ventas-periodo')?.addEventListener('click', generarVentasPorMedioPago);
}

export async function generarVentasPorMedioPago() {
  const fDesde = document.getElementById('filtro-per-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-per-fecha-hasta')?.value;

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }

  const { data: filas, error } = await supabaseAdmin.rpc('ventas_por_medio_pago', {
    p_desde: fDesde,
    p_hasta: fHasta
  });

  if (error) {
    mostrarNotificacion('Error al consultar las ventas por medio de pago: ' + mensajeErrorFuncion(error, 'reporte'), 'danger');
    return;
  }

  dibujarTabla(filas || []);
}

// Agrupa las filas (medio + cuenta) por medio, con subtotal, y dibuja tarjetas, tabla y total.
function dibujarTabla(filas) {
  const tbody = document.getElementById('tbody-ventas-medio');
  const tfoot = document.getElementById('tfoot-ventas-medio');
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (!tbody) return;

  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No hay cobros ni devoluciones en el rango seleccionado.</td></tr>';
    if (tfoot) tfoot.style.display = 'none';
    if (cont) cont.innerHTML = '';
    return;
  }

  // Un bloque por medio de pago, en el orden que manda la base (alfabético).
  const medios = new Map();
  filas.forEach(f => {
    const m = medios.get(f.id_medio_pago) ?? { nombre: f.medio, cobros: 0, devoluciones: 0, neto: 0, pagos: 0, cuentas: [] };
    m.cobros += Number(f.cobros);
    m.devoluciones += Number(f.devoluciones);
    m.neto += Number(f.neto);
    m.pagos += Number(f.cantidad_pagos);
    m.cuentas.push(f);
    medios.set(f.id_medio_pago, m);
  });

  const total = { cobros: 0, devoluciones: 0, neto: 0, pagos: 0 };
  medios.forEach(m => {
    total.cobros += m.cobros;
    total.devoluciones += m.devoluciones;
    total.neto += m.neto;
    total.pagos += m.pagos;
  });

  // Porcentaje sobre el neto total. Si el total es 0 no hay porcentaje que mostrar.
  const pct = (neto) => (total.neto !== 0 ? formatearPorcentaje(neto * 100 / total.neto) : '-');

  let html = '';
  medios.forEach(m => {
    // Fila del medio (subtotal)
    html += `
      <tr class="font-weight-bold">
        <td>${esc(m.nombre)}</td>
        <td class="text-right">${formatearPesos(m.cobros)}</td>
        <td class="text-right">${formatearPesos(m.devoluciones)}</td>
        <td class="text-right text-success">${formatearPesos(m.neto)}</td>
        <td class="text-right">${pct(m.neto)}</td>
        <td class="text-center">${m.pagos}</td>
      </tr>`;
    // Una fila por cuenta, con sangría. Un medio con una sola cuenta (ej. Efectivo) no repite el subtotal.
    if (m.cuentas.length > 1 || m.cuentas[0].cuenta !== m.nombre) {
      m.cuentas.forEach(c => {
        html += `
      <tr class="text-muted">
        <td class="pl-4"><i class="fas fa-wallet mr-1"></i>${esc(c.cuenta)}</td>
        <td class="text-right">${formatearPesos(c.cobros)}</td>
        <td class="text-right">${formatearPesos(c.devoluciones)}</td>
        <td class="text-right">${formatearPesos(c.neto)}</td>
        <td class="text-right">${pct(Number(c.neto))}</td>
        <td class="text-center">${c.cantidad_pagos}</td>
      </tr>`;
      });
    }
  });
  tbody.innerHTML = html;

  document.getElementById('total-per-cobros').textContent = formatearPesos(total.cobros);
  document.getElementById('total-per-devoluciones').textContent = formatearPesos(total.devoluciones);
  document.getElementById('total-per-neto').textContent = formatearPesos(total.neto);
  document.getElementById('total-per-pagos').textContent = String(total.pagos);
  if (tfoot) tfoot.style.display = '';

  // Tarjetas de arriba: total neto y una por medio de pago.
  if (cont) {
    const tarjeta = (titulo, monto, icono, color) => `
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon ${color} text-white"><i class="fas ${icono}"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">${esc(titulo)}</span>
            <span class="info-box-number text-dark">${formatearPesos(monto)}</span>
          </div>
        </div>
      </div>`;
    const tarjetasMedios = [...medios.values()].map(m =>
      tarjeta(m.nombre, m.neto, 'fa-money-check-dollar', 'bg-info')).join('');
    cont.innerHTML = `<div class="row mb-3">${tarjeta('Total cobrado (neto)', total.neto, 'fa-cash-register', 'bg-success')}${tarjetasMedios}</div>`;
  }
}
