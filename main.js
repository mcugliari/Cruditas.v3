import { asegurarSesion } from './auth.js';
import { cargarClientes, guardarCliente, abrirModalEditar, guardarEdicionCliente, eliminarCliente, inicializarCrudClienteLista, guardarAsociacionClienteLista, editarAsociacion, eliminarAsociacion } from './clientes.js';
import { cargarProductos, abrirModalNuevoProducto, abrirModalEditarProducto, guardarProducto, eliminarProducto } from './productos.js';
import { inicializarModuloListas, cargarMatrizPrecios, guardarPrecioCategoria, abrirModalPrecioEspecial, guardarPrecioEspecial, eliminarPrecioEspecial } from './listas.js';
import { inicializarPOS, cargarPOS, alCambiarCliente, alterarCantidad, vaciarCarrito, guardarPedido, setFiltroBusquedaPOS, setCategoriaActivaPOS, eliminarItemCarrito, iniciarCobroPOS } from './pos.js';
import { cargarTablaPedidos, cambiarEstadoPedido, editarPedido, verDetallePedido } from './pedidos.js';
import { confirmarCobro, elegirMedioCobro, actualizarVueltoCobro } from './cobro.js';
import { inicializarReporteVentas, generarResumenVentasProductos } from './reporteVentas.js';
import { cargarCompras, verDetalleCompra, anularCompraAbierta, pagarCompraAbierta, anularPagoDeCompra } from './compras.js';
import { guardarPago } from './pagos.js';
import { cargarEgresos, abrirModalEgreso, guardarEgreso, anularEgreso } from './egresos.js';
import { cargarDeuda, renderizarDeuda, verDeudaProveedor, pagarCompraDeLaDeuda, pagarDeudaProveedorAbierto, pagarDeudaProveedor } from './deuda.js';
import { abrirModalNuevaCompra, guardarCompra, agregarLinea, quitarLinea, alCambiarLinea, alCambiarPagarAhora } from './compraForm.js';
import { cargarProveedores, abrirModalNuevoProveedor, abrirModalEditarProveedor, guardarProveedor, cambiarEstadoProveedor } from './proveedores.js';
import { cargarInsumos, renderizarInsumos, abrirModalNuevoInsumo, abrirModalEditarInsumo, guardarInsumo, cambiarEstadoInsumo } from './insumos.js';
import {
  cargarCuentas, abrirModalNuevaCuenta, abrirModalEditarCuenta, guardarCuenta, cambiarEstadoCuenta,
  abrirModalTransferencia, guardarTransferencia, abrirModalAjuste, guardarAjuste,
  abrirMovimientosCuenta, anularMovimientoCuenta
} from './cuentas.js';
import { inicializarCierreCaja, inicializarHistorialCierres, cargarTablaHistorialCierres, verDetalleCierre, actualizarIndicadorCaja } from './caja.js';

// FUNCION DE NAVEGACIÓN
export function navegarA(seccionId, elementoMenu) {
  // Refresca el indicador de caja en cada cambio de sección. No se usa "await"
  // a propósito: se actualiza solo cuando llega la respuesta y no demora la navegación.
  actualizarIndicadorCaja();
  const secciones = document.querySelectorAll('.modulo-app');
  secciones.forEach(sec => {
    sec.style.display = 'none';
    sec.classList.add('d-none');
  });

  
  const links = document.querySelectorAll('#menu-navegacion .nav-link');
  links.forEach(l => l.classList.remove('active'));

  const seccionObjetivo = document.getElementById(`sec-${seccionId}`);
  if (seccionObjetivo) {
    seccionObjetivo.classList.remove('d-none');
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
  } else if (seccionId === 'historial-caja') {
    inicializarHistorialCierres();
  } else if (seccionId === 'egresos') {
    cargarEgresos();
  } else if (seccionId === 'deuda') {
    cargarDeuda();
  } else if (seccionId === 'compras') {
    cargarCompras();
  } else if (seccionId === 'proveedores') {
    cargarProveedores();
  } else if (seccionId === 'cuentas') {
    cargarCuentas();
  } else if (seccionId === 'insumos') {
    cargarInsumos();
  }
}

// INICIALIZACIÓN GLOBAL Y DELEGACIÓN DE EVENTOS
document.addEventListener('DOMContentLoaded', async () => {

  // 0. Sin sesión no se carga nada: muestra el login y espera
  await asegurarSesion();

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

  // 3. Event Listeners para POS
  
  // NUEVO: Escuchar el input de búsqueda de productos
  document.getElementById('input-busqueda-pos')?.addEventListener('input', (e) => {
    setFiltroBusquedaPOS(e.target.value);
  });

  // NUEVO: Escuchar clics en las solapas de categorías
  document.getElementById('pos-tabs-categorias')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.pos-category-tab');
    if (tab) {
      setCategoriaActivaPOS(tab.dataset.id);
    }
  });

  // NUEVO: Escuchar clic en el tachito de basura del resumen del carrito
  document.getElementById('resumen-carrito-items')?.addEventListener('click', (e) => {
    const btnEliminar = e.target.closest('[data-action="eliminar-item-carrito"]');
    if (btnEliminar) {
      eliminarItemCarrito(Number(btnEliminar.dataset.id));
      return;
    }

    // Botones "-" y "+" de cada línea del carrito (misma acción que en el catálogo).
    const btnCant = e.target.closest('[data-action="alterar-cant"]');
    if (btnCant) {
      alterarCantidad(Number(btnCant.dataset.id), Number(btnCant.dataset.delta));
    }
  });

  // (Este es el que ya tenías)
  document.getElementById('contenedor-menu-productos')?.addEventListener('click', (e) => {
    const btnPill = e.target.closest('[data-action="alterar-cant"]');
    if (btnPill) {
      const id = Number(btnPill.dataset.id);
      const delta = Number(btnPill.dataset.delta);
      alterarCantidad(id, delta);
    }
  });

  // Como usamos Select2, conectamos el evento con jQuery para que detecte el cambio de cliente
  $('#select-cliente-pedido').on('change', alCambiarCliente);
  
  // SOLUCIÓN PUNTO 8: Al cambiar de lista manualmente, SOLO refrescamos los precios de la grilla (no todo el POS)
  document.getElementById('select-lista-pedido')?.addEventListener('change', () => cargarPOS());
  // Ventana de cobro (cobro.js): elegir el medio con los botones y calcular el vuelto.
  document.getElementById('cobro-medios')?.addEventListener('click', elegirMedioCobro);
  document.getElementById('cobro-paga-con')?.addEventListener('input', actualizarVueltoCobro);

  // Escuchamos en toda la tarjeta del pedido (no solo en los botones de abajo) porque
  // "Limpiar todo" ahora está en el encabezado de la tarjeta.
  document.querySelector('.pos-order-card')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    if (action === 'guardar-pedido') {
      const estado = btn.dataset.estado;
      // "Cobrar y Entregar" abre primero la ventana de cobro; el guardado lo hace la ventana al confirmar.
      if (estado === 'COMPLETADO') iniciarCobroPOS();
      else guardarPedido(estado);
    } else if (action === 'vaciar-carrito') {
      vaciarCarrito();
    }
  });

  // 4. Event Listeners Pedidos
  document.getElementById('btn-actualizar-pedidos')?.addEventListener('click', cargarTablaPedidos);
  document.getElementById('filtro-fecha-desde')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-fecha-hasta')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-estado-pedido')?.addEventListener('change', cargarTablaPedidos);
  document.getElementById('filtro-buscar-pedido')?.addEventListener('keyup', cargarTablaPedidos);
  document.getElementById('form-cobro-pedido')?.addEventListener('submit', confirmarCobro);

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

  // 7. Event Listeners Listas
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

  // 8. Event Listeners Resumen Ventas
  document.getElementById('btn-filtrar-resumen-prod')?.addEventListener('click', generarResumenVentasProductos);

  // 9. Cierre de Caja Modal
  inicializarCierreCaja();

  // 10. Historial Cierres
  document.getElementById('btn-buscar-cierres')?.addEventListener('click', cargarTablaHistorialCierres);

  document.getElementById('tabla-historial-cierres-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="ver-detalle-cierre"]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    verDetalleCierre(id);
  });

  // 11. Compras: listado, filtros y detalle
  document.getElementById('btn-filtrar-compras')?.addEventListener('click', cargarCompras);
  document.getElementById('btn-nueva-compra')?.addEventListener('click', abrirModalNuevaCompra);
  document.getElementById('btn-anular-compra')?.addEventListener('click', anularCompraAbierta);

  document.getElementById('tabla-compras-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="ver-detalle-compra"]');
    if (!btn) return;
    verDetalleCompra(Number(btn.dataset.id));
  });

  // 12. Compras: formulario de compra nueva
  document.getElementById('form-compra')?.addEventListener('submit', guardarCompra);
  document.getElementById('btn-agregar-linea')?.addEventListener('click', agregarLinea);
  document.getElementById('compra-pagar-ahora')?.addEventListener('change', alCambiarPagarAhora);

  // Un solo "oyente" para todos los campos de las líneas (delegación de eventos).
  // 'input' avisa mientras se escribe; 'change' cubre el desplegable de insumos.
  const cuerpoLineas = document.getElementById('tabla-lineas-compra-body');
  cuerpoLineas?.addEventListener('input', alCambiarLinea);
  cuerpoLineas?.addEventListener('change', alCambiarLinea);
  cuerpoLineas?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="quitar-linea"]');
    if (!btn) return;
    quitarLinea(Number(btn.dataset.index));
  });

  // 15. Deuda a proveedores
  document.getElementById('filtro-deuda-vencida')?.addEventListener('change', renderizarDeuda);

  document.getElementById('tabla-deuda-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'ver-deuda-proveedor') {
      verDeudaProveedor(id);
    } else if (action === 'pagar-deuda-proveedor') {
      pagarDeudaProveedor(id);
    }
  });

  // Ventana con las compras pendientes de un proveedor
  document.getElementById('tabla-deuda-compras-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pagar-compra-deuda"]');
    if (!btn) return;
    pagarCompraDeLaDeuda(Number(btn.dataset.id));
  });
  document.getElementById('btn-pagar-deuda-proveedor')?.addEventListener('click', pagarDeudaProveedorAbierto);

  // 16. Pagos: ventana de pago y acciones dentro del detalle de una compra
  document.getElementById('form-pago')?.addEventListener('submit', guardarPago);
  document.getElementById('btn-pagar-compra')?.addEventListener('click', pagarCompraAbierta);

  document.getElementById('tabla-detalle-compra-pagos')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="anular-pago"]');
    if (!btn) return;
    anularPagoDeCompra(Number(btn.dataset.id));
  });

  // 17. Gastos y retiros
  document.getElementById('btn-filtrar-egresos')?.addEventListener('click', cargarEgresos);
  // Un mismo formulario para los dos: se le indica el tipo al abrirlo.
  document.getElementById('btn-nuevo-gasto')?.addEventListener('click', () => abrirModalEgreso('GASTO'));
  document.getElementById('btn-nuevo-retiro')?.addEventListener('click', () => abrirModalEgreso('RETIRO'));
  document.getElementById('form-egreso')?.addEventListener('submit', guardarEgreso);

  document.getElementById('tabla-egresos-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="anular-egreso"]');
    if (!btn) return;
    anularEgreso(Number(btn.dataset.id), btn.dataset.tipo);
  });

  // 13. Proveedores
  document.getElementById('btn-nuevo-proveedor')?.addEventListener('click', abrirModalNuevoProveedor);
  document.getElementById('form-proveedor')?.addEventListener('submit', guardarProveedor);

  document.getElementById('tabla-proveedores-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-proveedor') {
      abrirModalEditarProveedor(id);
    } else if (action === 'cambiar-estado-proveedor') {
      cambiarEstadoProveedor(id);
    }
  });

  // 16. Cuentas y saldos
  document.getElementById('btn-nueva-cuenta')?.addEventListener('click', abrirModalNuevaCuenta);
  document.getElementById('form-cuenta')?.addEventListener('submit', guardarCuenta);
  document.getElementById('btn-transferir')?.addEventListener('click', abrirModalTransferencia);
  document.getElementById('form-transferencia')?.addEventListener('submit', guardarTransferencia);
  document.getElementById('form-ajuste')?.addEventListener('submit', guardarAjuste);

  // Lista de movimientos de una cuenta: botón "Anular" de las transferencias y ajustes manuales.
  document.getElementById('mov-cuenta-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="anular-movimiento-cuenta"]');
    if (btn) anularMovimientoCuenta(Number(btn.dataset.id));
  });

  document.getElementById('tabla-cuentas-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-cuenta') {
      abrirModalEditarCuenta(id);
    } else if (action === 'ver-movimientos-cuenta') {
      abrirMovimientosCuenta(id);
    } else if (action === 'ajustar-cuenta') {
      abrirModalAjuste(id);
    } else if (action === 'cambiar-estado-cuenta') {
      cambiarEstadoCuenta(id);
    }
  });

  // 14. Insumos
  document.getElementById('btn-nuevo-insumo')?.addEventListener('click', abrirModalNuevoInsumo);
  document.getElementById('form-insumo')?.addEventListener('submit', guardarInsumo);
  // Filtros: se vuelve a dibujar la tabla (sin consultar la base) al escribir o cambiar la categoría
  document.getElementById('filtro-insumo')?.addEventListener('input', renderizarInsumos);
  document.getElementById('filtro-insumo-categoria')?.addEventListener('change', renderizarInsumos);

  document.getElementById('tabla-insumos-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (action === 'editar-insumo') {
      abrirModalEditarInsumo(id);
    } else if (action === 'cambiar-estado-insumo') {
      cambiarEstadoInsumo(id);
    }
  });

});