import { supabaseClient } from './config.js';

let cacheCategorias = [];
let cacheProductos = [];
let cachePrecios = [];
let carrito = {}; // { id_producto: cantidad }

// Constantes de configuración por defecto
const ID_CLIENTE_CONSUMIDOR_FINAL = 1;
const ID_LISTA_MINORISTA = 1;
const ID_MEDIO_PAGO_EFECTIVO = 1;

document.addEventListener('DOMContentLoaded', async () => {
  await cargarDatosMenu();

  // Al abrir el modal de confirmación, autocompletar datos URL y renderizar el desglose
  $('#modalConfirmarCliente').on('show.bs.modal', function () {
    const params = new URLSearchParams(window.location.search);
    const telParam = params.get('tel');
    const nombreParam = params.get('nombre');

    if (telParam && document.getElementById('cliente-telefono')) {
      document.getElementById('cliente-telefono').value = telParam;
    }
    if (nombreParam && document.getElementById('cliente-nombre')) {
      document.getElementById('cliente-nombre').value = nombreParam;
    }

    renderizarResumenEnModalCliente();
  });

  document.getElementById('btn-confirmar-pedido')?.addEventListener('click', () => {
    $('#modalConfirmarCliente').modal('show');
  });

  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', enviarPedidoASupabase);
});

async function cargarDatosMenu() {
  const contenedor = document.getElementById('contenedor-productos-cliente');

  try {
    const [{ data: categorias }, { data: productos }, { data: precios }] = await Promise.all([
      supabaseClient.from('TB_BCATEGORIAS').select('*').order('id'),
      supabaseClient.from('TB_BPRODUCTOS').select('*').order('id'),
      supabaseClient.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', ID_LISTA_MINORISTA)
    ]);

    cacheCategorias = categorias || [];
    cacheProductos = productos || [];
    cachePrecios = precios || [];

    if (cacheProductos.length === 0) {
      if (contenedor) {
        contenedor.innerHTML = '<p class="text-center text-muted my-4">No hay productos disponibles en este momento.</p>';
      }
      return;
    }

    renderizarMenuPorCategorias();

  } catch (err) {
    console.error('Error al cargar datos del menú para clientes:', err);
    if (contenedor) {
      contenedor.innerHTML = '<p class="text-danger text-center my-4">Error al conectar con la base de datos.</p>';
    }
  }
}

function renderizarMenuPorCategorias() {
  const contenedor = document.getElementById('contenedor-productos-cliente');
  if (!contenedor) return;

  const paletaColores = [
    { bg: '#0d6efd', text: '#ffffff' },
    { bg: '#198754', text: '#ffffff' },
    { bg: '#ffc107', text: '#000000' },
    { bg: '#dc3545', text: '#ffffff' },
    { bg: '#0dcaf0', text: '#000000' },
    { bg: '#6c757d', text: '#ffffff' }
  ];

  let html = '';
  let colorIndex = 0;

  cacheCategorias.forEach(cat => {
    // Omitir categoría de ajuste/sistema
    if (Number(cat.id) === 99) return;

    // Filtrar producto bonificación 999
    const prodsCat = cacheProductos.filter(p => 
      Number(p.id_categoria || p.idCategoria) === Number(cat.id) && Number(p.id) !== 999
    );
    if (prodsCat.length === 0) return;

    const estiloColor = paletaColores[colorIndex % paletaColores.length];
    colorIndex++;

    html += `
      <div class="mb-4">
        <div class="p-2 px-3 mb-2 font-weight-bold text-uppercase shadow-sm" 
             style="background-color: ${estiloColor.bg}; color: ${estiloColor.text}; border-radius: 8px; font-size: 0.95rem; letter-spacing: 0.5px;">
          ${cat.nombre}
        </div>
    `;

    prodsCat.forEach(p => {
      const cant = carrito[p.id] || 0;
      const idCatProd = p.id_categoria || p.idCategoria;
      const precios = obtenerPrecioProductoCliente(p.id, idCatProd);

      let textoPrecio = `$${precios.unidad.toLocaleString('es-AR')} <small class="text-muted">/u</small>`;
      if (p.m_permite_docena && precios.docena) {
        textoPrecio += ` <span class="badge badge-light border text-dark ml-1">$${precios.docena.toLocaleString('es-AR')} doc.</span>`;
      }

      html += `
        <div class="card card-prod p-3 shadow-sm mb-2" style="border: none; border-radius: 10px; border-left: 4px solid ${estiloColor.bg};">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <h6 class="font-weight-bold m-0 text-dark">${p.nombre}</h6>
              <div class="text-success font-weight-bold small mt-1">${textoPrecio}</div>
            </div>
            <div class="d-flex align-items-center">
              <button class="btn btn-outline-secondary btn-qty btn-restar" data-id="${p.id}">-</button>
              <span class="font-weight-bold px-3">${cant}</span>
              <button class="btn btn-warning btn-qty btn-sumar" data-id="${p.id}">+</button>
            </div>
          </div>
        </div>
      `;
    });

    html += `</div>`;
  });

  contenedor.innerHTML = html;

  contenedor.querySelectorAll('.btn-sumar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), 1);
  });
  contenedor.querySelectorAll('.btn-restar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), -1);
  });

  actualizarBarraCarrito();
}

function obtenerPrecioProductoCliente(idProd, idCat) {
  const idP = Number(idProd);
  const idC = Number(idCat);

  const pProd = cachePrecios.find(p => p.id_producto !== null && Number(p.id_producto) === idP);
  if (pProd) {
    const un = Number(pProd.precio_unidad ?? pProd.precio ?? 0);
    const doc = pProd.precio_docena ? Number(pProd.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  const pCat = cachePrecios.find(p => Number(p.id_categoria) === idC && (p.id_producto === null || p.id_producto === undefined));
  if (pCat) {
    const un = Number(pCat.precio_unidad ?? pCat.precio ?? 0);
    const doc = pCat.precio_docena ? Number(pCat.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  return { unidad: 0, docena: 0 };
}

function cambiarCantidad(idProd, cambio) {
  const actual = carrito[idProd] || 0;
  const nuevo = actual + cambio;

  if (nuevo <= 0) {
    delete carrito[idProd];
  } else {
    carrito[idProd] = nuevo;
  }

  renderizarMenuPorCategorias();
}

// Cálculo centralizado para el cliente
function obtenerResumenCarritoCliente() {
  let totalUnidades = 0;
  let subtotalSinDescuento = 0;
  let totalSueltasDocenables = 0;
  let precioDocenaSugerido = 0;
  let precioUnidadDocenable = 0;

  const listaItems = [];

  Object.entries(carrito).forEach(([idProd, cant]) => {

    // FILTRO: Omitir el producto bonificación 999 del desglose normal
    if (Number(idProd) === 999) return;
    
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cantidad = Number(cant) || 0;
    if (cantidad <= 0) return;

    totalUnidades += cantidad;

    const idCatProd = p.id_categoria || p.idCategoria;
    const precios = obtenerPrecioProductoCliente(p.id, idCatProd);
    const precioUnidad = precios.unidad || 0;
    const subTotal = cantidad * precioUnidad;

    subtotalSinDescuento += subTotal;

    if (p.m_permite_docena) {
      totalSueltasDocenables += cantidad;
      if (precios.docena) precioDocenaSugerido = precios.docena;
      if (precioUnidad) precioUnidadDocenable = precioUnidad;
    }

    listaItems.push({
      id: p.id,
      nombre: p.nombre,
      cantidad: cantidad,
      precioUnitario: precioUnidad,
      subTotal: subTotal
    });
  });

  let descuentoTotal = 0;
  const docenasCompletas = Math.floor(totalSueltasDocenables / 12);

  if (docenasCompletas > 0 && precioDocenaSugerido > 0) {
    const descuentoPorDocena = (precioUnidadDocenable * 12) - precioDocenaSugerido;
    descuentoTotal = descuentoPorDocena * docenasCompletas;
  }

  const totalFinal = Math.max(0, subtotalSinDescuento - descuentoTotal);

  return {
    totalUnidades,
    subtotalSinDescuento,
    descuentoTotal,
    docenasCompletas,
    totalFinal,
    listaItems
  };
}

function actualizarBarraCarrito() {
  const resumen = obtenerResumenCarritoCliente();

  const badgeQty = document.getElementById('cant-items-carrito');
  const badgeMonto = document.getElementById('monto-total-carrito');
  const btn = document.getElementById('btn-confirmar-pedido');

  if (badgeQty) badgeQty.innerText = `${resumen.totalUnidades} u.`;
  if (badgeMonto) badgeMonto.innerText = `$${resumen.totalFinal.toLocaleString('es-AR')}`;

  if (btn) {
    if (resumen.totalUnidades > 0) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'true');
    }
  }
}

function renderizarResumenEnModalCliente() {
  const contenedor = document.getElementById('resumen-pedido-modal-cliente');
  if (!contenedor) return;

  const resumen = obtenerResumenCarritoCliente();

  if (resumen.listaItems.length === 0) {
    contenedor.innerHTML = `<p class="text-center text-muted my-2">El carrito está vacío</p>`;
    return;
  }

  let html = `<ul class="list-group list-group-flush mb-3">`;

  resumen.listaItems.forEach(item => {
    html += `
      <li class="list-group-item d-flex justify-content-between align-items-center p-2 bg-transparent border-bottom">
        <div>
          <strong class="d-block text-dark">${item.nombre}</strong>
          <small class="text-muted">${item.cantidad} u. x $${item.precioUnitario.toLocaleString('es-AR')}</small>
        </div>
        <span class="font-weight-bold text-dark">$${item.subTotal.toLocaleString('es-AR')}</span>
      </li>
    `;
  });

  if (resumen.descuentoTotal > 0) {
    html += `
      <li class="list-group-item d-flex justify-content-between align-items-center p-2 bg-light text-danger border-bottom">
        <div>
          <strong class="d-block text-danger"><i class="fas fa-tag mr-1"></i> Descuento por Docena</strong>
          <small class="text-muted">${resumen.docenasCompletas} doc. promocional(es)</small>
        </div>
        <span class="font-weight-bold">-$${resumen.descuentoTotal.toLocaleString('es-AR')}</span>
      </li>
    `;
  }

  html += `</ul>
    <div class="d-flex justify-content-between align-items-center p-2 bg-white rounded border">
      <span class="font-weight-bold">TOTAL A PAGAR:</span>
      <span class="h5 font-weight-bold text-success mb-0">$${resumen.totalFinal.toLocaleString('es-AR')}</span>
    </div>
  `;

  contenedor.innerHTML = html;
}

async function enviarPedidoASupabase() {
  const inputNombre = document.getElementById('cliente-nombre');
  const inputTelefono = document.getElementById('cliente-telefono');
  const inputObservaciones = document.getElementById('cliente-observaciones');

  const nombre = inputNombre ? inputNombre.value.trim() : '';
  const telefono = inputTelefono ? inputTelefono.value.trim() : '';
  const observaciones = inputObservaciones ? inputObservaciones.value.trim() : '';

  if (!nombre || !telefono) {
    alert('Por favor completá tu nombre y teléfono.');
    return;
  }

  const resumen = obtenerResumenCarritoCliente();
  if (resumen.listaItems.length === 0) {
    alert('El carrito está vacío.');
    return;
  }

  const detalles = resumen.listaItems.map(item => ({
    id_pedido: null,
    id_producto: item.id,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    subTotal: item.subTotal
  }));

  // Agregar el producto 999 (Descuento por Docena) en el detalle si aplica
  if (resumen.descuentoTotal > 0) {
    const descuentoPorDocenaUnidad = resumen.descuentoTotal / resumen.docenasCompletas;
    detalles.push({
      id_pedido: null,
      id_producto: 999,
      cantidad: resumen.docenasCompletas,
      precioUnitario: -descuentoPorDocenaUnidad,
      subTotal: -resumen.descuentoTotal
    });
  }

  const btnFinalizar = document.getElementById('btn-finalizar-pedido');
  if (btnFinalizar) {
    btnFinalizar.disabled = true;
    btnFinalizar.innerText = 'Guardando pedido...';
  }

  try {
    const { data: pedidoCreado, error: errPedido } = await supabaseClient
      .from('TB_TPEDIDOS')
      .insert([{
        fecha: new Date().toISOString().split('T')[0],
        id_cliente: ID_CLIENTE_CONSUMIDOR_FINAL,
        id_lista_precio: ID_LISTA_MINORISTA,
        id_medio_pago: ID_MEDIO_PAGO_EFECTIVO,
        estado: 'PREPARACION',
        nombre_referencia: `${nombre} (Tel: ${telefono})`,
        observaciones: observaciones || null,
        importe_total: resumen.totalFinal
      }])
      .select('id')
      .single();

    if (errPedido || !pedidoCreado) {
      alert('Error al guardar el pedido: ' + (errPedido?.message || 'Error desconocido'));
      return;
    }

    const detallesConPedido = detalles.map(d => ({
      ...d,
      id_pedido: pedidoCreado.id
    }));

    const { error: errDetalles } = await supabaseClient
      .from('TB_DPEDIDOS')
      .insert(detallesConPedido);

    if (errDetalles) {
      alert('Error al guardar el detalle del pedido.');
      return;
    }

   // =========================================================================
    // DETECCIÓN DE ORIGEN: ¿Viene desde el bot de WhatsApp?
    // =========================================================================
    const urlParams = new URLSearchParams(window.location.search);
    const vieneDeWhatsApp = urlParams.has('tel') && urlParams.get('tel').trim() !== '';

    if (vieneDeWhatsApp) {
      // -----------------------------------------------------------------------
      // OPCIÓN 1: Redirección automática a WhatsApp
      // -----------------------------------------------------------------------
      const mensajeWS = `Hola! Ya confirmé mi Pedido *#${pedidoCreado.id}* por *$${resumen.totalFinal.toLocaleString('es-AR')}* a nombre de *${nombre}*. Quedo a la espera!`;
      
      // Podés usar el teléfono del negocio o reenviar al mismo número
      const urlWhatsApp = `https://wa.me/549${telefono}?text=${encodeURIComponent(mensajeWS)}`;

      // Vaciar carrito antes de redirigir
      carrito = {};

      // Redirigir directamente al chat
      window.location.href = urlWhatsApp;

    } else {
      // -----------------------------------------------------------------------
      // OPCIÓN 2: Pantalla de Éxito dentro del Modal
      // -----------------------------------------------------------------------
      const modalContent = document.querySelector('#modalConfirmarCliente .modal-content');
      if (modalContent) {
        modalContent.innerHTML = `
          <div class="modal-body text-center py-4">
            <div class="mb-2" style="font-size: 3.5rem; color: #198754;">🎉</div>
            <h3 class="font-weight-bold text-dark">¡Pedido #${pedidoCreado.id} Recibido!</h3>
            <p class="text-muted lead mb-2">Total a pagar: <strong class="text-success">$${resumen.totalFinal.toLocaleString('es-AR')}</strong></p>
            <div class="alert alert-light border my-3">
              <small class="text-secondary d-block">Cliente: <strong>${nombre}</strong></small>
              <small class="text-secondary d-block">Teléfono: <strong>${telefono}</strong></small>
            </div>
            <p class="small text-muted mb-4">Ya ingresamos tu pedido a cocina. Podés cerrar esta ventana.</p>
            <button class="btn btn-success btn-block font-weight-bold py-2" onclick="location.reload()">
              ACEPTAR Y VOLVER
            </button>
          </div>
        `;
      }

      // Vaciar el carrito local
      carrito = {};
    }

    carrito = {};
    if (inputNombre) inputNombre.value = '';
    if (inputTelefono) inputTelefono.value = '';
    if (inputObservaciones) inputObservaciones.value = '';

    await cargarDatosMenu();

  } catch (err) {
    console.error('Error al procesar el pedido:', err);
    alert('Ocurrió un error inesperado.');
  } finally {
    if (btnFinalizar) {
      btnFinalizar.disabled = false;
      btnFinalizar.innerText = '✅ CONFIRMAR Y GUARDAR';
    }
  }
}