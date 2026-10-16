import { supabaseAdmin } from './config.js';
import { setPedidoEditandoId, setCarrito } from './state.js';
import { mostrarNotificacion, obtenerFechaActualISO, mensajeErrorFuncion, formatearMoneda } from './utils.js';
import { cargarPOS, renderizarGrillaPOS, alCambiarCliente, esperarPOSListo } from './pos.js';
import { navegarA } from './main.js';
import { obtenerPedidoParaImprimir, imprimirComprobante } from './impresion.js';

// Escapa texto antes de insertarlo con innerHTML (evita inyección de HTML/JS).
// nombre_referencia y observaciones los escribe un cliente anónimo desde la web.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Variable para conservar el id del pedido que se está viendo en el modal
let pedidoActualModalId = null;

export async function cargarTablaPedidos() {
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
    .select('id, fecha, created_at, estado, importe_total, nombre_referencia, observaciones, canal, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre)')
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

  tbody.innerHTML = pedidosFiltrados.map(p => {
    const clienteNombre = p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final';
    const medioPago = p.TB_BMEDIO_PAGO ? p.TB_BMEDIO_PAGO.nombre : 'Efectivo';
    // Marca del canal de venta (solo se muestra si no es MOSTRADOR, para no saturar la tabla)
    const badgeCanal = (p.canal && p.canal !== 'MOSTRADOR')
      ? ` <span class="badge badge-dark ml-1">${esc(p.canal)}</span>`
      : '';
    const hora = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const htmlObservaciones = p.observaciones 
    ? `<div class="mt-1"><span class="badge badge-warning text-dark border"><i class="fas fa-comment-alt mr-1"></i> ${esc(p.observaciones)}</span></div>` 
    : '';

    const fechaPedido = new Date(`${p.fecha.split('T')[0]}T00:00:00`).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    let badgeClass = 'badge-secondary';
    let estadoTexto = p.estado;

    if (p.estado === 'PREPARACION') { badgeClass = 'badge-info'; estadoTexto = '⏳ En Preparación'; }
    if (p.estado === 'PREPARADO') { badgeClass = 'badge-primary'; estadoTexto = '🔔 Preparado'; }
    if (p.estado === 'ENTREGADO_IMPAGO') { badgeClass = 'badge-warning'; estadoTexto = '📦 Entregado (Impago)'; }
    if (p.estado === 'COMPLETADO') { badgeClass = 'badge-success'; estadoTexto = '✅ Completado'; }
    if (p.estado === 'ANULADO') { badgeClass = 'badge-danger'; estadoTexto = '🚫 Anulado'; }

    let botonesAccion = '';

    if (p.estado === 'PREPARACION') {
      botonesAccion += `
        <button class="btn btn-outline-primary" title="Marcar como Preparado" data-action="cambiar-estado" data-id="${p.id}" data-estado="PREPARADO">
          <i class="fas fa-box-open"></i>
        </button>
        <button class="btn btn-outline-secondary" title="Editar Pedido" data-action="editar-pedido" data-id="${p.id}">
          <i class="fas fa-edit"></i>
        </button>
      `;
    }

    if (p.estado === 'PREPARADO') {
      botonesAccion += `
        <button class="btn btn-outline-success" title="Cobrar y Entregar" data-action="cambiar-estado" data-id="${p.id}" data-estado="COMPLETADO">
          <i class="fas fa-check"></i>
        </button>
        <button class="btn btn-outline-warning" title="Entregar sin Cobrar (Impago)" data-action="cambiar-estado" data-id="${p.id}" data-estado="ENTREGADO_IMPAGO">
          <i class="fas fa-truck"></i>
        </button>
        <button class="btn btn-outline-secondary" title="Editar Pedido" data-action="editar-pedido" data-id="${p.id}">
          <i class="fas fa-edit"></i>
        </button>
      `;
    }

    if (p.estado === 'ENTREGADO_IMPAGO') {
      botonesAccion += `
        <button class="btn btn-outline-success" title="Registrar Cobro" data-action="cambiar-estado" data-id="${p.id}" data-estado="COMPLETADO">
          <i class="fas fa-dollar-sign"></i>
        </button>
      `;
    }

    if (p.estado !== 'ANULADO') {
      botonesAccion += `
        <button class="btn btn-outline-danger" title="Anular Pedido" data-action="cambiar-estado" data-id="${p.id}" data-estado="ANULADO">
          <i class="fas fa-ban"></i>
        </button>
      `;
    }

    botonesAccion += `
      <button class="btn btn-outline-info" title="Ver detalle" data-action="ver-detalle" data-id="${p.id}">
        <i class="fas fa-eye"></i>
      </button>
    `;

    // BOTONES DE IMPRESIÓN DIRECTA EN LA TABLA
    botonesAccion += `
      <button class="btn btn-outline-dark btn-print-cocina" title="Imprimir Comanda Cocina" data-id="${p.id}">
        <i class="fas fa-receipt"></i>
      </button>
      <button class="btn btn-outline-primary btn-print-cliente" title="Imprimir Ticket Cliente" data-id="${p.id}">
        <i class="fas fa-print"></i>
      </button>
    `;

    return `
      <tr>
        <td class="font-weight-bold">#${p.id}</td>
        <td>${fechaPedido} ${hora} hs</td>
        <td>
          <div class="font-weight-bold">${esc(clienteNombre)}${badgeCanal}</div>
          ${htmlObservaciones}
        </td>
        <td><small class="badge badge-light border">${esc(medioPago)}</small></td>
        <td class="text-right font-weight-bold">$${(p.importe_total || 0).toLocaleString('es-AR')}</td>
        <td class="text-center"><span class="badge ${badgeClass} p-2">${esc(estadoTexto)}</span></td>
        <td class="text-center">
          <div class="btn-group btn-group-sm">
            ${botonesAccion}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

export async function cambiarEstadoPedido(idPedido, nuevoEstado) {
  // Cobrar: antes de marcar COMPLETADO preguntamos con qué medio se cobra.
  // La ventana se encarga de guardar el estado y el medio juntos.
  if (nuevoEstado === 'COMPLETADO') {
    await abrirModalCobro(idPedido);
    return;
  }

  const { error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .update({ estado: nuevoEstado })
    .eq('id', idPedido);

  if (error) {
    // La base puede rechazar el cambio con un código (por ejemplo, si la caja del día ya está cerrada)
    // y mensajeErrorFuncion lo traduce a un mensaje claro.
    mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
  } else {
    cargarTablaPedidos();
  }
}

// =============================================================================
// COBRO DE UN PEDIDO YA CARGADO (elegir el medio de pago en el momento del cobro)
// =============================================================================

// Id del pedido que se está cobrando. Vive afuera de las funciones para que
// la ventana (abrir) y el envío del formulario (confirmar) compartan el dato.
let pedidoCobroId = null;

// Arma la ventana: trae el pedido y la lista de medios de pago, y propone el
// medio con el que se cargó el pedido.
async function abrirModalCobro(idPedido) {
  // Promise.all lanza las dos consultas AL MISMO TIEMPO y espera a que terminen
  // ambas (más rápido que pedirlas una después de la otra).
  const [resPedido, resMedios] = await Promise.all([
    supabaseAdmin.from('TB_TPEDIDOS')
      .select('id, importe_total, id_medio_pago, nombre_referencia, TB_BCLIENTES(nombre)')
      .eq('id', idPedido)
      .single(),
    supabaseAdmin.from('TB_BMEDIO_PAGO').select('id, nombre').order('id')
  ]);

  if (resPedido.error || !resPedido.data || resMedios.error) {
    mostrarNotificacion('No se pudo cargar el pedido para cobrarlo.', 'danger');
    return;
  }

  const pedido = resPedido.data;
  pedidoCobroId = pedido.id;

  // textContent escribe texto plano: no hace falta escapar.
  document.getElementById('cobro-id-pedido').textContent = pedido.id;
  document.getElementById('cobro-cliente').textContent =
    pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';
  document.getElementById('cobro-total').textContent = formatearMoneda(pedido.importe_total);

  // Opciones del select. Como van en innerHTML, el nombre pasa por esc().
  const select = document.getElementById('cobro-medio-pago');
  select.innerHTML = resMedios.data
    .map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`)
    .join('');
  // Proponemos el medio original del pedido (si todavía existe en la lista).
  if (pedido.id_medio_pago) select.value = pedido.id_medio_pago;

  $('#modal-cobro-pedido').modal('show');
}

// Se ejecuta al enviar el formulario de la ventana (botón "Confirmar cobro").
export async function confirmarCobroPedido(e) {
  e.preventDefault();
  if (!pedidoCobroId) return;

  const idMedio = Number(document.getElementById('cobro-medio-pago').value);
  if (!idMedio) {
    mostrarNotificacion('Elegí un medio de pago.', 'warning');
    return;
  }

  // Desactivamos el botón para evitar un doble clic que cobre dos veces.
  const btn = document.getElementById('btn-confirmar-cobro');
  btn.disabled = true;

  // try / finally: el bloque "finally" se ejecuta SIEMPRE al salir (haya error
  // o no), así el botón nunca queda trabado.
  try {
    // Estado y medio van en la MISMA actualización: se guardan juntos o no se guarda nada.
    const { error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .update({ estado: 'COMPLETADO', id_medio_pago: idMedio })
      .eq('id', pedidoCobroId);

    if (error) {
      // Por ejemplo, si la caja de ese día ya está cerrada.
      mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
      return;
    }

    $('#modal-cobro-pedido').modal('hide');
    pedidoCobroId = null;
    mostrarNotificacion('Cobro registrado.');
    cargarTablaPedidos();
  } finally {
    btn.disabled = false;
  }
}

export async function editarPedido(idPedido) {
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

    const selectMedio = document.getElementById('select-medio-pago');
    if (selectMedio && pedido.id_medio_pago) selectMedio.value = pedido.id_medio_pago;

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
      .select('*, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_DPEDIDOS(cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(nombre, TB_BCATEGORIAS(nombre)))')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) return;

    pedidoActualModalId = idPedido;

    const formatearMoneda = (val) => Number(val || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    document.getElementById('detalle-id-pedido').innerText = pedido.id;
    document.getElementById('detalle-medio-pago').innerText = pedido.TB_BMEDIO_PAGO?.nombre || 'Sin especificar';
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