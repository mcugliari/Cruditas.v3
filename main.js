import { cargarClientes, guardarCliente, abrirModalEditar, guardarEdicionCliente, eliminarCliente, inicializarCrudClienteLista, guardarAsociacionClienteLista, editarAsociacion, eliminarAsociacion } from './clientes.js';
import { cargarProductos, abrirModalNuevoProducto, abrirModalEditarProducto, guardarProducto, eliminarProducto } from './productos.js';
import { inicializarModuloListas, cargarMatrizPrecios, guardarPrecioCategoria, abrirModalPrecioEspecial, guardarPrecioEspecial, eliminarPrecioEspecial } from './listas.js';
import { inicializarPOS, alCambiarCliente, alterarCantidad, vaciarCarrito, guardarPedido } from './pos.js';
import { cargarTablaPedidos, cambiarEstadoPedido, editarPedido, verDetallePedido } from './pedidos.js';
import { inicializarReporteVentas, generarResumenVentasProductos } from './reporteVentas.js';
import { inicializarCierreCaja } from './caja.js';

// FUNCION DE NAVEGACIÓN
export function navegarA(seccionId, elementoMenu) {
  const secciones = document.querySelectorAll('.modulo-app');
  secciones.forEach(sec => {
    sec.style.display = 'none';
    sec.classList.add('d-none'); // <--- Forzar ocultado
  });

  const links = document.querySelectorAll('#menu-navegacion .nav-link');
  links.forEach(l => l.classList.remove('active'));

  const seccionObjetivo = document.getElementById(`sec-${seccionId}`);
  if (seccionObjetivo) {
    seccionObjetivo.classList.remove('d-none'); // <--- Remover d-none al activar
    seccionObjetivo.style.display = 'block';
  }

  if (elementoMenu) {
    elementoMenu.classList.add('active');
  }

  // Cargar lógica según módulo
  if (seccionId === 'clientes') {
    cargarClientes();
    inicializarCrudClienteLista();
  } else if (seccionId === 'productos') {
    cargarProductos();
  } else if (seccionId === 'listas') {
    inicializarModuloListas();
  } else if (seccionId === 'pedidos') {
    inicializarPOS();
  } else if (seccionId === 'pedidos-dia') {
    cargarTablaPedidos();
  } else if (seccionId === 'resumen-ventas') {
    inicializarReporteVentas();
  }
}

// INICIALIZACIÓN GLOBAL Y DELEGACIÓN DE EVENTOS
document.addEventListener('DOMContentLoaded', () => {

  // 1. Navegación inicial a Pedidos
  const primerLink = document.querySelector('#menu-navegacion .nav-link[data-section="pedidos"]');
  navegarA('pedidos', primerLink);

  // 2. Event Listener Menú Lateral
  document.getElementById('menu-navegacion')?.addEventListener('click', (e) => {
    const link = e.target.closest('[data-section]');
    if (!link) return;

    e.preventDefault();
    const seccion = link.dataset.section;
    navegarA(seccion, link);

    document.body.classList.remove('sidebar-open');
    document.body.classList.add('sidebar-collapse');
  });

  // 3. Event Listeners para POS (Columna de menú y tarjetas)
    document.getElementById('contenedor-menu-productos')?.addEventListener('click', (e) => {
    const btnPill = e.target.closest('[data-action="alterar-cant"]');
    if (btnPill) {
        const id = Number(btnPill.dataset.id);
        const delta = Number(btnPill.dataset.delta);
        alterarCantidad(id, delta);
    }
    });

  // Eventos Selects POS
  document.getElementById('select-cliente-pedido')?.addEventListener('change', alCambiarCliente);
  document.getElementById('select-lista-pedido')?.addEventListener('change', () => inicializarPOS());

  // Botonera de acciones POS
  document.querySelector('.pos-actions-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    if (action === 'guardar-pedido') {
      const estado = btn.dataset.estado;
      guardarPedido(estado);
    } else if (action === 'vaciar-carrito') {
      vaciarCarrito();
    }
  });

  // 4. Event Listeners para Gestión de Pedidos del Día
  document.getElementById('btn-actualizar-pedidos')?.addEventListener('click', cargarTablaPedidos);
  document.getElementById('filtro-fecha-desde')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-fecha-hasta')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-estado-pedido')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-buscar-pedido')?.addEventListener('keyup', cargarTablaPedidos);

  document.getElementById('tabla-pedidos-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'cambiar-estado') {
      const estado = btn.dataset.estado;
      cambiarEstadoPedido(id, estado);
    } else if (action === 'editar-pedido') {
      editarPedido(id);
    } else if (action === 'ver-detalle') {
      verDetallePedido(id);
    }
  });

  // 5. Event Listeners Clientes
  document.getElementById('form-cliente')?.addEventListener('submit', guardarCliente);
  document.getElementById('form-editar-cliente')?.addEventListener('submit', guardarEdicionCliente);
  document.getElementById('form-cliente-lista')?.addEventListener('submit', guardarAsociacionClienteLista);

  document.getElementById('tabla-clientes-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-cliente') {
      abrirModalEditar(id, btn.dataset.nombre, btn.dataset.telefono, btn.dataset.direccion);
    } else if (action === 'eliminar-cliente') {
      eliminarCliente(id, btn.dataset.nombre);
    }
  });

  document.getElementById('tabla-asoc-cliente-lista')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-asoc') {
      editarAsociacion(id, Number(btn.dataset.cliente), Number(btn.dataset.lista), btn.dataset.predeterminada === 'true');
    } else if (action === 'eliminar-asoc') {
      eliminarAsociacion(id);
    }
  });

  // 6. Event Listeners Productos
  document.getElementById('btn-nuevo-producto')?.addEventListener('click', abrirModalNuevoProducto);
  document.getElementById('form-producto')?.addEventListener('submit', guardarProducto);

  document.getElementById('tabla-productos-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-producto') {
      abrirModalEditarProducto(id, btn.dataset.nombre, Number(btn.dataset.categoria), btn.dataset.docena === 'true');
    } else if (action === 'eliminar-producto') {
      eliminarProducto(id, btn.dataset.nombre);
    }
  });

  // 7. Event Listeners Listas de Precios
  document.getElementById('select-lista-activa')?.addEventListener('change', cargarMatrizPrecios);
  document.getElementById('btn-nueva-excepcion')?.addEventListener('click', abrirModalPrecioEspecial);
  document.getElementById('form-precio-especial')?.addEventListener('submit', guardarPrecioEspecial);

  document.getElementById('tabla-precios-categorias-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="guardar-precio-cat"]');
    if (!btn) return;
    const catId = Number(btn.dataset.cat);
    const detalleId = btn.dataset.detalle !== 'null' ? Number(btn.dataset.detalle) : null;
    guardarPrecioCategoria(catId, detalleId);
  });

  document.getElementById('tabla-precios-productos-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="eliminar-precio-prod"]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    eliminarPrecioEspecial(id);
  });

  // 8. Event Listeners Resumen de Ventas
  document.getElementById('btn-filtrar-resumen-prod')?.addEventListener('click', generarResumenVentasProductos);

  // ➕ 9. Inicializar Cierre de Caja
  inicializarCierreCaja();
  
});