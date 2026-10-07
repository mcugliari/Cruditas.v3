import { supabasePublic } from './config.js';

let cacheCategorias = [];
let cacheProductos = [];
let cachePrecios = [];
let carrito = {}; // { id_producto: cantidad }

// Token opcional del link (?t=...). Lo genera el bot desde el servidor.
// Cliente consumidor final, lista de precios y medio de pago se fijan en la base.
const TOKEN_LINK = new URLSearchParams(window.location.search).get('t');

// Escapa texto antes de ponerlo en innerHTML (evita inyección de HTML/JS)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const MENSAJES_ERROR = {
  demasiados_pedidos: 'Ya enviaste varios pedidos hace poco. Si necesitás cambiar algo, escribinos por WhatsApp.',
  servicio_ocupado: 'Estamos recibiendo muchos pedidos. Probá de nuevo en unos minutos.',
  link_invalido: 'Este link venció o ya fue usado. Pedí uno nuevo por WhatsApp.',
  producto_invalido: 'Algún producto del pedido ya no está disponible. Recargá la página e intentá de nuevo.',
  datos_invalidos: 'Revisá tu nombre y teléfono (solo números, con característica).'
};

function mensajeError(err) {
  const clave = Object.keys(MENSAJES_ERROR).find(k => (err?.message || '').includes(k));
  return MENSAJES_ERROR[clave] || 'No pudimos guardar el pedido. Intentá de nuevo en un momento.';
}

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
    const { data: menu, error: errMenu } = await supabasePublic.rpc('menu_publico');
    if (errMenu) throw errMenu;

    cacheCategorias = menu?.categorias || [];
    cacheProductos = menu?.productos || [];
    cachePrecios = menu?.precios || [];

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
          ${esc(cat.nombre)}
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
              <h6 class="font-weight-bold m-0 text-dark">${esc(p.nombre)}</h6>
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
          <strong class="d-block text-dark">${esc(item.nombre)}</strong>
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

  const btnFinalizar = document.getElementById('btn-finalizar-pedido');
  if (btnFinalizar) {
    btnFinalizar.disabled = true;
    btnFinalizar.innerText = 'Guardando pedido...';
  }

  try {
    const { data: resultado, error: errPedido } = await supabasePublic.rpc('crear_pedido_cliente', {
      p_nombre: nombre,
      p_telefono: telefono,
      p_observaciones: observaciones || null,
      p_items: resumen.listaItems.map(i => ({ id_producto: i.id, cantidad: i.cantidad })),
      p_token: TOKEN_LINK
    });

    if (errPedido || !resultado) {
      console.error('Error al crear el pedido:', errPedido);
      alert(mensajeError(errPedido));
      return;
    }

    // El id y el total válidos son los que calculó el servidor
    const pedidoCreado = { id: resultado.id_pedido };
    const totalServidor = Number(resultado.total);

   // =========================================================================
    // DETECCIÓN DE ORIGEN: ¿Viene desde el bot de WhatsApp?
    // =========================================================================
    const urlParams = new URLSearchParams(window.location.search);
    const vieneDeWhatsApp = urlParams.has('tel') && urlParams.get('tel').trim() !== '';

    if (vieneDeWhatsApp) {
      // -----------------------------------------------------------------------
      // OPCIÓN 1: Redirección automática a WhatsApp
      // -----------------------------------------------------------------------
      const mensajeWS = `Hola! Ya confirmé mi Pedido *#${pedidoCreado.id}* por *$${totalServidor.toLocaleString('es-AR')}* a nombre de *${nombre}*. Quedo a la espera!`;
      
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
            <p class="text-muted lead mb-2">Total a pagar: <strong class="text-success">$${totalServidor.toLocaleString('es-AR')}</strong></p>
            <div class="alert alert-light border my-3">
              <small class="text-secondary d-block">Cliente: <strong>${esc(nombre)}</strong></small>
              <small class="text-secondary d-block">Teléfono: <strong>${esc(telefono)}</strong></small>
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