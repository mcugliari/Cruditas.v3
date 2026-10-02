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
  const contenedor = document.getElementById('contenedor-productos-cliente');
  
  try {
    // Leemos directamente los productos de la tabla
    const { data: productos, error } = await supabaseClient
      .from('TB_BPRODUCTOS')
      .select('id, nombre')
      .order('nombre', { ascending: true });

    if (error) {
      console.error('Error de Supabase:', error);
      if (contenedor) {
        contenedor.innerHTML = `<div class="alert alert-danger text-center">Error al cargar productos: ${error.message}</div>`;
      }
      return;
    }

    if (!productos || productos.length === 0) {
      if (contenedor) {
        contenedor.innerHTML = '<p class="text-center text-muted">No hay productos disponibles en este momento.</p>';
      }
      return;
    }

    productosDB = productos;
    renderizarMenu();

  } catch (err) {
    console.error('Error general al cargar productos:', err);
    if (contenedor) {
      contenedor.innerHTML = '<p class="text-danger text-center">Ocurrió un error inesperado al conectar con el servidor.</p>';
    }
  }
}

function renderizarMenu() {
  const contenedor = document.getElementById('contenedor-productos-cliente');
  if (!contenedor) return;

  contenedor.innerHTML = productosDB.map(p => {
    const cant = carrito[p.id] || 0;

    return `
      <div class="card card-prod p-3 shadow-sm mb-2" style="border: none; border-radius: 10px;">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h6 class="font-weight-bold m-0 text-dark">${p.nombre}</h6>
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

  // Asignar escuchadores a los botones de sumar y restar
  contenedor.querySelectorAll('.btn-sumar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), 1);
  });
  contenedor.querySelectorAll('.btn-restar').forEach(btn => {
    btn.onclick = () => cambiarCantidad(parseInt(btn.dataset.id), -1);
  });

  actualizarBarraCarrito();
}

function cambiarCantidad(idProd, cambio) {
  const actual = carrito[idProd] || 0;
  const nuevo = actual + cambio;
  
  if (nuevo <= 0) {
    delete carrito[idProd];
  } else {
    carrito[idProd] = nuevo;
  }

  renderizarMenu();
}

function actualizarBarraCarrito() {
  const totalItems = Object.values(carrito).reduce((acc, c) => acc + c, 0);
  const badgeQty = document.getElementById('cant-items-carrito');
  if (badgeQty) badgeQty.innerText = `${totalItems} u.`;
  
  const btn = document.getElementById('btn-confirmar-pedido');
  if (btn) {
    if (totalItems > 0) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'true');
    }
  }
}

async function enviarPedidoASupabase() {
  const inputNombre = document.getElementById('cliente-nombre');
  const inputTelefono = document.getElementById('cliente-telefono');
  const selectModalidad = document.getElementById('cliente-modalidad');

  const nombre = inputNombre ? inputNombre.value.trim() : '';
  const telefono = inputTelefono ? inputTelefono.value.trim() : '';
  const modalidad = selectModalidad ? selectModalidad.value : 'RETIRO';

  if (!nombre || !telefono) {
    alert('Por favor completá tu nombre y teléfono.');
    return;
  }

  const btnFinalizar = document.getElementById('btn-finalizar-pedido');
  if (btnFinalizar) {
    btnFinalizar.disabled = true;
    btnFinalizar.innerText = 'Guardando pedido...';
  }

  try {
    // 1. Crear la cabecera en TB_TPEDIDOS
    const { data: pedidoCreado, error: errPedido } = await supabaseClient
      .from('TB_TPEDIDOS')
      .insert([{
        fecha: new Date().toISOString().split('T')[0],
        estado: 'PREPARACION',
        nombre_referencia: `${nombre} (${modalidad} - Tel: ${telefono})`,
        importe_total: 0
      }])
      .select('id')
      .single();

    if (errPedido || !pedidoCreado) {
      alert('Error al guardar el pedido: ' + (errPedido?.message || 'Error desconocido'));
      if (btnFinalizar) {
        btnFinalizar.disabled = false;
        btnFinalizar.innerText = '✅ CONFIRMAR Y GUARDAR';
      }
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
      alert('Error al guardar los ítems del pedido: ' + errDetalles.message);
      if (btnFinalizar) {
        btnFinalizar.disabled = false;
        btnFinalizar.innerText = '✅ CONFIRMAR Y GUARDAR';
      }
      return;
    }

    $('#modalConfirmarCliente').modal('hide');
    alert(`¡Pedido #${pedidoCreado.id} enviado con éxito!`);
    
    // Limpiar formulario y carrito
    carrito = {};
    if (inputNombre) inputNombre.value = '';
    if (inputTelefono) inputTelefono.value = '';
    renderizarMenu();

  } catch (err) {
    console.error('Error al enviar el pedido:', err);
    alert('Ocurrió un error al procesar el pedido.');
  } finally {
    if (btnFinalizar) {
      btnFinalizar.disabled = false;
      btnFinalizar.innerText = '✅ CONFIRMAR Y GUARDAR';
    }
  }
}