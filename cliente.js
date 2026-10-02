import { supabaseClient } from './config.js';
import { obtenerPrecioProducto, calcularSubtotalItem } from './pos.js';

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

  document.getElementById('btn-confirmar-pedido')?.addEventListener('click', () => {
    $('#modalConfirmarCliente').modal('show');
  });

  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', enviarPedidoASupabase);
});

async function cargarDatosMenu() {
  const contenedor = document.getElementById('contenedor-productos-cliente');

  try {
    // 1. Cargar Categorías, Productos y Lista de Precios de Consumidor Final de Supabase
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

  // Paleta de colores para destacar las categorías
  const paletaColores = [
    { bg: '#0d6efd', text: '#ffffff' }, // Azul
    { bg: '#198754', text: '#ffffff' }, // Verde
    { bg: '#ffc107', text: '#000000' }, // Amarillo
    { bg: '#dc3545', text: '#ffffff' }, // Rojo
    { bg: '#0dcaf0', text: '#000000' }, // Celeste
    { bg: '#6c757d', text: '#ffffff' }  // Gris
  ];

  let html = '';
  let colorIndex = 0;

  cacheCategorias.forEach(cat => {
    const prodsCat = cacheProductos.filter(p => Number(p.id_categoria || p.idCategoria) === Number(cat.id));
    if (prodsCat.length === 0) return;

    // Asignar color de la paleta
    const estiloColor = paletaColores[colorIndex % paletaColores.length];
    colorIndex++;

    html += `
      <div class="mb-4">
        <!-- Cabecera de Categoría Resaltada sin contador -->
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

  // Reasignar eventos
  contenedor.querySelectorAll('.btn-sumar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), 1);
  });
  contenedor.querySelectorAll('.btn-restar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), -1);
  });

  actualizarBarraCarrito();
}

// Adaptador para usar los precios en la lista Consumidor Final
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

function actualizarBarraCarrito() {
  let totalUnidades = 0;
  let montoTotal = 0;

  Object.entries(carrito).forEach(([idProd, cant]) => {
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const idCatProd = p.id_categoria || p.idCategoria;
    const precios = obtenerPrecioProductoCliente(p.id, idCatProd);
    
    // Aplicar la regla de cálculo por unidad y por docena si completa 12 u.
    const subtotal = calcularSubtotalItem(cant, precios, Boolean(p.m_permite_docena));

    totalUnidades += cant;
    montoTotal += subtotal;
  });

  const badgeQty = document.getElementById('cant-items-carrito');
  const badgeMonto = document.getElementById('monto-total-carrito');
  const btn = document.getElementById('btn-confirmar-pedido');

  if (badgeQty) badgeQty.innerText = `${totalUnidades} u.`;
  if (badgeMonto) badgeMonto.innerText = `$${montoTotal.toLocaleString('es-AR')}`;

  if (btn) {
    if (totalUnidades > 0) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'true');
    }
  }
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

  let montoTotalCalculado = 0;
  const detalles = [];

  Object.entries(carrito).forEach(([idProd, cant]) => {
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cantidadTotal = Number(cant) || 0;
    if (cantidadTotal <= 0) return;

    const precios = obtenerPrecioProductoCliente(p.id, p.id_categoria || p.idCategoria);
    const precioUnidad = precios.unidad || 0;
    const precioDocena = precios.docena || (precioUnidad * 12);
    const permiteDocena = Boolean(p.m_permite_docena);

    if (permiteDocena && cantidadTotal >= 12) {
      const cantDocenas = Math.floor(cantidadTotal / 12);
      const unidadesSueltas = cantidadTotal % 12;

      detalles.push({
        id_pedido: null,
        id_producto: p.id,
        cantidad: cantDocenas * 12,
        precioUnitario: precioDocena,
        subTotal: precioDocena * cantDocenas
      });
      montoTotalCalculado += cantDocenas * precioDocena;

      if (unidadesSueltas > 0) {
        detalles.push({
          id_pedido: null,
          id_producto: p.id,
          cantidad: unidadesSueltas,
          precioUnitario: precioUnidad,
          subTotal: precioUnidad * unidadesSueltas
        });
        montoTotalCalculado += unidadesSueltas * precioUnidad;
      }
    } else {
      detalles.push({
        id_pedido: null,
        id_producto: p.id,
        cantidad: cantidadTotal,
        precioUnitario: precioUnidad,
        subTotal: precioUnidad * cantidadTotal
      });
      montoTotalCalculado += cantidadTotal * precioUnidad;
    }
  });

  const btnFinalizar = document.getElementById('btn-finalizar-pedido');
  if (btnFinalizar) {
    btnFinalizar.disabled = true;
    btnFinalizar.innerText = 'Guardando pedido...';
  }

  try {
    // 1. Guardar la cabecera en TB_TPEDIDOS guardando observaciones
    const { data: pedidoCreado, error: errPedido } = await supabaseClient
      .from('TB_TPEDIDOS')
      .insert([{
        fecha: new Date().toISOString().split('T')[0],
        id_cliente: ID_CLIENTE_CONSUMIDOR_FINAL, // <--- Carga por defecto 'Consumidor Final'
        id_lista_precio: ID_LISTA_MINORISTA, // <--- Carga por defecto 'Minorista'
        id_medio_pago: ID_MEDIO_PAGO_EFECTIVO, // <--- Carga por defecto 'Efectivo'
        estado: 'PREPARACION',
        nombre_referencia: `${nombre} (Tel: ${telefono})`,
        observaciones: observaciones || null, // Se envía a la columna observaciones
        importe_total: montoTotalCalculado
      }])
      .select('id')
      .single();

    if (errPedido || !pedidoCreado) {
      alert('Error al guardar el pedido: ' + (errPedido?.message || 'Error desconocido'));
      return;
    }

    // 2. Insertar renglones del detalle
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

    $('#modalConfirmarCliente').modal('hide');
    alert(`¡Pedido #${pedidoCreado.id} cargado con éxito por $${montoTotalCalculado.toLocaleString('es-AR')}!`);

    // Resetear campos
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