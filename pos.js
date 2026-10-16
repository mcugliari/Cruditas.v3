import { supabaseAdmin } from './config.js';
import { 
  carrito, setCarrito, 
  cacheProductos, setCacheProductos, 
  cachePrecios, setCachePrecios, 
  cacheCategorias, setCacheCategorias, 
  pedidoEditandoId, setPedidoEditandoId 
} from './state.js';

import { mostrarNotificacion, formatearFechaAR, obtenerFechaActualISO, mensajeErrorFuncion, esc } from './utils.js';

// Nuevas variables de estado para el POS
let categoriaSeleccionadaId = null;
let filtroBusqueda = '';

export function setFiltroBusquedaPOS(texto) {
  filtroBusqueda = texto.toLowerCase();
  renderizarGrillaPOS();
}

export function setCategoriaActivaPOS(id) {
  categoriaSeleccionadaId = Number(id);
  filtroBusqueda = ''; // Limpiamos la búsqueda si cambia de solapa
  const inputSearch = document.getElementById('input-busqueda-pos');
  if (inputSearch) inputSearch.value = '';
  renderizarGrillaPOS();
}

// Guardamos la "promesa" de la inicialización en curso. Una promesa representa
// un trabajo que todavía puede estar corriendo; con "await" se puede esperar a
// que termine. Así, otros módulos (pedidos.js) pueden esperar a que el POS
// tenga sus selects listos antes de tocarlos.
let promesaInicioPOS = null;

export function inicializarPOS() {
  // cargarSelectsPOS ya termina llamando a alCambiarCliente(), que a su vez
  // llama a cargarPOS(). Por eso no hace falta llamarlo de nuevo acá.
  // Se guarda la promesa en el momento de arrancar (antes de cualquier espera).
  promesaInicioPOS = cargarSelectsPOS();
  return promesaInicioPOS;
}

// Devuelve algo que se puede esperar con "await". Si nunca se inicializó el POS,
// devuelve una promesa ya resuelta (no espera nada).
export function esperarPOSListo() {
  return promesaInicioPOS || Promise.resolve();
}

export async function cargarSelectsPOS() {
  const { data: clientes } = await supabaseAdmin.from('TB_BCLIENTES').select('*').order('nombre');
  const { data: listas } = await supabaseAdmin.from('TB_TLISTA_PRECIOS').select('*');
  const { data: medios } = await supabaseAdmin.from('TB_BMEDIO_PAGO').select('*');

  const selectCli = document.getElementById('select-cliente-pedido');
  if (selectCli && clientes) {
    selectCli.innerHTML = clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    
    // Convertimos el select normal en un buscador usando Select2
    $('#select-cliente-pedido').select2({
      width: '100%',
      placeholder: 'Buscar cliente...',
      language: { noResults: () => "No se encontraron clientes" }
    });
  }

  const selectLis = document.getElementById('select-lista-pedido');
  if (selectLis && listas) selectLis.innerHTML = listas.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');

 // 3. Cargar Medios de Pago
  const selectMed = document.getElementById('select-medio-pago');
  if (selectMed && medios) {
    selectMed.innerHTML = medios.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');
    
    // NUEVO: Buscar "Efectivo" inteligentemente y dejarlo seleccionado por defecto
    const optEfectivo = Array.from(selectMed.options).find(opt => opt.text.toLowerCase().includes('efectivo'));
    if (optEfectivo) {
      selectMed.value = optEfectivo.value;
    }
  }

  await alCambiarCliente();
}

export async function alCambiarCliente() {
  const selectCli = document.getElementById('select-cliente-pedido');
  if (!selectCli || !selectCli.value) return;

  const idCliente = selectCli.value;
  const inputRef = document.getElementById('input-ref-cliente');

  // Supongamos que el ID de Consumidor Final es 1 (o podés verificar por el texto)
  const esConsumidorFinal = idCliente === '1' || selectCli.options[selectCli.selectedIndex]?.text.toLowerCase().includes('consumidor final');
  const inputNombre = document.getElementById('input-ref-cliente');
  const labelNombre = document.getElementById('label-ref-cliente');

  if (inputRef) {
    if (!esConsumidorFinal) {
      // Si eligen un cliente registrado, limpiamos la referencia opcional
      inputRef.value = '';
      if (labelNombre) labelNombre.innerText = 'Nombre / Referencia (Opcional)';
      if (inputNombre) inputNombre.placeholder = 'Referencia opcional';
    } else {
      if (labelNombre) labelNombre.innerHTML = 'Nombre / Referencia <small class="text-muted font-weight-normal">(obligatorio, salvo al cobrar y entregar)</small>';
      if (inputNombre) inputNombre.placeholder = 'Ej: Carlos (Retira 21hs)'; 
    }
  }

  // Buscar la lista de precios predeterminada del cliente
  const { data } = await supabaseAdmin
    .from('TB_ACLIENTE_LISTA_PRECIOS')
    .select('id_lista_precio')
    .eq('id_cliente', selectCli.value)
    .eq('m_predeterminada', true)
    .maybeSingle();

  const selectLista = document.getElementById('select-lista-pedido');
  if (selectLista) {
    if (data && data.id_lista_precio) {
      // El cliente tiene lista predeterminada: la usamos.
      selectLista.value = data.id_lista_precio;
    } else {
      // No tiene: volvemos a la lista base (id 1, la misma que usa cargarPOS
      // como respaldo) para no arrastrar la lista del cliente anterior.
      selectLista.value = '1';
      // Si por algún motivo no existe una lista con id 1, el select queda
      // vacío (value ''); en ese caso elegimos la primera opción disponible.
      if (!selectLista.value) selectLista.selectedIndex = 0;
    }
  }
  
  await cargarPOS();
}

export async function cargarPOS() {
  const selectLis = document.getElementById('select-lista-pedido');
  const idLista = selectLis && selectLis.value ? parseInt(selectLis.value) : 1;

  const { data: categorias } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('id');
  const { data: productos } = await supabaseAdmin.from('TB_BPRODUCTOS').select('*').order('id');
  const { data: precios } = await supabaseAdmin.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', idLista);

  setCacheCategorias(categorias || []);
  setCacheProductos(productos || []);
  setCachePrecios(precios || []);

  renderizarGrillaPOS();
}

// Devuelve la clase del ícono de Font Awesome según el nombre de la categoría.
// Está en una función aparte porque lo usan las solapas Y las etiquetas de las
// tarjetas cuando se busca: así los dos lugares siempre muestran el mismo ícono.
function iconoCategoria(nombre) {
  const nom = String(nombre || '').toLowerCase();
  if (nom.includes('pizza')) return 'fa-pizza-slice';
  if (nom.includes('empanada')) return 'fa-cookie-bite';
  if (nom.includes('canastita')) return 'fa-shopping-basket';
  if (nom.includes('bebida')) return 'fa-wine-bottle';
  if (nom.includes('otros')) return 'fa-th-large';
  return 'fa-utensils'; // respaldo para cualquier categoría nueva
}

export function renderizarGrillaPOS() {
  const contenedor = document.getElementById('contenedor-menu-productos');
  const contenedorTabs = document.getElementById('pos-tabs-categorias');
  if (!contenedor) return;

  if (!Array.isArray(cacheCategorias) || !Array.isArray(cacheProductos)) {
    contenedor.innerHTML = '<p class="text-muted text-center my-3">Cargando menú...</p>';
    return;
  }

  // ¿Hay una búsqueda activa? Lo calculamos una sola vez y lo usan las solapas
  // y las tarjetas más abajo.
  const buscando = filtroBusqueda.trim() !== '';

  // 1. RENDERIZAR SOLAPAS (TABS)
  if (contenedorTabs) {
    let tabsHtml = '';
    cacheCategorias.forEach(cat => {
      if (Number(cat.id) === 99) return; // Omitir sistema/bonificaciones
      
      // Si no hay categoría seleccionada, marcamos la primera por defecto
      if (!categoriaSeleccionadaId) categoriaSeleccionadaId = Number(cat.id);
      
      const isActive = (!buscando && categoriaSeleccionadaId === Number(cat.id)) ? 'is-active' : '';
      
      // Asignar un icono según el nombre de la categoría (puedes personalizarlos)
      const iconClass = iconoCategoria(cat.nombre);

      tabsHtml += `
        <button class="pos-category-tab ${isActive}" data-id="${cat.id}">
          <i class="fas ${iconClass} pos-category-icon"></i> ${esc(cat.nombre)}
        </button>
      `;
    });
    contenedorTabs.innerHTML = tabsHtml;
  }

  // 2. FILTRAR PRODUCTOS (Por búsqueda o por categoría activa)
  let prodsMostrar = cacheProductos.filter(p => Number(p.id) !== 999);

  if (filtroBusqueda.trim() !== '') {
    // Si hay texto en el buscador, ignoramos la solapa y buscamos en todo
    prodsMostrar = prodsMostrar.filter(p => p.nombre.toLowerCase().includes(filtroBusqueda));
  } else {
    // Si no busca nada, mostramos solo los de la solapa activa
    prodsMostrar = prodsMostrar.filter(p => Number(p.id_categoria || p.idCategoria) === categoriaSeleccionadaId);
  }

  // 3. RENDERIZAR GRILLA
  if (prodsMostrar.length === 0) {
    contenedor.innerHTML = '<p class="text-muted text-center my-4 w-100">No se encontraron productos.</p>';
    return;
  }

  let htmlCompleto = '<div class="pos-catalog-content"><div class="pos-product-grid">';

  prodsMostrar.forEach(p => {
    const cant = carrito[p.id] || 0;
    const idCatProd = p.id_categoria || p.idCategoria;
    const precios = obtenerPrecioProducto(p.id, idCatProd);
    const claseActiva = cant > 0 ? 'pos-card-activa' : '';
    const permiteDocena = Boolean(p.m_permite_docena);

    
    // Etiqueta de categoría: solo mientras se busca. Dentro de una solapa ya se
    // sabe a qué categoría pertenece cada tarjeta, así que sería redundante.
    let etiquetaCategoria = '';
    if (buscando) {
      // .find() devuelve la primera categoría cuyo id coincide (o undefined)
      const cat = cacheCategorias.find(c => Number(c.id) === Number(idCatProd));
      if (cat) {
        etiquetaCategoria = `<span class="pos-prod-cat"><i class="fas ${iconoCategoria(cat.nombre)}"></i>${esc(cat.nombre)}</span>`;
      }
    }

    const botonesDocenaHTML = permiteDocena ? `
      <div class="d-flex justify-content-between gap-1 mt-2">
        <button type="button" class="btn btn-docena-pill flex-fill mr-1" data-action="alterar-cant" data-id="${p.id}" data-delta="-12">-12 u.</button>
        <button type="button" class="btn btn-docena-pill flex-fill" data-action="alterar-cant" data-id="${p.id}" data-delta="12">+12 u.</button>
      </div>
    ` : '';

    htmlCompleto += `
      <!-- Eliminamos el borde de color (border-left-...) para dejar el diseño más limpio de la imagen -->
      <div class="card h-100 pos-card-producto border-0 ${claseActiva}">
        ${etiquetaCategoria}
        <strong class="pos-prod-title" title="${esc(p.nombre)}">${esc(p.nombre)}</strong>
        <span class="pos-prod-price mb-2">$${precios.unidad.toLocaleString('es-AR')}</span>
        
        <div class="pos-qty-pill">
          <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="-1">-</button>
          <span class="pos-cant-num" id="cant-prod-${p.id}">${cant}</span>
          <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="1">+</button>
        </div>

        ${botonesDocenaHTML}
      </div>
    `;
  });

  htmlCompleto += '</div></div>';
  contenedor.innerHTML = htmlCompleto;
  actualizarResumenCarrito(); // Garantizamos sincronización del carrito visual
}

export function obtenerPrecioProducto(idProd, idCat, idLista = null) {
  if (!cachePrecios || cachePrecios.length === 0) return { unidad: 0, docena: 0 };

  const idP = Number(idProd);
  const idC = Number(idCat);
  const idL = idLista ? Number(idLista) : Number(document.getElementById('select-lista-pedido')?.value || 0);

  const preciosFiltrados = cachePrecios.filter(p => !idL || Number(p.id_lista_precio || p.id_lista) === idL);
  const listaABuscar = preciosFiltrados.length > 0 ? preciosFiltrados : cachePrecios;

  const pProd = listaABuscar.find(p => p.id_producto !== null && Number(p.id_producto) === idP);
  if (pProd) {
    const un = Number(pProd.precio_unidad ?? pProd.precio ?? 0);
    const doc = pProd.precio_docena ? Number(pProd.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  const pCat = listaABuscar.find(p => Number(p.id_categoria) === idC && (p.id_producto === null || p.id_producto === undefined));
  if (pCat) {
    const un = Number(pCat.precio_unidad ?? pCat.precio ?? 0);
    const doc = pCat.precio_docena ? Number(pCat.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  return { unidad: 0, docena: 0 };
}

export function calcularSubtotalItem(cantidad, precios, permiteDocena = true) {
  if (!permiteDocena || !precios.docena) {
    return cantidad * precios.unidad;
  }
  const docenas = Math.floor(cantidad / 12);
  const sueltas = cantidad % 12;

  return (docenas * precios.docena) + (sueltas * precios.unidad);
}

export function alterarCantidad(idProducto, delta) {
  const actual = carrito[idProducto] || 0;
  const nueva = Math.max(0, actual + delta);
  
  if (nueva === 0) {
    delete carrito[idProducto];
  } else {
    carrito[idProducto] = nueva;
  }

  // Buscar el elemento contador en el DOM
  const elCant = document.getElementById(`cant-prod-${idProducto}`);
  
  if (elCant) {
    elCant.innerText = nueva;
    // Encontrar la tarjeta contenedora
    const tarjeta = elCant.closest('.pos-card-producto');
    if (tarjeta) {
      if (nueva > 0) {
        tarjeta.classList.add('pos-card-activa');
      } else {
        tarjeta.classList.remove('pos-card-activa');
      }
    }
  } else {
    // Si no está el elemento específico, re-renderizar la grilla completa
    renderizarGrillaPOS();
  }

  actualizarResumenCarrito();
}

export function actualizarResumenCarrito() {
  const contenedorItems = document.getElementById('resumen-carrito-items');
  const keys = Object.keys(carrito);

  if (keys.length === 0) {
    if (contenedorItems) contenedorItems.innerHTML = `<p class="text-center text-muted small my-3">El carrito está vacío</p>`;
    document.getElementById('cant-total-items').innerText = '0';
    document.getElementById('monto-total-pedido').innerText = '$0';
    return;
  }

  const idLista = document.getElementById('select-lista-pedido')?.value;

  let totalItems = 0;
  let subtotalSinDescuento = 0;
  let totalSueltasDocenables = 0;
  let precioDocenaSugerido = 0;
  let precioUnidadDocenable = 0;

  let html = '<ul class="list-group list-group-flush small">';

  // 1. Renderizar cada producto a su precio unitario de lista
  keys.forEach(idProd => {

    // FILTRO: Omitir el producto bonificación 999 para que no aparezca como ítem normal
    if (Number(idProd) === 999) return;
    
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cant = Number(carrito[idProd]) || 0;
    if (cant <= 0) return;

    totalItems += cant;

    const idCatProd = p.id_categoria || p.idCategoria;
    const cat = cacheCategorias.find(c => Number(idCatProd) === Number(c.id));
    const nombreCat = cat ? cat.nombre : '';
    const textoProducto = nombreCat ? `${nombreCat} ${p.nombre}` : p.nombre;

    const precios = obtenerPrecioProducto(p.id, idCatProd, idLista);
    const precioUnidad = precios.unidad || 0;
    const subTotalProducto = cant * precioUnidad;

    subtotalSinDescuento += subTotalProducto;

    if (p.m_permite_docena) {
      totalSueltasDocenables += cant;
      if (precios.docena) precioDocenaSugerido = precios.docena;
      if (precioUnidad) precioUnidadDocenable = precioUnidad;
    }

    html += `
      <li class="list-group-item p-2 bg-transparent border-bottom">
        <div class="d-flex justify-content-between align-items-start mb-1">
          <strong class="text-dark d-block" style="line-height: 1.2;">${esc(textoProducto)}</strong>
          <button class="btn btn-sm text-secondary p-0 ml-2" data-action="eliminar-item-carrito" data-id="${idProd}" title="Eliminar ítem">
            <i class="far fa-trash-alt"></i>
          </button>
        </div>
        <div class="d-flex justify-content-between align-items-center">
          <span class="text-muted small font-weight-bold" style="width: 25%;">${cant} u.</span>
          <span class="text-muted small text-center" style="width: 40%;">$${precioUnidad.toLocaleString('es-AR')} c/u</span>
          <strong class="text-dark text-right" style="width: 35%;">$${subTotalProducto.toLocaleString('es-AR')}</strong>
        </div>
      </li>
    `;
  });

  // 2. Calcular si corresponde el Descuento por Docena combinada
  let montoTotalFinal = subtotalSinDescuento;
  const docenasCompletas = Math.floor(totalSueltasDocenables / 12);

  if (docenasCompletas > 0 && precioDocenaSugerido > 0) {
    const descuentoUnidadDocena = (precioUnidadDocenable * 12) - precioDocenaSugerido;
    const descuentoTotal = descuentoUnidadDocena * docenasCompletas;

    if (descuentoTotal > 0) {
      montoTotalFinal -= descuentoTotal;

      html += `
        <li class="list-group-item d-flex justify-content-between align-items-center p-2 bg-light text-danger border-bottom">
          <div>
            <strong class="d-block text-danger"><i class="fas fa-tag mr-1"></i> Descuento por Docena</strong>
            <small class="text-muted">${docenasCompletas} doc. promocional(es)</small>
          </div>
          <span class="font-weight-bold">-$${descuentoTotal.toLocaleString('es-AR')}</span>
        </li>
      `;
    }
  }

  html += '</ul>';
  if (contenedorItems) contenedorItems.innerHTML = html;

  document.getElementById('cant-total-items').innerText = totalItems;
  document.getElementById('monto-total-pedido').innerText = `$${montoTotalFinal.toLocaleString('es-AR')}`;
}

export async function resetearPedido() {
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = '';

  // 1. Resetear selector de Medio de Pago
  const selectMedio = document.getElementById('select-medio-pago');
  if (selectMedio) {
    // Buscar inteligentemente "Efectivo" para volver a ponerlo por defecto
    const optEfectivo = Array.from(selectMedio.options).find(opt => opt.text.toLowerCase().includes('efectivo'));
    if (optEfectivo) {
      selectMedio.value = optEfectivo.value;
    } else {
      selectMedio.selectedIndex = 0; // Respaldo por si algun dia borran "Efectivo"
    }
  }

  // 2. Resetear selector de Cliente a Consumidor Final (ID 1)
  // Como ahora usamos Select2, lo actualizamos con jQuery
  const selectCli = $('#select-cliente-pedido');
  if (selectCli.length) {
    selectCli.val('1').trigger('change');
  }

  setPedidoEditandoId(null);
  setCarrito({});

  // 3. Recargar la grilla de precios del POS
  await cargarPOS();        
}

export function vaciarCarrito() {
  resetearPedido();
}

export async function guardarPedido(estadoInicial) {
  const keys = Object.keys(carrito);
  if (keys.length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  const idCliente = document.getElementById('select-cliente-pedido').value;
  const idLista = document.getElementById('select-lista-pedido').value;
  const selectMedio = document.getElementById('select-medio-pago');
  const idMedio = selectMedio ? selectMedio.value : null;

  const inputRef = document.getElementById('input-ref-cliente');
  const nombreReferencia = inputRef ? inputRef.value.trim() : null;

  // ⚠️️ VALIDACIÓN: Si es ID 1 (Consumidor Final) y no puso nombre/referencia
   // La referencia solo se exige si el pedido NO se cobra y entrega en el momento.
  // estadoInicial llega desde el botón que se apretó: 'COMPLETADO' es "Cobrar y Entregar".
  // Con PREPARACION o ENTREGADO_IMPAGO hace falta saber a quién entregar o reclamar.
  const seCobraYEntregaYa = estadoInicial === 'COMPLETADO';
  if (idCliente === '1' && nombreReferencia === '' && !seCobraYEntregaYa) {
    // Cambié alert() por el aviso del sistema, como en el resto de la app
    mostrarNotificacion('Indicá un nombre o referencia. Solo podés omitirlo si cobrás y entregás en el momento.', 'warning');
    if (inputRef) inputRef.focus();
    return; // Interrumpe el guardado
  }

  let montoTotal = 0;
  const detalles = [];

  let totalSueltasDocenables = 0;
  let precioDocenaSugerido = 0;
  let precioUnidadDocenable = 0;

  const fechaISO = obtenerFechaActualISO();

  // 1. Guardar los productos seleccionados a precio unitario normal
  keys.forEach(idProd => {
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cantidadTotal = Number(carrito[idProd]) || 0;
    if (cantidadTotal <= 0) return;

    const precios = obtenerPrecioProducto(p.id, p.id_categoria || p.idCategoria, idLista);
    const precioUnidad = precios.unidad || 0;

    if (p.m_permite_docena) {
      totalSueltasDocenables += cantidadTotal;
      if (precios.docena) precioDocenaSugerido = precios.docena;
      if (precioUnidad) precioUnidadDocenable = precioUnidad;
    }

    const subTotalItem = cantidadTotal * precioUnidad;

    detalles.push({
      id_pedido: null,
      id_producto: p.id,
      cantidad: cantidadTotal,
      precioUnitario: precioUnidad,
      subTotal: subTotalItem
    });

    montoTotal += subTotalItem;
  });

  // 2. Si completa docenas combinadas, agregar renglón de bonificación (Producto 999)
  const docenasCompletas = Math.floor(totalSueltasDocenables / 12);
  if (docenasCompletas > 0 && precioDocenaSugerido > 0) {
    const descuentoPorDocena = (precioUnidadDocenable * 12) - precioDocenaSugerido;
    const descuentoTotal = descuentoPorDocena * docenasCompletas;

    if (descuentoTotal > 0) {
      detalles.push({
        id_pedido: null,
        id_producto: 999, // Producto 'Descuento por Docena'
        cantidad: docenasCompletas,
        precioUnitario: -descuentoPorDocena,
        subTotal: -descuentoTotal
      });

      montoTotal -= descuentoTotal;
    }
  }

  let idPedidoFinal = pedidoEditandoId;

  if (pedidoEditandoId) {
    const { error: errUpdate } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .update({
        id_cliente: idCliente,
        nombre_referencia: nombreReferencia,
        id_lista_precio: idLista,
        id_medio_pago: idMedio,
        estado: estadoInicial,
        importe_total: montoTotal
      })
      .eq('id', pedidoEditandoId);

    if (errUpdate) {
      mostrarNotificacion('Error al actualizar cabecera: ' + mensajeErrorFuncion(errUpdate, 'pedido'), 'danger');
      return;
    }

    await supabaseAdmin.from('TB_DPEDIDOS').delete().eq('id_pedido', pedidoEditandoId);

  } else {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .insert([{
        fecha: fechaISO,
        id_cliente: idCliente,
        nombre_referencia: nombreReferencia,
        id_lista_precio: idLista,
        id_medio_pago: idMedio,
        estado: estadoInicial,
        importe_total: montoTotal
      }])
      .select()
      .single();

    if (error) {
      mostrarNotificacion('Error al guardar el pedido: ' + mensajeErrorFuncion(error, 'pedido'), 'danger');
      return;
    }
    idPedidoFinal = pedido.id;
  }

  detalles.forEach(d => d.id_pedido = idPedidoFinal);

  const { error: errorDetalle } = await supabaseAdmin.from('TB_DPEDIDOS').insert(detalles);

  if (errorDetalle) {
    mostrarNotificacion('Error al guardar el detalle: ' + errorDetalle.message, 'danger');
    return;
  }

  mostrarNotificacion(`¡Pedido #${idPedidoFinal} ${pedidoEditandoId ? 'actualizado' : 'registrado'} con éxito!`, 'success');

  if (inputRef) inputRef.value = '';

  setPedidoEditandoId(null);
  resetearPedido();
}

export function eliminarItemCarrito(idProducto) {
  if (carrito[idProducto]) {
    delete carrito[idProducto]; // Borramos el ítem del estado
    
    // Si el producto se está viendo ahora mismo en la grilla, reseteamos el contador
    const elCant = document.getElementById(`cant-prod-${idProducto}`);
    if (elCant) {
      elCant.innerText = '0';
      const tarjeta = elCant.closest('.pos-card-producto');
      if (tarjeta) tarjeta.classList.remove('pos-card-activa');
    } else {
      // Si el producto está en otra solapa oculta, re-renderizamos todo
      renderizarGrillaPOS();
    }
    
    actualizarResumenCarrito();
  }
}