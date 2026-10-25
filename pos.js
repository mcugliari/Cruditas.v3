import { supabaseAdmin } from './config.js';
import { 
  carrito, setCarrito, 
  cacheProductos, setCacheProductos, 
  cachePrecios, setCachePrecios, 
  cacheCategorias, setCacheCategorias, 
  pedidoEditandoId, setPedidoEditandoId 
} from './state.js';

import { mostrarNotificacion, formatearFechaAR, obtenerFechaActualISO, mensajeErrorFuncion, esc, confirmarAccion } from './utils.js';
import { abrirModalCobro } from './cobro.js';

// Nuevas variables de estado para el POS
let grupoSeleccionado = null;   // clave (en minúsculas) del grupo/solapa activa
let filtroBusqueda = '';

export function setFiltroBusquedaPOS(texto) {
  filtroBusqueda = texto.toLowerCase();
  renderizarGrillaPOS();
}

export function setCategoriaActivaPOS(id) {
  grupoSeleccionado = String(id);   // ahora "id" es la clave del grupo, no un número
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
// Total y unidades del carrito, calculados en actualizarResumenCarrito. Se guardan acá
// para mostrarlos en la ventana de cobro sin volver a calcular.
let totalCarritoActual = 0;
let unidadesCarritoActual = 0;

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

// Nombre del grupo (solapa) al que pertenece una categoría. Si la categoría no
// tiene grupo cargado, usa su propio nombre: queda como solapa propia.
function grupoDeCategoria(cat) {
  return String(cat.grupo || '').trim() || String(cat.nombre || '').trim();
}

// El grupo "sistema" (bonificaciones) no se muestra como solapa.
// Se mantiene también la comprobación del id 99 como seguridad extra.
function esCategoriaSistema(cat) {
  return Number(cat.id) === 99 || grupoDeCategoria(cat).toUpperCase() === 'SISTEMA';
}

// Texto de la solapa: 'PIZZAS' -> 'Pizzas'
function titularGrupo(texto) {
  const t = String(texto).trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
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

// -----------------------------------------------------------------------------
// urlImagenSegura
//   La foto viene de la base (columna imagen_url). Solo dejamos pasar direcciones
//   que empiecen con http:// o https://; cualquier otra cosa (vacío, "javascript:...")
//   se trata como "sin foto" y se muestra el ícono de reemplazo.
// -----------------------------------------------------------------------------
function urlImagenSegura(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
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
    // Armamos la lista de grupos SIN repetir, en el orden en que aparecen las
    // categorías. Un Map guarda pares "clave -> texto a mostrar".
    // La clave va en minúsculas para que 'Pizzas' y 'PIZZAS' cuenten como el mismo grupo.
    const grupos = new Map();
    cacheCategorias.forEach(cat => {
      if (esCategoriaSistema(cat)) return;
      const clave = grupoDeCategoria(cat).toLowerCase();
      if (!grupos.has(clave)) grupos.set(clave, titularGrupo(grupoDeCategoria(cat)));
    });

    // Si todavía no hay solapa elegida (o la elegida ya no existe), usamos la primera.
    if (!grupos.has(grupoSeleccionado)) grupoSeleccionado = grupos.keys().next().value ?? null;

    let tabsHtml = '';
    grupos.forEach((texto, clave) => {
      const isActive = clave === grupoSeleccionado ? 'is-active' : '';
      tabsHtml += `
        <button class="pos-category-tab ${isActive}" data-id="${esc(clave)}">
          <i class="fas ${iconoCategoria(texto)} pos-category-icon"></i> ${esc(texto)}
        </button>
      `;
    });
    contenedorTabs.innerHTML = tabsHtml;
  }

  // 2. FILTRAR PRODUCTOS (Por búsqueda o por categoría activa)
  let prodsMostrar = cacheProductos.filter(p => Number(p.id) !== 999);
  
  // Categorías que pertenecen a la solapa activa (ej.: las 3 de pizzas) y sus ids.
  const categoriasDelGrupo = cacheCategorias.filter(
    cat => !esCategoriaSistema(cat) && grupoDeCategoria(cat).toLowerCase() === grupoSeleccionado
  );
  const idsCategoriasDelGrupo = new Set(categoriasDelGrupo.map(cat => Number(cat.id)));


  if (filtroBusqueda.trim() !== '') {
    // Si hay texto en el buscador, ignoramos la solapa y buscamos en todo
    prodsMostrar = prodsMostrar.filter(p => p.nombre.toLowerCase().includes(filtroBusqueda));
  } else {
    // Productos de TODAS las categorías del grupo, ordenados por categoría
    // (sort es estable: dentro de cada categoría conservan el orden que ya tenían).
    const posCategoria = p => cacheCategorias.findIndex(c => Number(c.id) === Number(p.id_categoria || p.idCategoria));
    prodsMostrar = prodsMostrar
      .filter(p => idsCategoriasDelGrupo.has(Number(p.id_categoria || p.idCategoria)))
      .sort((a, b) => posCategoria(a) - posCategoria(b));
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
    if (buscando || categoriasDelGrupo.length > 1) {
      // .find() devuelve la primera categoría cuyo id coincide (o undefined)
      const cat = cacheCategorias.find(c => Number(c.id) === Number(idCatProd));
      if (cat) {
        etiquetaCategoria = `<span class="pos-prod-cat"><i class="fas ${iconoCategoria(cat.nombre)}"></i>${esc(cat.nombre)}</span>`;
      }
    }

    // Botones de acceso rápido: +6 y +12 (solo en productos que permiten docena).
    const botonesDocenaHTML = permiteDocena ? `
      <div class="pos-dozen-controls">
        <button type="button" class="btn btn-docena-pill" data-action="alterar-cant" data-id="${p.id}" data-delta="6">+6</button>
        <button type="button" class="btn btn-docena-pill btn-docena-add" data-action="alterar-cant" data-id="${p.id}" data-delta="12">+12</button>
      </div>
    ` : '';

    // Foto: el ícono de la categoría queda SIEMPRE debajo como reemplazo. Si hay URL, la
    // <img> se dibuja encima; si la imagen no carga (onerror), se quita sola y se ve el ícono.
    const catProd = cacheCategorias.find(c => Number(c.id) === Number(idCatProd));
    const urlFoto = urlImagenSegura(p.imagen_url);
    const fotoHTML = `
      <div class="pos-prod-img">
        <i class="fas ${iconoCategoria(catProd ? catProd.nombre : '')} pos-prod-ph" aria-hidden="true"></i>
        ${urlFoto ? `<img src="${esc(urlFoto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      </div>
    `;

    // Una docena o más (>= 12 u.) pinta la tarjeta con un tono más intenso.
    const claseDocena = cant >= 12 ? 'pos-card-docena' : '';

    htmlCompleto += `
      <div class="card h-100 pos-card-producto border-0 ${claseActiva} ${claseDocena}">
        <!-- "X": vuelve el ítem a 0 de un toque. Solo se ve con cantidad > 0.
             Reusa la acción "alterar-cant" con un delta enorme negativo: alterarCantidad
             nunca baja de 0, así que el resultado es siempre 0. -->
        <button type="button" class="pos-btn-reset ${cant > 0 ? '' : 'd-none'}" data-action="alterar-cant" data-id="${p.id}" data-delta="-100000" title="Quitar del pedido" aria-label="Quitar ${esc(p.nombre)} del pedido">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
        ${fotoHTML}
        ${etiquetaCategoria}
        <strong class="pos-prod-title" title="${esc(p.nombre)}">${esc(p.nombre)}</strong>
        <span class="pos-prod-price">$${precios.unidad.toLocaleString('es-AR')}</span>

        <div class="pos-qty-pill">
          <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="-1">-</button>
          <span class="pos-cant-num" id="cant-prod-${p.id}">${cant}</span>
          <button type="button" class="btn btn-pos-sq btn-pos-add" data-action="alterar-cant" data-id="${p.id}" data-delta="1">+</button>
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

  // Si la tarjeta está en pantalla se actualiza sola; si no (otra solapa), se re-dibuja la grilla.
  if (!sincronizarTarjeta(idProducto, nueva)) {
    renderizarGrillaPOS();
  }

  actualizarResumenCarrito();
}

// -----------------------------------------------------------------------------
// sincronizarTarjeta  (interna)
//   Deja la tarjeta del catálogo al día con la cantidad: número, estado "activa",
//   tono de "docena" (>= 12 u.) y botón "X". Devuelve false si la tarjeta no está
//   en pantalla (por ejemplo, está en otra solapa).
//   La usan alterarCantidad y eliminarItemCarrito, así hay UNA sola lógica.
// -----------------------------------------------------------------------------
function sincronizarTarjeta(idProducto, cant) {
  const elCant = document.getElementById(`cant-prod-${idProducto}`);
  if (!elCant) return false;

  elCant.innerText = cant;
  const tarjeta = elCant.closest('.pos-card-producto');
  if (tarjeta) {
    // classList.toggle(clase, condicion): agrega la clase si es true, la quita si es false.
    tarjeta.classList.toggle('pos-card-activa', cant > 0);
    tarjeta.classList.toggle('pos-card-docena', cant >= 12);
    const botonX = tarjeta.querySelector('.pos-btn-reset');
    if (botonX) botonX.classList.toggle('d-none', cant <= 0);
  }
  return true;
}

export function actualizarResumenCarrito() {
  const contenedorItems = document.getElementById('resumen-carrito-items');
  const keys = Object.keys(carrito);

  // Escribe un texto en un elemento solo si existe (así un id faltante no rompe el POS).
  const poner = (id, texto) => {
    const el = document.getElementById(id);
    if (el) el.innerText = texto;
  };

  if (keys.length === 0) {
    if (contenedorItems) contenedorItems.innerHTML = `<p class="pos-cart-empty">El carrito está vacío</p>`;
    poner('cant-total-items', '0');
    poner('badge-carrito', '0');
    poner('subtotal-pedido', '$0');
    poner('monto-total-pedido', '$0');
    poner('monto-descuento', '-$0');
    document.getElementById('pos-desglose')?.classList.add('d-none');
    totalCarritoActual = 0;
    unidadesCarritoActual = 0;
    return;
  }

  const idLista = document.getElementById('select-lista-pedido')?.value;

  let totalItems = 0;
  let subtotalSinDescuento = 0;
  let totalSueltasDocenables = 0;
  let precioDocenaSugerido = 0;
  let precioUnidadDocenable = 0;

  let html = '<ul class="pos-cart-list">';

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

    const precios = obtenerPrecioProducto(p.id, idCatProd, idLista);
    const precioUnidad = precios.unidad || 0;
    const subTotalProducto = cant * precioUnidad;

    subtotalSinDescuento += subTotalProducto;

    if (p.m_permite_docena) {
      totalSueltasDocenables += cant;
      if (precios.docena) precioDocenaSugerido = precios.docena;
      if (precioUnidad) precioUnidadDocenable = precioUnidad;
    }

    // Miniatura: igual que en el catálogo (ícono de reemplazo + foto encima si hay URL).
    const urlFoto = urlImagenSegura(p.imagen_url);
    const miniatura = `
      <div class="pos-cart-thumb">
        <i class="fas ${iconoCategoria(nombreCat)} pos-prod-ph" aria-hidden="true"></i>
        ${urlFoto ? `<img src="${esc(urlFoto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      </div>`;

    html += `
      <li class="pos-cart-line">
        ${miniatura}
        <div class="pos-cart-info">
          <strong class="pos-cart-name" title="${esc(nombreCat)} ${esc(p.nombre)}">${esc(p.nombre)}</strong>
          <span class="pos-cart-sub">
            <span class="pos-cart-cat">${esc(nombreCat)}</span>
            <span>$${precioUnidad.toLocaleString('es-AR')} c/u</span>
          </span>
        </div>
        <div class="pos-cart-qty">
          <button type="button" class="pos-cart-btn" data-action="alterar-cant" data-id="${idProd}" data-delta="-1" aria-label="Quitar una unidad de ${esc(p.nombre)}"><i class="fas fa-minus" aria-hidden="true"></i></button>
          <span class="pos-cart-n">${cant}</span>
          <button type="button" class="pos-cart-btn pos-cart-btn-add" data-action="alterar-cant" data-id="${idProd}" data-delta="1" aria-label="Agregar una unidad de ${esc(p.nombre)}"><i class="fas fa-plus" aria-hidden="true"></i></button>
        </div>
        <strong class="pos-cart-total">$${subTotalProducto.toLocaleString('es-AR')}</strong>
        <button type="button" class="pos-cart-del" data-action="eliminar-item-carrito" data-id="${idProd}" title="Eliminar ítem" aria-label="Eliminar ${esc(p.nombre)} del pedido">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </li>
    `;
  });

  // 2. Calcular si corresponde el Descuento por Docena combinada
  let montoTotalFinal = subtotalSinDescuento;
  let descuentoTotal = 0;
  const docenasCompletas = Math.floor(totalSueltasDocenables / 12);

  if (docenasCompletas > 0 && precioDocenaSugerido > 0) {
    const descuentoUnidadDocena = (precioUnidadDocenable * 12) - precioDocenaSugerido;
    if (descuentoUnidadDocena > 0) {
      descuentoTotal = descuentoUnidadDocena * docenasCompletas;
      montoTotalFinal -= descuentoTotal;
    }
  }

  html += '</ul>';
  if (contenedorItems) contenedorItems.innerHTML = html;

  const textoTotal = `$${montoTotalFinal.toLocaleString('es-AR')}`;
  poner('cant-total-items', totalItems);
  poner('badge-carrito', totalItems);
  // Desglose (solo si hay descuento): primero el Subtotal, después el Descuento, y recién abajo el total.
  poner('subtotal-pedido', `$${subtotalSinDescuento.toLocaleString('es-AR')}`);
  poner('monto-descuento', `-$${descuentoTotal.toLocaleString('es-AR')}`);
  poner('detalle-descuento', `(${docenasCompletas} doc.)`);
  document.getElementById('pos-desglose')?.classList.toggle('d-none', descuentoTotal <= 0);
  poner('monto-total-pedido', textoTotal);
  // Los guardamos para mostrarlos en la ventana de cobro.
  totalCarritoActual = montoTotalFinal;
  unidadesCarritoActual = totalItems;
}

export async function resetearPedido() {
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = '';


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

export async function vaciarCarrito() {
  // Si hay productos cargados pedimos confirmar: un clic accidental borraría todo el pedido.
  // confirmarAccion (utils.js) es nuestra ventana propia; con "await" se espera la respuesta.
  if (Object.keys(carrito).length > 0) {
    const ok = await confirmarAccion({
      titulo: 'Vaciar pedido',
      mensaje: 'Se van a quitar todos los productos del pedido actual. ¿Querés continuar?',
      textoConfirmar: 'Sí, vaciar',
      peligro: true
    });
    if (!ok) return;   // canceló: no se toca nada
  }
  resetearPedido();
}

// cobro: null, o { idMedio, idCuenta } cuando viene de la ventana de cobro (solo al cobrar y entregar).
export async function guardarPedido(estadoInicial, cobro = null) {
  const keys = Object.keys(carrito);
  if (keys.length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  const idCliente = document.getElementById('select-cliente-pedido').value;
  const idLista = document.getElementById('select-lista-pedido').value;
  // Medio y cuenta llegan de la ventana de cobro (cobro.js) y SOLO al cobrar y entregar.
  // Un pedido que todavía no se cobró queda con medio y cuenta en NULL.
  if (estadoInicial === 'COMPLETADO' && !cobro) {
    mostrarNotificacion('Para cobrar, usá la ventana de cobro.', 'warning');
    return;
  }
  const idMedio = cobro ? cobro.idMedio : null;
  const idCuenta = cobro ? cobro.idCuenta : null;

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
        id_cuenta: idCuenta,
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
        id_cuenta: idCuenta,
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

// -----------------------------------------------------------------------------
// iniciarCobroPOS
//   Se ejecuta al apretar "Cobrar y Entregar". En vez de guardar directo, abre la
//   ventana de cobro (cobro.js); el pedido se guarda recién cuando se confirma ahí.
// -----------------------------------------------------------------------------
export async function iniciarCobroPOS() {
  if (Object.keys(carrito).length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  await abrirModalCobro({
    titulo: 'Cobrar y Entregar',
    subtitulo: pedidoEditandoId
      ? `Pedido #${pedidoEditandoId}: completá los datos de pago para finalizarlo.`
      : 'Completá los datos de pago para finalizar el pedido.',
    total: totalCarritoActual,
    unidades: unidadesCarritoActual,
    // Callback: la ventana lo llama al confirmar. Devuelve true si se guardó (la ventana
    // se cierra) o false si falló (queda abierta para corregir).
    alConfirmar: async (idMedio, idCuenta) => {
      await guardarPedido('COMPLETADO', { idMedio, idCuenta });
      // Si guardó bien, guardarPedido vació el carrito (resetearPedido). Si falló, el
      // carrito sigue lleno.
      return Object.keys(carrito).length === 0;
    }
  });
}

export function eliminarItemCarrito(idProducto) {
  if (carrito[idProducto]) {
    delete carrito[idProducto]; // Borramos el ítem del estado
    
    // Si la tarjeta está en pantalla se actualiza sola; si está en otra solapa, se re-dibuja la grilla.
    if (!sincronizarTarjeta(idProducto, 0)) renderizarGrillaPOS();

    actualizarResumenCarrito();
  }
}
