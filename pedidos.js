import { supabaseAdmin } from './config.js';
import { setPedidoEditandoId, setPedidoEditandoEstado, setCarrito } from './state.js';
import { mostrarNotificacion, obtenerFechaActualISO, mensajeErrorFuncion } from './utils.js';
import { abrirModalCobro } from './cobro.js';
import { cargarPOS, renderizarGrillaPOS, alCambiarCliente, esperarPOSListo, actualizarModoEdicionPOS } from './pos.js';
import { navegarA } from './main.js';
import { obtenerPedidoParaImprimir, imprimirComprobante } from './impresion.js';
import { btnFila, itemMenuMas } from './menuMas.js';   // botones de la fila y menú "Más"
import { puedeAlMenos } from './roles.js';   // el rol decide si se ve "Anular pedido"
import { telefonoParaWhatsApp } from './telefono.js';   // teléfono del cliente -> formato de WhatsApp
import { esPedidoNuevoSinVer, marcarVistos, marcarTodosVistos } from './avisoPedidos.js';   // "NUEVO" / visto de los pedidos web

// Escapa texto antes de insertarlo con innerHTML (evita inyección de HTML/JS).
// nombre_referencia y observaciones los escribe un cliente anónimo desde la web.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// -----------------------------------------------------------------------------
// AVISO "PEDIDO LISTO" POR WHATSAPP (opcional, gratis)
// El botón abre WhatsApp (app o WhatsApp Web) con el chat del cliente y el mensaje ya escrito;
// la persona del local toca "enviar". Es un link wa.me: no usa la API de Meta ni tiene costo.
// -----------------------------------------------------------------------------

// Los pedidos web guardan el nombre como "Juan Pérez (Tel: 1122334455)". Para el saludo se saca el teléfono.
function nombreSinTelefono(texto) {
  return String(texto ?? '').replace(/\s*\(\s*tel[^)]*\)\s*$/i, '').trim();
}

// Texto del mensaje de "pedido listo". Se puede cambiar libremente.
function mensajePedidoListo(nombre, idPedido, total) {
  const importe = Number(total || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const saludo = nombre ? `Hola ${nombre}!` : 'Hola!';
  return `${saludo} Tu pedido #${idPedido} de Cruditas ya está listo para retirar. Total: $${importe}. ¡Te esperamos!`;
}

// Variable para conservar el id del pedido que se está viendo en el modal
let pedidoActualModalId = null;

// Vista del listado: 'PENDIENTES' (la de siempre al entrar: sin filtros, solo lo que falta
// hacer) o 'HISTORIAL' (la tabla con filtros de fecha, estado y búsqueda).
let modoPedidos = 'PENDIENTES';
let numeroConsultaPendientes = 0;   // descarta respuestas viejas si se cambia de vista a mitad de carga
const ESTADOS_PENDIENTES = ['PREPARACION', 'PREPARADO', 'ENTREGADO_IMPAGO'];   // los que NO son COMPLETADO ni ANULADO
const COLUMNAS_PEDIDO = 'id, fecha, created_at, estado, importe_total, nombre_referencia, observaciones, canal, telefono, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_BCUENTAS(nombre)';

// Entrar al listado desde el menú (o desde la campana): siempre arranca en Pendientes.
export function abrirListadoPedidos() {
  cambiarModoPedidos('PENDIENTES');
}

export function cambiarModoPedidos(modo) {
  modoPedidos = (modo === 'HISTORIAL') ? 'HISTORIAL' : 'PENDIENTES';
  const esPend = modoPedidos === 'PENDIENTES';

  document.getElementById('btn-modo-pendientes')?.classList.toggle('active', esPend);
  document.getElementById('btn-modo-pendientes')?.classList.toggle('btn-warning', esPend);
  document.getElementById('btn-modo-pendientes')?.classList.toggle('btn-outline-secondary', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('active', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('btn-info', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('btn-outline-secondary', esPend);

  document.getElementById('filtros-historial')?.classList.toggle('d-none', esPend);
  document.getElementById('kpis-historial')?.classList.toggle('d-none', esPend);
  document.getElementById('resumen-pendientes')?.classList.toggle('d-none', !esPend);
  document.getElementById('btn-actualizar-pendientes')?.classList.toggle('d-none', !esPend);
  if (!esPend) document.getElementById('btn-marcar-vistos')?.classList.add('d-none');

  return cargarTablaPedidos();
}

export async function cargarTablaPedidos() {
  if (modoPedidos === 'PENDIENTES') {
    await cargarPendientes();
    return;
  }

  const inputDesde = document.getElementById('filtro-fecha-desde');
  const inputHasta = document.getElementById('filtro-fecha-hasta');
  const inputBuscar = document.getElementById('filtro-buscar-pedido');
  
  if (inputDesde && !inputDesde.value) {
    const hoy = obtenerFechaActualISO(); // fecha local (Argentina), no UTC
    inputDesde.value = hoy;
    inputHasta.value = hoy;
  }

  // Se filtra por la columna "fecha" (día local), igual que el cierre de caja
  const fechaDesde = inputDesde.value;
  const fechaHasta = inputHasta.value;
  const estadoFiltro = document.getElementById('filtro-estado-pedido').value;

  let query = supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('id, fecha, created_at, estado, importe_total, nombre_referencia, observaciones, canal, telefono, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_BCUENTAS(nombre)')
    .gte('fecha', fechaDesde)
    .lte('fecha', fechaHasta)
    .order('id', { ascending: false });

  if (estadoFiltro !== 'TODOS') {
    query = query.eq('estado', estadoFiltro);
  }

  const { data: pedidos, error } = await query;
  if (error) {
    console.error('Error al cargar pedidos:', error);
    return;
  }

  let pedidosFiltrados = pedidos || [];
  if (inputBuscar && inputBuscar.value.trim() !== '') {
    const busqueda = inputBuscar.value.trim().toLowerCase();
    pedidosFiltrados = pedidosFiltrados.filter(p => {
      const cliNombre = p.TB_BCLIENTES?.nombre?.toLowerCase() || '';
      const idStr = String(p.id);
      return cliNombre.includes(busqueda) || idStr.includes(busqueda);
    });
  }

  let totalCobrado = 0;
  let totalPendienteCobro = 0;
  let cantPreparacion = 0;
  let cantPreparados = 0;
  let cantAnulados = 0;

  pedidosFiltrados.forEach(p => {
    if (p.estado === 'COMPLETADO') totalCobrado += (p.importe_total || 0);
    if (p.estado === 'ENTREGADO_IMPAGO') totalPendienteCobro += (p.importe_total || 0);
    if (p.estado === 'PREPARACION') cantPreparacion++;
    if (p.estado === 'PREPARADO') cantPreparados++;
    if (p.estado === 'ANULADO') cantAnulados++;
  });

  if (document.getElementById('kpi-total-cobrado')) {
    document.getElementById('kpi-total-cobrado').innerText = `$${totalCobrado.toLocaleString('es-AR')}`;
    document.getElementById('kpi-total-pendiente-cobro').innerText = `$${totalPendienteCobro.toLocaleString('es-AR')}`;
    document.getElementById('kpi-cant-preparacion').innerText = cantPreparacion;
    document.getElementById('kpi-cant-preparados').innerText = cantPreparados;
    document.getElementById('kpi-cant-anulados').innerText = cantAnulados;
  }

  const tbody = document.getElementById('tabla-pedidos-body');
  if (!tbody) return;

  if (pedidosFiltrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No hay pedidos registrados para estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = pedidosFiltrados.map(filaPedidoHtml).join('');
}

// Una fila de la tabla de pedidos. La usan las dos vistas (Pendientes e Historial).
function filaPedidoHtml(p) {
  const clienteNombre = p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final';
  const medioBase = p.TB_BMEDIO_PAGO ? p.TB_BMEDIO_PAGO.nombre : '';   // sin medio = todavía no se cobró
  const cuentaPago = p.TB_BCUENTAS?.nombre;
  // La cuenta se agrega solo si aporta algo (para efectivo, medio y cuenta se llaman igual)
  const mostrarCuenta = cuentaPago && cuentaPago.toLowerCase() !== medioBase.toLowerCase();
  // Celda armada como HTML (los textos pasan por esc()): el medio en su insignia y, debajo,
  // la cuenta en letra chica y gris. Sin medio (pedido sin cobrar) se muestra un guion.
  const medioPago = medioBase
    ? `<small class="badge badge-light border">${esc(medioBase)}</small>`
      + (mostrarCuenta ? `<div class="small text-muted">${esc(cuentaPago)}</div>` : '')
    : '<span class="text-muted">-</span>';
  // Marca del canal de venta (solo se muestra si no es MOSTRADOR, para no saturar la tabla)
  const badgeCanal = (p.canal && p.canal !== 'MOSTRADOR')
    ? ` <span class="badge badge-dark ml-1">${esc(p.canal)}</span>`
    : '';
  const nuevoSinVer = esPedidoNuevoSinVer(p);   // pedido web que este equipo todavía no vio
  const etiquetaNuevo = nuevoSinVer ? ' <span class="badge badge-danger ml-1">NUEVO</span>' : '';
  const hora = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const htmlObservaciones = p.observaciones 
  ? `<div class="mt-1"><span class="badge badge-warning text-dark border"><i class="fas fa-comment-alt mr-1"></i> ${esc(p.observaciones)}</span></div>` 
  : '';

  const fechaPedido = new Date(`${p.fecha.split('T')[0]}T00:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // En Pendientes, un pedido de un día anterior se marca en rojo (se quedó sin cerrar)
  const fechaAtrasada = modoPedidos === 'PENDIENTES' && p.fecha.split('T')[0] < obtenerFechaActualISO();

  let badgeClass = 'badge-secondary';
  let estadoTexto = p.estado;

  if (p.estado === 'PREPARACION') { badgeClass = 'badge-info'; estadoTexto = '⏳ En Preparación'; }
  if (p.estado === 'PREPARADO') { badgeClass = 'badge-primary'; estadoTexto = '🔔 Preparado'; }
  if (p.estado === 'ENTREGADO_IMPAGO') { badgeClass = 'badge-warning'; estadoTexto = '📦 Entregado (Impago)'; }
  if (p.estado === 'COMPLETADO') { badgeClass = 'badge-success'; estadoTexto = '✅ Completado'; }
  if (p.estado === 'ANULADO') { badgeClass = 'badge-danger'; estadoTexto = '🚫 Anulado'; }

  // BOTONES DE LA FILA
  // A la vista, con texto: solo lo que hace avanzar el pedido (preparar, cobrar, entregar).
  // Todo lo demás va dentro del menú "Más". Los data-action y las clases btn-print-*
  // son los de siempre, así que main.js y el escuchador de impresión (al final de este
  // archivo) siguen funcionando sin cambios. El menú "Más" se abre con menuMas.js.
  const idPed = p.id;
  const cambiar = (estado) => `data-action="cambiar-estado" data-id="${idPed}" data-estado="${estado}"`;
  const accionVer = `data-action="ver-detalle" data-id="${idPed}"`;
  const visibles = [];
  const enMenu = [];

  if (p.estado === 'PREPARACION') {
    visibles.push(btnFila('btn-accion-pagar', 'fa-box-open', 'Marcar preparado', cambiar('PREPARADO')));
  } else if (p.estado === 'PREPARADO') {
    visibles.push(btnFila('btn-accion-cobrar', 'fa-check', 'Cobrar y entregar', cambiar('COMPLETADO')));
    visibles.push(btnFila('btn-accion-aviso', 'fa-truck', 'Entregar sin cobrar', cambiar('ENTREGADO_IMPAGO')));
  } else if (p.estado === 'ENTREGADO_IMPAGO') {
    visibles.push(btnFila('btn-accion-cobrar', 'fa-dollar-sign', 'Registrar cobro', cambiar('COMPLETADO')));
  } else {
    // COMPLETADO o ANULADO: no queda nada por hacer, se deja a la vista la consulta
    visibles.push(btnFila('btn-accion-ver', 'fa-eye', 'Ver detalle', accionVer));
  }

  // Pedido web nuevo: botón para marcarlo como visto sin tener que abrirlo
  if (nuevoSinVer) {
    visibles.push(btnFila('btn-accion-ver', 'fa-eye', 'Visto', `data-action="marcar-visto" data-id="${idPed}"`));
  }

  // Menú "Más" (el orden es el que se ve en pantalla)
  // Pedido PREPARADO con teléfono válido: avisar al cliente por WhatsApp (opcional).
  const telWS = telefonoParaWhatsApp(p.telefono);
  if (p.estado === 'PREPARADO' && telWS) {
    enMenu.push(itemMenuMas(
      'fa-comment-dots',
      'Avisar por WhatsApp',
      `data-id="${idPed}" data-tel="${telWS}" data-nombre="${esc(nombreSinTelefono(p.nombre_referencia))}" data-total="${Number(p.importe_total || 0)}"`,
      'btn-avisar-ws'
    ));
  }
  if (visibles.length > 0 && p.estado !== 'COMPLETADO' && p.estado !== 'ANULADO') {
    enMenu.push(itemMenuMas('fa-eye', 'Ver detalle', accionVer));
  }
  if (p.estado === 'PREPARACION' || p.estado === 'PREPARADO') {
    enMenu.push(itemMenuMas('fa-edit', 'Editar pedido', `data-action="editar-pedido" data-id="${idPed}"`));
  }
  enMenu.push(itemMenuMas('fa-receipt', 'Comanda de cocina', `data-id="${idPed}"`, 'btn-print-cocina'));
  enMenu.push(itemMenuMas('fa-print', 'Ticket del cliente', `data-id="${idPed}"`, 'btn-print-cliente'));
  // Anular un pedido: solo Encargado y Dueño (la base también lo verifica).
  if (p.estado !== 'ANULADO' && puedeAlMenos('ENCARGADO')) {
    enMenu.push('<div class="menu-mas-sep" role="separator"></div>');
    enMenu.push(itemMenuMas('fa-ban', 'Anular pedido', cambiar('ANULADO'), 'menu-mas-peligro'));
  }

  const botonesAccion = `
    <div class="acciones-fila">
      ${visibles.join('')}
      <div class="mas-wrap">
        <button type="button" class="btn btn-accion btn-accion-mas" aria-haspopup="true" aria-expanded="false" title="Más acciones">
          Más <i class="fas fa-chevron-down"></i>
        </button>
        <div class="menu-mas" role="menu">${enMenu.join('')}</div>
      </div>
    </div>
  `;

  return `
    <tr class="${nuevoSinVer ? 'fila-pedido-nuevo' : ''}">
      <td class="font-weight-bold">#${p.id}</td>
      <td class="${fechaAtrasada ? 'fecha-atrasada' : ''}">${fechaPedido} ${hora} hs</td>
      <td>
        <div class="font-weight-bold">${esc(clienteNombre)}${badgeCanal}${etiquetaNuevo}</div>
        ${htmlObservaciones}
      </td>
      <td>${medioPago}</td>
      <td class="text-right font-weight-bold">$${(p.importe_total || 0).toLocaleString('es-AR')}</td>
      <td class="text-center"><span class="badge ${badgeClass} p-2">${esc(estadoTexto)}</span></td>
      <td class="text-center">${botonesAccion}</td>
    </tr>
  `;
}

// =============================================================================
// VISTA "PENDIENTES": todo lo que no está COMPLETADO ni ANULADO, sin filtros de fecha
// ni de estado. Agrupado por estado y, dentro de cada grupo, el más antiguo primero.
// =============================================================================
const GRUPOS_PENDIENTES = [
  { estado: 'PREPARACION', titulo: '⏳ En preparación' },
  { estado: 'PREPARADO', titulo: '🔔 Listos para entregar' },
  { estado: 'ENTREGADO_IMPAGO', titulo: '📦 Entregados sin cobrar' }
];

async function cargarPendientes() {
  const numero = ++numeroConsultaPendientes;

  const { data, error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select(COLUMNAS_PEDIDO)
    .in('estado', ESTADOS_PENDIENTES)
    .order('created_at', { ascending: true })
    .limit(500);

  // Si mientras tanto se pidió otra carga o se cambió de vista, esta respuesta ya no sirve.
  if (numero !== numeroConsultaPendientes || modoPedidos !== 'PENDIENTES') return;

  if (error) {
    console.error('Error al cargar pedidos pendientes:', error);
    mostrarNotificacion('No se pudieron cargar los pedidos pendientes.', 'danger');
    return;
  }

  const pedidos = data || [];
  const porEstado = (estado) => pedidos.filter(p => p.estado === estado);
  const cantPrep = porEstado('PREPARACION').length;
  const cantListos = porEstado('PREPARADO').length;
  const impagos = porEstado('ENTREGADO_IMPAGO');
  const porCobrar = impagos.reduce((acc, p) => acc + Number(p.importe_total || 0), 0);

  const resumen = document.getElementById('resumen-pendientes');
  if (resumen) {
    resumen.textContent = pedidos.length === 0
      ? ''
      : `${cantPrep} en preparación · ${cantListos} listo${cantListos !== 1 ? 's' : ''} para entregar · `
        + `${impagos.length} entregado${impagos.length !== 1 ? 's' : ''} sin cobrar`
        + (impagos.length > 0 ? ` ($${porCobrar.toLocaleString('es-AR')} por cobrar)` : '');
  }

  const sinVer = pedidos.filter(esPedidoNuevoSinVer).length;
  document.getElementById('btn-marcar-vistos')?.classList.toggle('d-none', sinVer === 0);

  const tbody = document.getElementById('tabla-pedidos-body');
  if (!tbody) return;

  if (pedidos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success mr-1"></i> No hay pedidos pendientes. Todo al día.</td></tr>`;
    return;
  }

  tbody.innerHTML = GRUPOS_PENDIENTES.map(g => {
    const delGrupo = porEstado(g.estado);
    if (delGrupo.length === 0) return '';
    return `<tr class="fila-grupo-estado"><td colspan="7">${g.titulo} (${delGrupo.length})</td></tr>`
      + delGrupo.map(filaPedidoHtml).join('');
  }).join('');
}

// Botón "Visto" de una fila y botón "Marcar pedidos web como vistos"
export function marcarPedidoVisto(idPedido) {
  marcarVistos([idPedido]);
  cargarTablaPedidos();
}

export function marcarTodosLosPedidosVistos() {
  marcarTodosVistos();
  cargarTablaPedidos();
}

// Refresco automático cuando otro equipo (o un cliente desde la web) cambia pedidos.
// Si hay un menú "Más" abierto no se redibuja la tabla (se cerraría en la cara de la persona):
// se espera unos segundos y se vuelve a intentar.
function hayMenuMasAbierto() {
  if (document.querySelector('.btn-accion-mas[aria-expanded="true"]')) return true;
  return [...document.querySelectorAll('.menu-mas')].some(m => {
    const est = getComputedStyle(m);
    return est.display !== 'none' && est.visibility !== 'hidden' && est.opacity !== '0' && m.getClientRects().length > 0;
  });
}

let temporizadorRefresco = null;
function programarRefrescoListado(espera = 500, intentos = 0) {
  clearTimeout(temporizadorRefresco);
  temporizadorRefresco = setTimeout(() => {
    const sec = document.getElementById('sec-pedidos-dia');
    if (!sec || sec.classList.contains('d-none')) return;   // la pantalla no está a la vista
    if (hayMenuMasAbierto() && intentos < 6) { programarRefrescoListado(4000, intentos + 1); return; }
    cargarTablaPedidos();
  }, espera);
}
document.addEventListener('pedidos:cambio', () => programarRefrescoListado());

export async function cambiarEstadoPedido(idPedido, nuevoEstado) {
  marcarVistos([idPedido]);   // si la persona actúa sobre un pedido web, ya lo vio

  // Cobrar: antes de marcar COMPLETADO preguntamos con qué medio se cobra.
  // La ventana se encarga de guardar el estado y el medio juntos.
  if (nuevoEstado === 'COMPLETADO') {
    await cobrarPedido(idPedido);
    return;
  }

  // El servidor valida que la transición esté permitida (cambiar_estado_pedido, script 24).
  const { error } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
    p_id_pedido: Number(idPedido),
    p_nuevo_estado: nuevoEstado
  });

  if (error) {
    // La base puede rechazar el cambio con un código (por ejemplo, si la caja del día ya está cerrada)
    // y mensajeErrorFuncion lo traduce a un mensaje claro.
    mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
  } else {
    cargarTablaPedidos();
  }
}

// =============================================================================
// COBRO DE UN PEDIDO YA CARGADO
// La ventana (medio, cuenta, vuelto) vive en cobro.js y es la MISMA que usa el POS.
// Acá solo preparamos los datos del pedido y le decimos qué hacer al confirmar.
// =============================================================================
async function cobrarPedido(idPedido) {
  // Traemos el pedido con sus renglones (para contar las unidades).
  const { data: pedido, error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('id, estado, importe_total, nombre_referencia, TB_BCLIENTES(nombre), TB_DPEDIDOS(id_producto, cantidad)')
    .eq('id', idPedido)
    .single();

  if (error || !pedido) {
    mostrarNotificacion('No se pudo cargar el pedido para cobrarlo.', 'danger');
    return;
  }

  // Unidades = suma de cantidades SIN el renglón de descuento (producto 999: su
  // cantidad son docenas, no unidades).
  const unidades = (pedido.TB_DPEDIDOS || [])
    .filter(r => Number(r.id_producto) !== 999)
    .reduce((acc, r) => acc + Number(r.cantidad), 0);

  const cliente = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';

  await abrirModalCobro({
    // Un pedido ya entregado impago no se "entrega" de nuevo: solo se cobra.
    titulo: pedido.estado === 'ENTREGADO_IMPAGO' ? 'Registrar cobro' : 'Cobrar y Entregar',
    subtitulo: `Pedido #${pedido.id} · ${cliente}`,
    total: pedido.importe_total,
    unidades,
    // Callback: la ventana lo llama al confirmar. true = se guardó (la ventana se cierra).
    alConfirmar: async (idMedio, idCuenta) => {
      // Estado, medio y cuenta van en la MISMA llamada: se guardan juntos o no se guarda nada.
      const { error: errorCobro } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
        p_id_pedido: Number(pedido.id),
        p_nuevo_estado: 'COMPLETADO',
        p_id_medio: idMedio,
        p_id_cuenta: idCuenta
      });

      if (errorCobro) {
        // Por ejemplo, si la caja de ese día ya está cerrada.
        mostrarNotificacion(mensajeErrorFuncion(errorCobro, 'pedido'), 'danger');
        return false;
      }

      mostrarNotificacion('Cobro registrado.');
      cargarTablaPedidos();
      return true;
    }
  });
}

export async function editarPedido(idPedido) {
  marcarVistos([idPedido]);
  try {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('*, TB_DPEDIDOS(id_producto, cantidad)')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) {
      mostrarNotificacion('Error al cargar el pedido para edición', 'danger');
      return;
    }

    setPedidoEditandoId(pedido.id);
    setPedidoEditandoEstado(pedido.estado);   // PREPARACION o PREPARADO: el POS lo muestra y lo conserva al guardar
    actualizarModoEdicionPOS();

    const linkPedidos = document.querySelector('#menu-navegacion .nav-link[data-section="pedidos"]');
    navegarA('pedidos', linkPedidos);

    // navegarA arranca inicializarPOS(), que reconstruye los selects (cliente,
    // lista, medio de pago) cuando le llegan los datos de la base. Si pusiéramos
    // los valores del pedido antes de que termine, esa reconstrucción los pisaría.
    // Por eso esperamos acá.
    await esperarPOSListo();

    // Cliente. El cliente usa Select2, que dibuja su propio cuadro encima del
    // <select>: cambiar solo .value no actualiza lo que se ve.
    // trigger('change.select2') le avisa SOLO a Select2 (el sufijo ".select2" es
    // un "espacio de nombres" del evento), sin disparar alCambiarCliente por su cuenta.
    if (document.getElementById('select-cliente-pedido')) {
      $('#select-cliente-pedido').val(pedido.id_cliente).trigger('change.select2');
      // Esperamos a alCambiarCliente para que ajuste la etiqueta de "Referencia"
      // según el cliente. También pone la lista predeterminada: la pisamos abajo.
      await alCambiarCliente();
    }

    // Lista de precios del pedido (la que se usó al crearlo, no la predeterminada).
    // El "if" evita escribir null en pedidos viejos sin lista.
    const selectLista = document.getElementById('select-lista-pedido');
    if (selectLista && pedido.id_lista_precio) selectLista.value = pedido.id_lista_precio;

    // Referencia: va DESPUÉS de alCambiarCliente porque esa función la limpia.
    const inputRef = document.getElementById('input-ref-cliente');
    if (inputRef) inputRef.value = pedido.nombre_referencia || '';


    // Recarga los precios con la lista del pedido
    await cargarPOS();

    const nuevoCarrito = {};
    (pedido.TB_DPEDIDOS || []).forEach(item => {
      const idProd = item.id_producto;
      if (Number(idProd) === 999) return; // el descuento por docena se recalcula al guardar
      nuevoCarrito[idProd] = (nuevoCarrito[idProd] || 0) + item.cantidad;
    });
    setCarrito(nuevoCarrito);

    renderizarGrillaPOS();
    actualizarModoEdicionPOS();
    mostrarNotificacion(`Editando Pedido #${pedido.id}`, 'info');

  } catch (err) {
    console.error('Error en editarPedido:', err);
    mostrarNotificacion('Ocurrió un error al intentar editar el pedido.', 'danger');
  }
}

export async function verDetallePedido(idPedido) {
  try {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('*, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_BCUENTAS(nombre), TB_DPEDIDOS(cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(nombre, TB_BCATEGORIAS(nombre)))')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) return;

    // Abrir el detalle de un pedido web nuevo lo da por visto (y se quita la marca NUEVO de la fila).
    if (esPedidoNuevoSinVer(pedido)) {
      marcarVistos([pedido.id]);
      cargarTablaPedidos();
    }

    pedidoActualModalId = idPedido;

    const formatearMoneda = (val) => Number(val || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    document.getElementById('detalle-id-pedido').innerText = pedido.id;
    const medioDetalle = pedido.TB_BMEDIO_PAGO?.nombre || '';   // sin medio = todavía no se cobró
    const cuentaDetalle = pedido.TB_BCUENTAS?.nombre;
    // Medio arriba y, debajo en letra chica y gris, la cuenta (solo si aporta algo). Sin medio: "Sin especificar".
    const detalleMostrarCuenta = cuentaDetalle && cuentaDetalle.toLowerCase() !== medioDetalle.toLowerCase();
    document.getElementById('detalle-medio-pago').innerHTML =
      medioDetalle
        ? esc(medioDetalle) + (detalleMostrarCuenta ? `<small class="d-block text-muted font-weight-normal">${esc(cuentaDetalle)}</small>` : '')
        : '<span class="text-muted font-weight-normal">Sin especificar</span>';
    document.getElementById('detalle-monto-total').innerText = `$${formatearMoneda(pedido.importe_total)}`;

    const clienteNombre = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';
    document.getElementById('detalle-cliente').innerHTML = `
      <span class="badge badge-warning text-dark px-2 py-1 font-weight-bold" style="font-size: 0.95rem;">
        <i class="fas fa-user mr-1"></i> ${esc(clienteNombre)}
      </span>
      ${pedido.canal && pedido.canal !== 'MOSTRADOR' ? `<span class="badge badge-dark ml-1">${esc(pedido.canal)}</span>` : ''}
    `;

    const btnImprimirCocina = document.getElementById('btn-imprimir-cocina');
    if (btnImprimirCocina) btnImprimirCocina.onclick = async () => {
      if (!pedidoActualModalId) return;
      const pedidoObj = await obtenerPedidoParaImprimir(pedidoActualModalId);
      imprimirComprobante(pedidoObj, true);
    };

    const btnImprimirCliente = document.getElementById('btn-imprimir-cliente');
    if (btnImprimirCliente) btnImprimirCliente.onclick = async () => {
      if (!pedidoActualModalId) return;
      const pedidoObj = await obtenerPedidoParaImprimir(pedidoActualModalId);
      imprimirComprobante(pedidoObj, false);
    };
    
    const items = pedido.TB_DPEDIDOS || [];
    const htmlItems = items.length > 0 
      ? items.map(item => {
          const esDocena = item.cantidad >= 12 && (item.cantidad % 12 === 0);
          const etiquetaCant = esDocena ? `${item.cantidad / 12} doc.` : `${item.cantidad} u.`;
          const nombreCategoria = item.TB_BPRODUCTOS?.TB_BCATEGORIAS?.nombre || '';
          
          return `
            <tr>
              <td>
                <span class="badge badge-light border mr-1">${esc(nombreCategoria)}</span>
                <strong>${esc(item.TB_BPRODUCTOS?.nombre || 'Producto')}</strong>
              </td>
              <td class="text-center font-weight-bold">${etiquetaCant}</td>
              <td class="text-right text-muted">$${formatearMoneda(item.precioUnitario)} <small class="text-secondary">${esDocena ? '/doc' : '/u'}</small></td>
              <td class="text-right font-weight-bold">$${formatearMoneda(item.subTotal)}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="4" class="text-center text-muted py-3">No hay ítems registrados.</td></tr>`;

    document.getElementById('tabla-detalle-body').innerHTML = htmlItems;
    $('#modalDetallePedido').modal('show');
  
    if (document.getElementById('detalle-observaciones')) {
    document.getElementById('detalle-observaciones').innerText = pedido.observaciones || 'Sin observaciones';
    }

  } catch (err) {
    console.error('Error al cargar detalle del pedido:', err);
    mostrarNotificacion('Ocurrió un error al cargar el detalle.', 'danger');
  }
}

// =========================================================================
// ESCUCHADOR DE EVENTOS DE IMPRESIÓN DIRECTA EN LA TABLA
// =========================================================================
document.getElementById('tabla-pedidos-body')?.addEventListener('click', async (e) => {
  // Avisar por WhatsApp: va primero y sin "await" antes, para que el navegador no bloquee la ventana nueva.
  const btnAvisar = e.target.closest('.btn-avisar-ws');
  if (btnAvisar) {
    const d = btnAvisar.dataset;
    const texto = mensajePedidoListo(d.nombre, d.id, d.total);
    window.open(`https://wa.me/${d.tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    return;
  }

  const btnCocina = e.target.closest('.btn-print-cocina');
  if (btnCocina) {
    const idPedido = btnCocina.dataset.id;
    const pedidoObj = await obtenerPedidoParaImprimir(idPedido);
    if (pedidoObj) imprimirComprobante(pedidoObj, true);
    return;
  }

  const btnCliente = e.target.closest('.btn-print-cliente');
  if (btnCliente) {
    const idPedido = btnCliente.dataset.id;
    const pedidoObj = await obtenerPedidoParaImprimir(idPedido);
    if (pedidoObj) imprimirComprobante(pedidoObj, false);
    return;
  }
});
