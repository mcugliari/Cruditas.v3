import { supabaseClient } from './config.js';
import { setPedidoEditandoId, setCarrito } from './state.js';
import { mostrarNotificacion } from './utils.js';
import { cargarPOS, renderizarGrillaPOS } from './pos.js';
import { navegarA } from './main.js';

export async function cargarTablaPedidos() {
  const inputDesde = document.getElementById('filtro-fecha-desde');
  const inputHasta = document.getElementById('filtro-fecha-hasta');
  const inputBuscar = document.getElementById('filtro-buscar-pedido');
  
  if (inputDesde && !inputDesde.value) {
    const hoy = new Date().toISOString().split('T')[0];
    inputDesde.value = hoy;
    inputHasta.value = hoy;
  }

  const fechaDesde = `${inputDesde.value}T00:00:00.000Z`;
  const fechaHasta = `${inputHasta.value}T23:59:59.999Z`;
  const estadoFiltro = document.getElementById('filtro-estado-pedido').value;

  let query = supabaseClient
    .from('TB_TPEDIDOS')
    .select('id, fecha, created_at, estado, importe_total, nombre_referencia, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre)')
    .gte('created_at', fechaDesde)
    .lte('created_at', fechaHasta)
    .order('id', { ascending: false });

  if (estadoFiltro !== 'TODOS') {
    query = query.eq('estado', estadoFiltro);
  }

  const { data: pedidos, error } = await query;
  if (error) return;

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
    //const clienteNombre = p.TB_BCLIENTES ? p.TB_BCLIENTES.nombre : 'Consumidor Final';
    const clienteNombre = p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final';
    const medioPago = p.TB_BMEDIO_PAGO ? p.TB_BMEDIO_PAGO.nombre : 'Sin especificar';
    const hora = new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
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

    return `
      <tr>
        <td class="font-weight-bold">#${p.id}</td>
        <td>${fechaPedido} ${hora} hs</td>
        <td class="font-weight-bold">${clienteNombre}</td>
        <td><small class="badge badge-light border">${medioPago}</small></td>
        <td class="text-right font-weight-bold">$${(p.importe_total || 0).toLocaleString('es-AR')}</td>
        <td class="text-center"><span class="badge ${badgeClass} p-2">${estadoTexto}</span></td>
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
  if (nuevoEstado === 'ANULADO' && !confirm('¿Seguro que deseas anular este pedido? Se excluirá del cierre de caja.')) {
    return;
  }

  const { error } = await supabaseClient
    .from('TB_TPEDIDOS')
    .update({ estado: nuevoEstado })
    .eq('id', idPedido);

  if (error) {
    mostrarNotificacion('Error al cambiar el estado: ' + error.message, 'danger');
  } else {
    cargarTablaPedidos();
  }
}

export async function editarPedido(idPedido) {
  try {
    const { data: pedido, error } = await supabaseClient
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

    if (document.getElementById('select-cliente-pedido')) {
      document.getElementById('select-cliente-pedido').value = pedido.id_cliente;

    // CARGAR LA REFERENCIA/NOMBRE GUARDADO
    const inputRef = document.getElementById('input-ref-cliente');
    if (inputRef) {
      inputRef.value = pedido.nombre_referencia || '';
    }
    }
    if (document.getElementById('select-lista-pedido')) {
      document.getElementById('select-lista-pedido').value = pedido.id_lista_precio;
    }
    if (document.getElementById('select-medio-pago') && pedido.id_medio_pago) {
      document.getElementById('select-medio-pago').value = pedido.id_medio_pago;
    }

    await cargarPOS();

    const nuevoCarrito = {};
    (pedido.TB_DPEDIDOS || []).forEach(item => {
      const idProd = item.id_producto;
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
    const { data: pedido, error } = await supabaseClient
      .from('TB_TPEDIDOS')
      .select('*, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_DPEDIDOS(cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(nombre, TB_BCATEGORIAS(nombre)))')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) return;

    const formatearMoneda = (val) => Number(val || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    document.getElementById('detalle-id-pedido').innerText = pedido.id;
    document.getElementById('detalle-medio-pago').innerText = pedido.TB_BMEDIO_PAGO?.nombre || 'Sin especificar';
    document.getElementById('detalle-monto-total').innerText = `$${formatearMoneda(pedido.importe_total)}`;
    document.getElementById('detalle-cliente').innerText = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';

    const items = pedido.TB_DPEDIDOS || [];
    const htmlItems = items.length > 0 
      ? items.map(item => {
          const esDocena = item.cantidad >= 12 && (item.cantidad % 12 === 0);
          const etiquetaCant = esDocena ? `${item.cantidad / 12} doc.` : `${item.cantidad} u.`;
          const nombreCategoria = item.TB_BPRODUCTOS?.TB_BCATEGORIAS?.nombre || '';
          
          return `
            <tr>
              <td>
                <span class="badge badge-light border mr-1">${nombreCategoria}</span>
                <strong>${item.TB_BPRODUCTOS?.nombre || 'Producto'}</strong>
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

  } catch (err) {
    console.error('Error al cargar detalle del pedido:', err);
    mostrarNotificacion('Ocurrió un error al cargar el detalle.', 'danger');
  }
}