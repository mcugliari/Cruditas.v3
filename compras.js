// =============================================================================
// compras.js  ·  LISTADO DE COMPRAS, DETALLE Y ANULACIÓN
// =============================================================================
//
// QUÉ HACE
//   - Lista las compras a proveedores con filtros (fechas, proveedor, estado de
//     pago) y un resumen de totales.
//   - Abre el detalle de una compra: sus líneas de insumos y sus pagos.
//   - Permite anular una compra que no tiene pagos.
//
// QUÉ NO HACE (está en otros archivos)
//   - Cargar una compra nueva: compraForm.js
//   - Registrar pagos y ver la deuda: se agrega en el paso 4
//
// DE DÓNDE SALEN LOS DATOS
//   La lista sale de la VISTA "VW_COMPRAS_SALDO" (script 03). Una vista es una
//   consulta guardada en la base que se usa como si fuera una tabla. Esta ya
//   calcula por nosotros cuánto se pagó, cuánto se debe y el estado de pago
//   (PENDIENTE, PARCIAL, PAGADA o ANULADA).
//
// ESCRITURA
//   Esta pantalla NO escribe directo en las tablas de compras: usa la función de
//   la base "anular_compra" (script 04), que valida todo en el servidor.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, mensajeErrorFuncion,
  formatearMoneda, formatearFechaAR, obtenerFechaActualISO, sumarDiasISO, confirmarAccion
} from './utils.js';
import { abrirModalPago, anularPago } from './pagos.js';


// Copia en memoria de la lista que se está mostrando (ver proveedores.js).
let comprasCache = [];

// Id de la compra cuyo detalle está abierto (lo necesita el botón "Anular").
// null significa "ninguna".
let compraDetalleId = null;

// Datos de esa misma compra (de la vista), que necesita el botón "Registrar pago".
let compraDetalleCabecera = null;


// -----------------------------------------------------------------------------
// badgeEstadoCompra
//   Devuelve el HTML de la etiqueta de color según el estado de pago.
//   Recibe: una fila de VW_COMPRAS_SALDO.
//   Se exporta porque la pantalla de deuda (paso 4) también la va a usar.
// -----------------------------------------------------------------------------
export function badgeEstadoCompra(c) {
  // Un objeto usado como "diccionario": a cada estado le corresponde una clase
  // de color de Bootstrap y un texto.
  const estilos = {
    PENDIENTE: { clase: 'badge-warning',   texto: 'Pendiente' },
    PARCIAL:   { clase: 'badge-info',      texto: 'Parcial' },
    PAGADA:    { clase: 'badge-success',   texto: 'Pagada' },
    ANULADA:   { clase: 'badge-secondary', texto: 'Anulada' }
  };
  // Si apareciera un estado desconocido, mostramos el texto tal cual (con ||).
  const e = estilos[c.estado_pago] || { clase: 'badge-light', texto: c.estado_pago };

  const etiqueta = `<span class="badge ${e.clase}">${esc(e.texto)}</span>`;
  // Si además está vencida, se agrega una segunda etiqueta roja.
  const vencida = c.vencida ? ' <span class="badge badge-danger">Vencida</span>' : '';
  return etiqueta + vencida;
}


// -----------------------------------------------------------------------------
// cargarSelectProveedoresFiltro  (interna)
//   Llena el desplegable de proveedores del filtro, una sola vez por visita.
// -----------------------------------------------------------------------------
async function cargarSelectProveedoresFiltro() {
  const select = document.getElementById('filtro-compra-proveedor');
  // select.options es la lista de opciones. Si ya tiene más de una (la opción
  // "Todos" + proveedores), no hace falta volver a cargarlo.
  if (!select || select.options.length > 1) return;

  const { data, error } = await supabaseAdmin
    .from('TB_BPROVEEDORES')
    .select('id, nombre')
    .order('nombre', { ascending: true });

  if (error) return; // si falla, el filtro queda solo con "Todos"

  select.innerHTML = '<option value="">Todos los proveedores</option>' +
    (data || []).map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');
}


// -----------------------------------------------------------------------------
// cargarCompras
//   Trae las compras según los filtros y dibuja la tabla y el resumen.
//   Se llama al entrar a la pantalla, al apretar "Filtrar" y después de cada cambio.
// -----------------------------------------------------------------------------
export async function cargarCompras() {
  const tbody = document.getElementById('tabla-compras-body');
  if (!tbody) return;

  const inputDesde = document.getElementById('filtro-compra-desde');
  const inputHasta = document.getElementById('filtro-compra-hasta');

  // La primera vez (campos vacíos) el filtro propone los últimos 30 días.
  // OJO: es el rango de la fecha de la COMPRA. Para ver TODA la deuda pendiente,
  // sin importar la fecha, va a existir la pantalla "Deuda a proveedores" (paso 4).
  if (inputDesde && !inputDesde.value) {
    const hoy = obtenerFechaActualISO();
    inputDesde.value = sumarDiasISO(hoy, -30);
    inputHasta.value = hoy;
  }

  await cargarSelectProveedoresFiltro();

  // Armado de la consulta por partes: .from() y .select() crean la consulta,
  // y después le vamos AGREGANDO condiciones según lo que el usuario eligió.
  // Cada .gte() ("mayor o igual"), .lte() ("menor o igual") o .eq() ("igual")
  // devuelve la consulta ampliada, por eso se reasigna a "consulta".
  // .limit(300) pone un tope de filas para que la pantalla no se ponga lenta.
  let consulta = supabaseAdmin
    .from('VW_COMPRAS_SALDO')
    .select('*')
    .order('fecha', { ascending: false })
    .order('id_compra', { ascending: false })
    .limit(300);

  if (inputDesde.value) consulta = consulta.gte('fecha', inputDesde.value);
  if (inputHasta.value) consulta = consulta.lte('fecha', inputHasta.value);

  const idProveedor = document.getElementById('filtro-compra-proveedor')?.value;
  if (idProveedor) consulta = consulta.eq('id_proveedor', idProveedor);

  const estadoPago = document.getElementById('filtro-compra-estado')?.value;
  if (estadoPago) consulta = consulta.eq('estado_pago', estadoPago);

  // Recién ahora se ejecuta la consulta (al hacer "await").
  const { data, error } = await consulta;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-danger text-center">${esc(mensajeErrorBD(error))}</td></tr>`;
    return;
  }

  comprasCache = data || [];
  renderizarCompras();
}


// -----------------------------------------------------------------------------
// renderizarCompras  (interna)
//   Dibuja la tabla y el resumen a partir de comprasCache.
// -----------------------------------------------------------------------------
function renderizarCompras() {
  const tbody = document.getElementById('tabla-compras-body');
  const resumen = document.getElementById('resumen-compras');
  if (!tbody) return;

  // ---- Resumen de totales (sin contar las anuladas) ----
  // .filter() se queda con las compras no anuladas.
  // .reduce() recorre la lista y va ACUMULANDO un valor: empieza en 0 (el último
  // argumento) y en cada vuelta suma el total de la compra de turno ("c") al
  // acumulado ("acc"). Number(...) asegura que se sume como número.
  if (resumen) {
    const validas = comprasCache.filter(c => c.estado_pago !== 'ANULADA');
    const sumar = (campo) => validas.reduce((acc, c) => acc + Number(c[campo] || 0), 0);

    resumen.innerHTML = `
      <span class="mr-3"><strong>${validas.length}</strong> compras</span>
      <span class="mr-3">Total: <strong>$${formatearMoneda(sumar('total'))}</strong></span>
      <span class="mr-3">Pagado: <strong class="text-success">$${formatearMoneda(sumar('pagado'))}</strong></span>
      <span>Saldo: <strong class="text-danger">$${formatearMoneda(sumar('saldo'))}</strong></span>
    `;
  }

  if (comprasCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">No hay compras para estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = comprasCache.map(c => `
    <tr class="${c.estado_pago === 'ANULADA' ? 'text-muted' : ''}">
      <td><span class="badge badge-secondary">#${c.id_compra}</span></td>
      <td>${formatearFechaAR(c.fecha)}</td>
      <td class="font-weight-bold">${esc(c.proveedor)}</td>
      <td>${esc(c.nro_comprobante) || '-'}</td>
      <td class="text-right">$${formatearMoneda(c.total)}</td>
      <td class="text-right text-success">$${formatearMoneda(c.pagado)}</td>
      <td class="text-right font-weight-bold ${Number(c.saldo) > 0 ? 'text-danger' : ''}">$${formatearMoneda(c.saldo)}</td>
      <td class="text-center">${badgeEstadoCompra(c)}</td>
      <td>
        <div class="acciones-fila">
          ${Number(c.saldo) > 0 && c.estado_pago !== 'ANULADA'
            ? `<button class="btn btn-accion btn-accion-pagar" title="Registrar un pago de esta compra"
                       data-action="pagar-compra" data-id="${c.id_compra}">
                 <i class="fas fa-dollar-sign"></i> Pagar
               </button>`
            : ''}
          <button class="btn btn-accion btn-accion-ver" title="Ver detalle de la compra"
                  data-action="ver-detalle-compra" data-id="${c.id_compra}">
            <i class="fas fa-eye"></i> Ver detalle
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}


// -----------------------------------------------------------------------------
// pagarCompraDesdeLista
//   Abre la ventana de pago directo desde la fila de la lista (botón "Pagar"),
//   sin pasar por el detalle. La lista ya trae lo que hace falta: proveedor y saldo.
//   Recibe: idCompra -> número de la compra.
// -----------------------------------------------------------------------------
export function pagarCompraDesdeLista(idCompra) {
  const compra = comprasCache.find(c => c.id_compra === idCompra);
  if (!compra) return;

  abrirModalPago({
    modo: 'compra',
    id: compra.id_compra,
    saldo: Number(compra.saldo),
    titulo: `Pagar compra #${compra.id_compra}`,
    descripcion: `<strong>${esc(compra.proveedor)}</strong><br>
                  Saldo de la compra: <strong class="text-danger">$${formatearMoneda(compra.saldo)}</strong>`,
    // No hay otra ventana abierta que cerrar o reabrir.
    modalAnterior: null,
    // Al cerrarse la ventana de pago: si se guardó algo, se refresca la lista.
    alCerrar: async (huboPago) => {
      if (huboPago) await cargarCompras();
    }
  });
}


// -----------------------------------------------------------------------------
// verDetalleCompra
//   Abre la ventana con las líneas y los pagos de una compra.
//   Recibe: idCompra -> número de la compra.
// -----------------------------------------------------------------------------
export async function verDetalleCompra(idCompra) {
  // Cuatro consultas en paralelo (Promise.all, ver insumos.js):
  //  1) el encabezado, leído de la vista. Se lee SIEMPRE de la base (no de la
  //     lista en memoria) para que, después de registrar un pago, el detalle
  //     muestre el saldo actualizado.
  //  2) líneas de la compra, con el nombre y la unidad de cada insumo
  //  3) pagos de la compra, con el medio de pago y la cuenta (nombre)
  //  4) datos extra que la vista no trae (observaciones, motivo de anulación)
  // "TB_BINSUMOS ( nombre, unidad_medida )" y "TB_BMEDIO_PAGO ( nombre )" traen
  // datos de tablas relacionadas, igual que en productos.js.
  const [resCab, resLineas, resPagos, resExtra] = await Promise.all([
    supabaseAdmin.from('VW_COMPRAS_SALDO')
      .select('*')
      .eq('id_compra', idCompra)
      .single(),   // .single() = "esperá exactamente una fila" (devuelve el objeto, no una lista)
    supabaseAdmin.from('TB_DCOMPRAS')
      .select('cantidad, precio_unitario, subtotal, TB_BINSUMOS ( nombre, unidad_medida )')
      .eq('id_compra', idCompra)
      .order('id', { ascending: true }),
    supabaseAdmin.from('TB_TEGRESOS')
      .select('id, fecha, monto, estado, motivo_anulacion, TB_BMEDIO_PAGO ( nombre, es_efectivo ), TB_BCUENTAS ( nombre )')
      .eq('id_compra', idCompra)
      .order('id', { ascending: true }),
    supabaseAdmin.from('TB_TCOMPRAS')
      .select('observaciones, motivo_anulacion')
      .eq('id', idCompra)
      .single()
  ]);

  const errorCarga = resCab.error || resLineas.error || resPagos.error || resExtra.error;
  if (errorCarga) {
    mostrarNotificacion(mensajeErrorBD(errorCarga), 'danger');
    return;
  }

  const cabecera = resCab.data;
  const lineas = resLineas.data || [];
  const pagos = resPagos.data || [];
  const extra = resExtra.data || {};

  compraDetalleId = idCompra;
  compraDetalleCabecera = cabecera;

  // ---- Encabezado ----
  document.getElementById('detalle-compra-titulo').innerText = `Compra #${idCompra}`;
  document.getElementById('detalle-compra-info').innerHTML = `
    <div class="row">
      <div class="col-md-6"><strong>Proveedor:</strong> ${esc(cabecera.proveedor)}</div>
      <div class="col-md-3"><strong>Fecha:</strong> ${formatearFechaAR(cabecera.fecha)}</div>
      <div class="col-md-3"><strong>Comprobante:</strong> ${esc(cabecera.nro_comprobante) || '-'}</div>
    </div>
    <div class="row mt-1">
      <div class="col-md-6"><strong>Estado:</strong> ${badgeEstadoCompra(cabecera)}</div>
      <div class="col-md-3"><strong>Vence:</strong> ${cabecera.fecha_vencimiento ? formatearFechaAR(cabecera.fecha_vencimiento) : '-'}</div>
      <div class="col-md-3"><strong>Saldo:</strong> <span class="${Number(cabecera.saldo) > 0 ? 'text-danger' : ''} font-weight-bold">$${formatearMoneda(cabecera.saldo)}</span></div>
    </div>
    ${extra.observaciones ? `<div class="mt-2"><strong>Observaciones:</strong> ${esc(extra.observaciones)}</div>` : ''}
    ${extra.motivo_anulacion ? `<div class="mt-2 text-danger"><strong>Motivo de anulación:</strong> ${esc(extra.motivo_anulacion)}</div>` : ''}
  `;

  // ---- Líneas de insumos ----
  // "?." evita errores si algún dato relacionado no existiera.
  document.getElementById('tabla-detalle-compra-lineas').innerHTML = lineas.length === 0
    ? `<tr><td colspan="4" class="text-center text-muted">Sin líneas.</td></tr>`
    : lineas.map(l => `
        <tr>
          <td>${esc(l.TB_BINSUMOS?.nombre)}</td>
          <td class="text-center">${Number(l.cantidad)} ${esc(l.TB_BINSUMOS?.unidad_medida)}</td>
          <td class="text-right">$${formatearMoneda(l.precio_unitario)}</td>
          <td class="text-right font-weight-bold">$${formatearMoneda(l.subtotal)}</td>
        </tr>`).join('');
  document.getElementById('detalle-compra-total').innerText = `$${formatearMoneda(cabecera.total)}`;

  // ---- Pagos ----
  document.getElementById('tabla-detalle-compra-pagos').innerHTML = pagos.length === 0
    ? `<tr><td colspan="5" class="text-center text-muted">Todavía no hay pagos.</td></tr>`
    : pagos.map(p => `
        <tr class="${p.estado === 'ANULADO' ? 'text-muted' : ''}">
          <td>${formatearFechaAR(p.fecha)}</td>
          <td>${esc(p.TB_BMEDIO_PAGO?.nombre)}${(p.TB_BCUENTAS?.nombre && !p.TB_BMEDIO_PAGO?.es_efectivo)
            ? `<div class="small text-muted">${esc(p.TB_BCUENTAS.nombre)}</div>` : ''}</td>
          <td class="text-right font-weight-bold">$${formatearMoneda(p.monto)}</td>
          <td class="text-center">${p.estado === 'ANULADO'
            ? `<span class="badge badge-secondary" title="${esc(p.motivo_anulacion)}">Anulado</span>`
            : '<span class="badge badge-success">Activo</span>'}</td>
          <td class="text-center">${p.estado === 'ACTIVO'
            ? `<button class="btn btn-sm btn-outline-danger" title="Anular pago"
                       data-action="anular-pago" data-id="${p.id}"><i class="fas fa-ban"></i></button>`
            : ''}</td>
        </tr>`).join('');

  // ---- Botón "Anular compra": solo si no está anulada y no tiene pagos ----
  // classList.toggle('d-none', condición) agrega la clase "d-none" (que oculta
  // el elemento en Bootstrap) cuando la condición es verdadera, y la quita
  // cuando es falsa. Acá: ocultar si ya está anulada o tiene algo pagado.
  const puedeAnular = cabecera.estado_pago === 'PENDIENTE';
  document.getElementById('btn-anular-compra').classList.toggle('d-none', !puedeAnular);

  // ---- Botón "Registrar pago": solo si la compra no está anulada y todavía tiene saldo ----
  const puedePagar = cabecera.estado_pago !== 'ANULADA' && Number(cabecera.saldo) > 0;
  document.getElementById('btn-pagar-compra').classList.toggle('d-none', !puedePagar);

  $('#modal-detalle-compra').modal('show');
}


// -----------------------------------------------------------------------------
// anularCompraAbierta
//   Anula la compra cuyo detalle está abierto, pidiendo un motivo.
//   La regla "no se anula una compra con pagos" la controla la base de datos.
// -----------------------------------------------------------------------------
export async function anularCompraAbierta() {
  if (compraDetalleId === null) return;

  // confirmarAccion (utils.js) es nuestra ventana propia: pide el motivo y devuelve el texto
  // escrito, o null si el usuario cancela.
  const motivo = await confirmarAccion({
    titulo: 'Anular compra',
    mensaje: `Vas a anular la compra #${compraDetalleId}. Indicá el motivo (obligatorio).`,
    pedirMotivo: true,
    textoConfirmar: 'Anular compra',
    peligro: true
  });
  if (!motivo) {
    // Canceló: no se anula nada y no hace falta avisar.
    return;
  }

  // supabase.rpc('nombre_de_la_función', { parámetros }) ejecuta una FUNCIÓN de
  // la base de datos. Los nombres de los parámetros deben coincidir con los
  // de la función en el script 04 (p_id y p_motivo).
  const { error } = await supabaseAdmin.rpc('anular_compra', {
    p_id: compraDetalleId,
    p_motivo: motivo
  });

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'compra'), 'danger');
    return;
  }

  $('#modal-detalle-compra').modal('hide');
  mostrarNotificacion('Compra anulada.');
  await cargarCompras();
}


// -----------------------------------------------------------------------------
// pagarCompraAbierta
//   Abre la ventana de pago para la compra cuyo detalle está abierto.
//   (La ventana de pago vive en pagos.js; acá solo se le dice qué pagar.)
// -----------------------------------------------------------------------------
export function pagarCompraAbierta() {
  const compra = compraDetalleCabecera;
  if (!compra) return;

  abrirModalPago({
    modo: 'compra',
    id: compra.id_compra,
    saldo: Number(compra.saldo),
    titulo: `Pagar compra #${compra.id_compra}`,
    descripcion: `<strong>${esc(compra.proveedor)}</strong><br>
                  Saldo de la compra: <strong class="text-danger">$${formatearMoneda(compra.saldo)}</strong>`,
    // El detalle se cierra para dar lugar a la ventana de pago...
    modalAnterior: '#modal-detalle-compra',
    // ...y este CALLBACK se ejecuta cuando la ventana de pago se cierra (ver pagos.js):
    // refresca la lista y vuelve a abrir el detalle con los datos nuevos.
    alCerrar: async () => {
      await cargarCompras();
      await verDetalleCompra(compra.id_compra);
    }
  });
}


// -----------------------------------------------------------------------------
// anularPagoDeCompra
//   Anula un pago de la compra abierta y refresca el detalle.
//   Recibe: idEgreso -> número del pago (el botón de cada fila lo trae en data-id).
// -----------------------------------------------------------------------------
export async function anularPagoDeCompra(idEgreso) {
  const idCompra = compraDetalleId;
  // Le pasamos a anularPago un callback: si se anula, refrescamos lista y detalle.
  await anularPago(idEgreso, async () => {
    await cargarCompras();
    await verDetalleCompra(idCompra);
  });
}
