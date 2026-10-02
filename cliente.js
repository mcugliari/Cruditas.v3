import { supabaseClient } from './config.js';

let productosDB = [];
let carrito = {}; // { id_producto: cantidad }

document.addEventListener('DOMContentLoaded', async () => {
  await cargarProductos();

  document.getElementById('btn-confirmar-pedido')?.addEventListener('click', () => {
    $('#modalConfirmarCliente').modal('show');
  });

  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', enviarPedidoASupabase);
});

async function cargarProductos() {
  const { data: productos, error } = await supabaseClient
    .from('TB_BPRODUCTOS')
    .select('id, nombre, TB_BCATEGORIAS(nombre)');

  if (error || !productos) {
    document.getElementById('contenedor-productos-cliente').innerHTML = '<p class="text-danger text-center">Error al cargar productos.</p>';
    return;
  }

  productosDB = productos;
  renderizarMenu();
}

function renderizarMenu() {
  const contenedor = document.getElementById('contenedor-productos-cliente');
  
  contenedor.innerHTML = productosDB.map(p => {
    const cant = carrito[p.id] || 0;
    const catNombre = p.TB_BCATEGORIAS?.nombre || 'General';

    return `
      <div class="card card-prod p-3">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <span class="badge badge-light border mb-1">${catNombre}</span>
            <h6 class="font-weight-bold m-0">${p.nombre}</h6>
          </div>
          <div class="d-flex align-items-center">
            <button class="btn btn-outline-secondary btn-qty btn-restar" data-id="${p.id}">-</button>
            <span class="font-weight-bold px-3">${cant}</span>
            <button class="btn btn-warning btn-qty btn-sumar" data-id="${p.id}">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Escuchadores de sumas / restas
  contenedor.querySelectorAll('.btn-sumar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(btn.dataset.id, 1);
  });
  contenedor.querySelectorAll('.btn-restar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(btn.dataset.id, -1);
  });

  actualizarBarraCarrito();
}

function cambiarCantidad(idProd, cambio) {
  const actual = carrito[idProd] || 0;
  const nuevo = actual + cambio;
  
  if (nuevo <= 0) delete carrito[idProd];
  else carrito[idProd] = nuevo;

  renderizarMenu();
}

function actualizarBarraCarrito() {
  const totalItems = Object.values(carrito).reduce((acc, c) => acc + c, 0);
  document.getElementById('cant-items-carrito').innerText = `${totalItems} u.`;
  
  const btn = document.getElementById('btn-confirmar-pedido');
  if (totalItems > 0) {
    btn.removeAttribute('disabled');
  } else {
    btn.setAttribute('disabled', 'true');
  }
}

async function enviarPedidoASupabase() {
  const nombre = document.getElementById('cliente-nombre').value.trim();
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const modalidad = document.getElementById('cliente-modalidad').value;

  if (!nombre || !telefono) {
    alert('Por favor completá tu nombre y teléfono.');
    return;
  }

  // 1. Crear la cabecera del pedido en TB_TPEDIDOS
  const { data: pedidoCreado, error: errPedido } = await supabaseClient
    .from('TB_TPEDIDOS')
    .insert([{
      fecha: new Date().toISOString().split('T')[0],
      estado: 'PREPARACION',
      nombre_referencia: `${nombre} (${modalidad} - Tel: ${telefono})`,
      importe_total: 0 // El servidor/POS actualiza montos según lista
    }])
    .select('id')
    .single();

  if (errPedido || !pedidoCreado) {
    alert('Error al guardar el pedido: ' + errPedido?.message);
    return;
  }

  // 2. Insertar los ítems en TB_DPEDIDOS
  const detalles = Object.entries(carrito).map(([idProd, cant]) => ({
    id_pedido: pedidoCreado.id,
    id_producto: parseInt(idProd),
    cantidad: cant,
    precioUnitario: 0,
    subTotal: 0
  }));

  const { error: errDetalles } = await supabaseClient
    .from('TB_DPEDIDOS')
    .insert(detalles);

  if (errDetalles) {
    alert('Error al guardar los ítems del pedido.');
    return;
  }

  $('#modalConfirmarCliente').modal('hide');
  alert(`¡Pedido #${pedidoCreado.id} enviado con éxito!`);
  
  // Limpiar carrito
  carrito = {};
  renderizarMenu();
}