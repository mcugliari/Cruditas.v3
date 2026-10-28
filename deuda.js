// =============================================================================
// deuda.js  ·  DEUDA A PROVEEDORES
// =============================================================================
//
// QUÉ HACE
//   - Muestra cuánto se le debe a cada proveedor (total, vencido y primer vencimiento).
//   - Permite ver las compras pendientes de un proveedor.
//   - Permite pagar: una compra puntual, o un monto "a cuenta" al proveedor.
//
// DE DÓNDE SALEN LOS DATOS
//   Vistas de la base (script 03):
//     VW_DEUDA_PROVEEDORES -> una fila por proveedor con deuda
//     VW_COMPRAS_SALDO     -> una fila por compra, con su saldo y estado de pago
//   Solo se LEE de ellas. Los pagos se registran en pagos.js.
//
// CÓMO SE CONECTA
//   index.html (sec-deuda, modal-deuda-proveedor), main.js, pagos.js, utils.js.
//
// ENCADENADO DE VENTANAS
//   Desde la ventana "Deuda del proveedor" se puede abrir la de pago. Al cerrarse
//   la de pago, se refresca la pantalla y se vuelve a abrir la del proveedor
//   (ver "alCerrar" en pagos.js).
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, formatearMoneda, formatearFechaAR
} from './utils.js';
import { abrirModalPago } from './pagos.js';


// Copia de lo que muestra la pantalla principal (una fila por proveedor).
let deudaCache = [];

// Datos de la ventana "Deuda del proveedor" abierta:
let proveedorAbierto = null;      // { id, nombre }
let comprasDeudaCache = [];       // compras pendientes de ese proveedor


// -----------------------------------------------------------------------------
// cargarDeuda
//   Trae la deuda por proveedor y dibuja la pantalla. Se llama al entrar a la
//   pantalla y después de cada pago.
// -----------------------------------------------------------------------------
export async function cargarDeuda() {
  const tbody = document.getElementById('tabla-deuda-body');
  if (!tbody) return;

  // Dos criterios de orden: primero los que más deuda vencida tienen y, a igualdad,
  // los de mayor deuda total.
  const { data, error } = await supabaseAdmin
    .from('VW_DEUDA_PROVEEDORES')
    .select('*')
    .order('deuda_vencida', { ascending: false })
    .order('deuda_total', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${esc(mensajeErrorBD(error))}</td></tr>`;
    return;
  }

  deudaCache = data || [];
  renderizarDeuda();
}


// -----------------------------------------------------------------------------
// renderizarDeuda
//   Dibuja los tres indicadores de arriba y la tabla. No consulta a la base.
//   Se exporta porque main.js la usa al tildar "Solo con deuda vencida".
// -----------------------------------------------------------------------------
export function renderizarDeuda() {
  const tbody = document.getElementById('tabla-deuda-body');
  if (!tbody) return;

  // ---- Indicadores (se calculan sobre TODOS los proveedores con deuda) ----
  // .reduce() acumula un valor recorriendo la lista (ver compras.js).
  const deudaTotal = deudaCache.reduce((acc, d) => acc + Number(d.deuda_total || 0), 0);
  const deudaVencida = deudaCache.reduce((acc, d) => acc + Number(d.deuda_vencida || 0), 0);

  document.getElementById('kpi-deuda-total').innerText = `$${formatearMoneda(deudaTotal)}`;
  document.getElementById('kpi-deuda-vencida').innerText = `$${formatearMoneda(deudaVencida)}`;
  document.getElementById('kpi-deuda-proveedores').innerText = deudaCache.length;

  // ---- Filtro "solo con deuda vencida" ----
  // ?.checked lee si el casillero está tildado.
  const soloVencida = document.getElementById('filtro-deuda-vencida')?.checked;
  const filas = soloVencida
    ? deudaCache.filter(d => Number(d.deuda_vencida) > 0)
    : deudaCache;

  if (deudaCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-success py-4"><i class="fas fa-check-circle mr-1"></i> No hay deuda pendiente con proveedores.</td></tr>`;
    return;
  }
  if (filas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">Ningún proveedor tiene deuda vencida.</td></tr>`;
    return;
  }

  tbody.innerHTML = filas.map(d => `
    <tr>
      <td class="font-weight-bold">${esc(d.proveedor)}</td>
      <td class="text-center">${d.compras_pendientes}</td>
      <td class="text-right font-weight-bold">$${formatearMoneda(d.deuda_total)}</td>
      <td class="text-right ${Number(d.deuda_vencida) > 0 ? 'text-danger font-weight-bold' : 'text-muted'}">
        $${formatearMoneda(d.deuda_vencida)}
      </td>
      <td class="text-center">${d.primer_vencimiento ? formatearFechaAR(d.primer_vencimiento) : '-'}</td>
      <td class="text-center">
        <button class="btn btn-accion btn-accion-ver mr-1" title="Ver compras pendientes"
                data-action="ver-deuda-proveedor" data-id="${d.id_proveedor}">
          <i class="fas fa-eye"></i> Ver compras
        </button>
        <button class="btn btn-accion btn-accion-pagar" title="Pagar a cuenta"
                data-action="pagar-deuda-proveedor" data-id="${d.id_proveedor}">
          <i class="fas fa-dollar-sign"></i> Pagar
        </button>
      </td>
    </tr>
  `).join('');
}


// -----------------------------------------------------------------------------
// verDeudaProveedor
//   Abre la ventana con las compras pendientes de un proveedor.
//   Recibe: idProveedor -> número del proveedor.
// -----------------------------------------------------------------------------
export async function verDeudaProveedor(idProveedor) {
  // Compras con saldo > 0 (.gt = "mayor que"). Se ordenan por vencimiento (las que
  // no tienen vencimiento al final: nullsFirst: false) y, a igualdad, por fecha.
  // Es el mismo orden en que la base reparte los pagos a cuenta.
  const { data, error } = await supabaseAdmin
    .from('VW_COMPRAS_SALDO')
    .select('*')
    .eq('id_proveedor', idProveedor)
    .gt('saldo', 0)
    .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
    .order('fecha', { ascending: true });

  if (error) {
    mostrarNotificacion(mensajeErrorBD(error), 'danger');
    return;
  }

  comprasDeudaCache = data || [];

  // Si ya no queda deuda (por ejemplo, después de un pago total), no hay nada que ver.
  if (comprasDeudaCache.length === 0) {
    mostrarNotificacion('Ese proveedor ya no tiene deuda pendiente.');
    return;
  }

  proveedorAbierto = { id: idProveedor, nombre: comprasDeudaCache[0].proveedor };
  const deudaTotal = comprasDeudaCache.reduce((acc, c) => acc + Number(c.saldo), 0);

  document.getElementById('deuda-proveedor-titulo').innerText = proveedorAbierto.nombre;
  document.getElementById('deuda-proveedor-resumen').innerHTML =
    `Deuda total: <strong class="text-danger">$${formatearMoneda(deudaTotal)}</strong> ` +
    `en ${comprasDeudaCache.length} compra${comprasDeudaCache.length === 1 ? '' : 's'}`;

  document.getElementById('tabla-deuda-compras-body').innerHTML = comprasDeudaCache.map(c => `
    <tr>
      <td><span class="badge badge-secondary">#${c.id_compra}</span></td>
      <td>${formatearFechaAR(c.fecha)}</td>
      <td>${esc(c.nro_comprobante) || '-'}</td>
      <td>${c.fecha_vencimiento ? formatearFechaAR(c.fecha_vencimiento) : '-'}
          ${c.vencida ? '<span class="badge badge-danger">Vencida</span>' : ''}</td>
      <td class="text-right">$${formatearMoneda(c.total)}</td>
      <td class="text-right font-weight-bold text-danger">$${formatearMoneda(c.saldo)}</td>
      <td class="text-center">
        <button class="btn btn-accion btn-accion-pagar" title="Pagar esta compra"
                data-action="pagar-compra-deuda" data-id="${c.id_compra}">
          <i class="fas fa-dollar-sign"></i> Pagar
        </button>
      </td>
    </tr>
  `).join('');

  $('#modal-deuda-proveedor').modal('show');
}


// -----------------------------------------------------------------------------
// Qué hacer cuando se cierra la ventana de pago (callbacks para pagos.js)
// -----------------------------------------------------------------------------

// Si se pagó algo, se refresca la pantalla. Después se vuelve a abrir la ventana
// del proveedor (si todavía tiene deuda, verDeudaProveedor la abre; si no, avisa).
async function alCerrarPagoDesdeProveedor(huboPago) {
  if (huboPago) await cargarDeuda();
  if (proveedorAbierto) await verDeudaProveedor(proveedorAbierto.id);
}

// Desde la pantalla principal no hay ventana anterior que reabrir: solo refrescar.
async function alCerrarPagoDesdePantalla(huboPago) {
  if (huboPago) await cargarDeuda();
}


// -----------------------------------------------------------------------------
// pagarCompraDeLaDeuda
//   Abre la ventana de pago para UNA compra de la lista del proveedor.
//   Recibe: idCompra -> número de la compra.
// -----------------------------------------------------------------------------
export function pagarCompraDeLaDeuda(idCompra) {
  const compra = comprasDeudaCache.find(c => c.id_compra === idCompra);
  if (!compra) return;

  abrirModalPago({
    modo: 'compra',
    id: compra.id_compra,
    saldo: Number(compra.saldo),
    titulo: `Pagar compra #${compra.id_compra}`,
    descripcion: `<strong>${esc(compra.proveedor)}</strong><br>
                  Saldo de la compra: <strong class="text-danger">$${formatearMoneda(compra.saldo)}</strong>`,
    modalAnterior: '#modal-deuda-proveedor',
    alCerrar: alCerrarPagoDesdeProveedor
  });
}


// -----------------------------------------------------------------------------
// pagarDeudaProveedorAbierto
//   Pago a cuenta desde la ventana del proveedor (botón del pie de la ventana).
// -----------------------------------------------------------------------------
export function pagarDeudaProveedorAbierto() {
  if (!proveedorAbierto) return;
  const deudaTotal = comprasDeudaCache.reduce((acc, c) => acc + Number(c.saldo), 0);

  abrirModalPago({
    modo: 'proveedor',
    id: proveedorAbierto.id,
    saldo: deudaTotal,
    titulo: 'Pago a cuenta',
    descripcion: `<strong>${esc(proveedorAbierto.nombre)}</strong><br>
                  Deuda total: <strong class="text-danger">$${formatearMoneda(deudaTotal)}</strong>`,
    modalAnterior: '#modal-deuda-proveedor',
    alCerrar: alCerrarPagoDesdeProveedor
  });
}


// -----------------------------------------------------------------------------
// pagarDeudaProveedor
//   Pago a cuenta desde la tabla principal (botón $ de cada proveedor).
//   Recibe: idProveedor -> número del proveedor.
// -----------------------------------------------------------------------------
export function pagarDeudaProveedor(idProveedor) {
  const fila = deudaCache.find(d => d.id_proveedor === idProveedor);
  if (!fila) return;

  // En este caso no hay otra ventana abierta, así que no hay "modalAnterior"
  // (null) ni que reabrir nada al cerrar. También limpiamos proveedorAbierto
  // para que el callback no intente reabrir una ventana vieja.
  proveedorAbierto = null;

  abrirModalPago({
    modo: 'proveedor',
    id: fila.id_proveedor,
    saldo: Number(fila.deuda_total),
    titulo: 'Pago a cuenta',
    descripcion: `<strong>${esc(fila.proveedor)}</strong><br>
                  Deuda total: <strong class="text-danger">$${formatearMoneda(fila.deuda_total)}</strong>`,
    modalAnterior: null,
    alCerrar: alCerrarPagoDesdePantalla
  });
}
