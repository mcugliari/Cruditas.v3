import { supabaseAdmin } from './config.js';
import { 
  carrito, setCarrito, 
  cacheProductos, setCacheProductos, 
  cachePrecios, setCachePrecios, 
  cacheCategorias, setCacheCategorias, 
  pedidoEditandoId, setPedidoEditandoId,
  pedidoEditandoEstado, setPedidoEditandoEstado,
  pedidoEditandoOriginal, setPedidoEditandoOriginal,
  pedidoPagoOrigen, setPedidoPagoOrigen
} from './state.js';

import { mostrarNotificacion, formatearFechaAR, obtenerFechaActualISO, mensajeErrorFuncion, esc, confirmarAccion, confirmarEntregaConSaldo, formatearPesos } from './utils.js';
import { abrirModalCobro } from './cobro.js';
import { leerPreferenciasImpresion } from './preferencias.js';
import { imprimirAutomatico } from './impresion.js';
import { mostrarAvisoConAccion, cerrarAvisoAccion } from './avisoAccion.js';
import { buscarPrecio, calcularDescuentoDocena, resumirPedido } from './precios.js';

// calcularSubtotalItem se mudó a precios.js; se vuelve a exportar acá por si algún archivo lo importaba desde pos.js.
export { calcularSubtotalItem } from './precios.js';

// Nuevas variables de estado para el POS
let grupoSeleccionado = null;   // clave (en minúsculas) del grupo/solapa activa
let filtroBusqueda = '';

// -----------------------------------------------------------------------------
// normalizarTexto
//   Deja un texto en minúsculas y SIN tildes, para comparar sin importar cómo se escribió
//   ("Jamón" y "jamon" quedan iguales). normalize('NFD') separa cada letra de su tilde
//   ("ó" -> "o" + tilde) y el replace borra solo las tildes (rango \u0300-\u036f).
//   Ojo: la "ñ" también pierde su virgulilla y pasa a "n".
// -----------------------------------------------------------------------------
function normalizarTexto(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function setFiltroBusquedaPOS(texto) {
  // trim(): los espacios sueltos al principio o al final no cuentan.
  filtroBusqueda = normalizarTexto(texto).trim();
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
  asegurarRegionAnuncios();   // región invisible para lectores de pantalla (ver "ANUNCIOS PARA LECTORES DE PANTALLA")
  promesaInicioPOS = cargarSelectsPOS();
  return promesaInicioPOS;
}

// Devuelve algo que se puede esperar con "await". Si nunca se inicializó el POS,
// devuelve una promesa ya resuelta (no espera nada).
export function esperarPOSListo() {
  return promesaInicioPOS || Promise.resolve();
}

export async function cargarSelectsPOS() {
  const { data: clientes, error: errorClientes } = await supabaseAdmin.from('TB_BCLIENTES').select('*').order('nombre');
  const { data: listas, error: errorListas } = await supabaseAdmin.from('TB_TLISTA_PRECIOS').select('*');

  // Si alguna de las dos falla NO se tocan los selects (siguen con lo que tenían) y se avisa.
  // Antes el error se ignoraba y la persona se encontraba con la lista de clientes vacía.
  if (errorClientes || errorListas || !Array.isArray(clientes) || !Array.isArray(listas)) {
    mostrarErrorCargaPOS('No se pudieron cargar los clientes y las listas de precios. Revisá la conexión.');
  } else {
    selectsCargados = true;
  }

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
  if (selectLis && listas) {
    selectLis.innerHTML = listas.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
    // Select2 (igual que Cliente) para que las dos listas se vean y se comporten igual en cualquier dispositivo. Son pocas
    // opciones: se desactiva el buscador. Si Select2 no cargó, queda el select común y todo sigue funcionando.
    if (typeof $.fn.select2 === 'function') $('#select-lista-pedido').select2({ width: '100%', minimumResultsForSearch: Infinity });
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
  const { data, error: errorLista } = await supabaseAdmin
    .from('TB_ACLIENTE_LISTA_PRECIOS')
    .select('id_lista_precio')
    .eq('id_cliente', selectCli.value)
    .eq('m_predeterminada', true)
    .maybeSingle();

  const selectLista = document.getElementById('select-lista-pedido');
  if (errorLista) {
    // No sabemos cuál es la lista del cliente. Volver a la lista base en silencio podía cobrar
    // con precios equivocados, así que se deja la lista que está elegida y se avisa.
    mostrarNotificacion('No se pudo verificar la lista de precios del cliente. Revisá la lista elegida antes de cobrar.', 'warning');
  } else if (selectLista) {
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
    // Select2 dibuja su propio cuadro: cambiar solo .value no actualiza lo que se ve. change.select2 le avisa SOLO a
    // Select2 (no dispara el cambio de lista de main.js: abajo ya se llama a cargarPOS).
    $('#select-lista-pedido').trigger('change.select2');
  }
  
  await cargarPOS();
}

export async function cargarPOS() {
  const selectLis = document.getElementById('select-lista-pedido');
  const idLista = selectLis && selectLis.value ? parseInt(selectLis.value) : 1;

  const { data: categorias, error: errorCategorias } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('id');
  const { data: productos, error: errorProductos } = await supabaseAdmin.from('TB_BPRODUCTOS').select('*').order('id');
  const { data: precios, error: errorPrecios } = await supabaseAdmin.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', idLista);

  if (errorCategorias || errorProductos || errorPrecios) {
    // Si falla la carga NO se reemplaza el catálogo por uno vacío (antes pasaba, por ejemplo al
    // recargar justo después de guardar un pedido): se conserva el que ya estaba y se avisa.
    const hayCatalogo = Array.isArray(cacheProductos) && cacheProductos.length > 0;
    mostrarErrorCargaPOS(hayCatalogo
      ? 'No se pudo actualizar el catálogo. Se muestran los datos anteriores: los precios podrían no estar al día.'
      : 'No se pudo cargar el catálogo. Revisá la conexión.');
    return;
  }

  // Si antes había un error y ahora anduvo, el cartel desaparece (renderizarGrillaPOS redibuja todo).
  const veniaConError = errorCargaPOS !== null;
  errorCargaPOS = null;

  setCacheCategorias(categorias || []);
  setCacheProductos(productos || []);
  setCachePrecios(precios || []);

  renderizarGrillaPOS();
  if (veniaConError) mostrarNotificacion('Catálogo actualizado.');

  // La etiqueta "Más vendido" es decorativa: se pide en segundo plano (sin await) para no demorar el POS.
  cargarMasVendidos();
}

// -----------------------------------------------------------------------------
// Cartel "No se pudo cargar" del catálogo
//   Se dibuja DENTRO del área del catálogo, arriba (queda fijo al desplazarse), con un
//   botón "Reintentar". No usa el aviso común porque ese desaparece a los segundos y acá
//   la persona necesita ver que el catálogo puede estar vacío o desactualizado.
//   renderizarGrillaPOS lo vuelve a dibujar cada vez que redibuja el catálogo, y
//   cargarPOS lo borra apenas una carga sale bien.
// -----------------------------------------------------------------------------
let errorCargaPOS = null;          // texto del error actual (null = sin error)
let selectsCargados = false;       // ¿alguna vez se cargaron bien clientes y listas?
let reintentandoCarga = false;

function mostrarErrorCargaPOS(texto) {
  errorCargaPOS = texto;
  mostrarNotificacion(texto, 'danger');
  pintarErrorCargaPOS();
}

function pintarErrorCargaPOS() {
  const contenedor = document.getElementById('contenedor-menu-productos');
  if (!contenedor) return;
  const viejo = document.getElementById('pos-error-carga');
  if (viejo) viejo.remove();
  if (!errorCargaPOS) return;

  const cartel = document.createElement('div');
  cartel.id = 'pos-error-carga';
  cartel.className = 'pos-error-carga';
  cartel.setAttribute('role', 'alert');
  cartel.innerHTML = `
    <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
    <span class="pos-error-carga-texto">${esc(errorCargaPOS)}</span>
    <button type="button" class="pos-error-carga-btn">Reintentar</button>`;
  cartel.querySelector('button').addEventListener('click', reintentarCargaPOS);
  contenedor.insertAdjacentElement('afterbegin', cartel);
}

async function reintentarCargaPOS() {
  if (reintentandoCarga) return;
  reintentandoCarga = true;
  const boton = document.querySelector('#pos-error-carga .pos-error-carga-btn');
  if (boton) {
    boton.disabled = true;
    boton.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Reintentando…';
  }
  try {
    // Si los clientes y listas nunca llegaron se piden de nuevo; si no, alcanza con el catálogo
    // (así no se pierde el cliente que ya se eligió para el pedido en curso).
    if (selectsCargados) await cargarPOS();
    else await cargarSelectsPOS();
  } finally {
    reintentandoCarga = false;
    pintarErrorCargaPOS();   // si volvió a fallar, se redibuja con el botón normal; si anduvo, ya no hay cartel
  }
}

// -----------------------------------------------------------------------------
// cargarMasVendidos  (interna)
//   Pide a la base los productos más vendidos de cada categoría (función
//   productos_mas_vendidos, script 21) y marca esas tarjetas con la etiqueta
//   "Más vendido". Se calcula UNA vez al abrir el POS: durante el turno la etiqueta no
//   cambia de lugar (ni se vuelve a consultar después de cada cobro).
//   Si falla, el POS sigue igual, solo que sin etiquetas.
// -----------------------------------------------------------------------------
let idsMasVendidos = new Set();
let masVendidosCargado = false;

async function cargarMasVendidos() {
  if (masVendidosCargado) return;
  try {
    const { data, error } = await supabaseAdmin.rpc('productos_mas_vendidos', {
      p_dias: 30,           // últimos 30 días
      p_por_categoria: 2,   // hasta 2 productos por categoría
      p_min_productos: 4    // solo en categorías con 4 productos o más
    });
    if (error) {
      console.warn('No se pudo calcular "Más vendido":', error.message);
      return;
    }
    masVendidosCargado = true;
    idsMasVendidos = new Set((data || []).map(fila => Number(fila.id_producto)));
    if (idsMasVendidos.size > 0) renderizarGrillaPOS(); // vuelve a dibujar con las etiquetas
  } catch (e) {
    console.warn('No se pudo calcular "Más vendido":', e);
  }
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

// -----------------------------------------------------------------------------
// compararProductosCatalogo
//   Orden de las tarjetas del catálogo, para usar con .sort():
//     1) por categoría (en el orden en que vienen las categorías);
//     2) dentro de la categoría, por el atributo "orden" del producto: el menor va
//        primero y los que no tienen número (NULL) van al final;
//     3) si empatan (o ninguno tiene orden), por id: el orden de siempre.
//   Un .sort() usa la función así: devuelve negativo si "a" va antes, positivo si va después.
// -----------------------------------------------------------------------------
function compararProductosCatalogo(a, b) {
  const posCategoria = p => cacheCategorias.findIndex(c => Number(c.id) === Number(p.id_categoria || p.idCategoria));
  // Sin orden = Infinity (más grande que cualquier número): queda al final.
  // Ojo: Number(null) daría 0 y pondría los productos sin orden PRIMEROS; por eso se pregunta antes.
  const ordenDe = p => (p.orden === null || p.orden === undefined || p.orden === '') ? Infinity : Number(p.orden);

  const porCategoria = posCategoria(a) - posCategoria(b);
  if (porCategoria !== 0) return porCategoria;

  const oa = ordenDe(a);
  const ob = ordenDe(b);
  if (oa !== ob) return oa < ob ? -1 : 1; // (no se resta: Infinity - Infinity daría NaN)

  return Number(a.id) - Number(b.id);
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
        <button class="pos-category-tab ${isActive}" data-id="${esc(clave)}" aria-pressed="${isActive ? 'true' : 'false'}">
          <i class="fas ${iconoCategoria(texto)} pos-category-icon"></i> ${esc(texto)}
          <span class="pos-tab-count d-none"></span>
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
    prodsMostrar = prodsMostrar
      .filter(p => normalizarTexto(p.nombre).includes(filtroBusqueda))
      .sort(compararProductosCatalogo);
  } else {
    // Productos de TODAS las categorías del grupo, en el orden del catálogo
    // (ver compararProductosCatalogo).
    prodsMostrar = prodsMostrar
      .filter(p => idsCategoriasDelGrupo.has(Number(p.id_categoria || p.idCategoria)))
      .sort(compararProductosCatalogo);
  }

  // 3. RENDERIZAR GRILLA
  if (prodsMostrar.length === 0) {
    contenedor.innerHTML = '<p class="text-muted text-center my-4 w-100">No se encontraron productos.</p>';
    pintarErrorCargaPOS();
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
        <button type="button" class="btn btn-docena-pill" data-action="alterar-cant" data-id="${p.id}" data-delta="12">+12</button>
      </div>
    ` : '';

    // Foto: el ícono de la categoría queda SIEMPRE debajo como reemplazo. Si hay URL, la
    // <img> se dibuja encima; si la imagen no carga (onerror), se quita sola y se ve el ícono.
    const catProd = cacheCategorias.find(c => Number(c.id) === Number(idCatProd));
    const urlFoto = urlImagenSegura(p.imagen_url);
    // Sobre la foto van dos insignias: "Más vendido" (izquierda, chica y discreta) y la cantidad
    // cargada (derecha, solo si hay unidades). La cantidad se actualiza en sincronizarTarjeta.
    const fotoHTML = `
      <div class="pos-prod-img">
        <i class="fas ${iconoCategoria(catProd ? catProd.nombre : '')} pos-prod-ph" aria-hidden="true"></i>
        ${urlFoto ? `<img src="${esc(urlFoto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        ${idsMasVendidos.has(Number(p.id)) ? '<span class="pos-badge-top"><i class="fas fa-medal" aria-hidden="true"></i> Más vendido</span>' : ''}
        <span class="pos-qty-badge ${cant > 0 ? '' : 'd-none'}" aria-label="${cant} en el pedido">${cant}</span>
        <button type="button" class="pos-btn-quitar" ${cant > 0 ? '' : 'disabled'} data-action="alterar-cant" data-id="${p.id}" data-delta="-100000" title="Quitar del pedido" aria-label="Quitar ${esc(p.nombre)} del pedido">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </div>
    `;

    // Un solo estado "con unidades" (clase pos-card-activa): la cantidad ya se lee en el número,
    // así que no hay tonos distintos según cuántas unidades haya.
    // La papelera (esquina inferior derecha de la foto) quita TODAS las unidades de un toque: reusa
    // "alterar-cant" con un delta enorme negativo (alterarCantidad nunca baja de 0). Sin unidades
    // queda deshabilitada y oculta; está fuera de la fila - / + para que esos botones no se muevan.
    htmlCompleto += `
      <div class="card h-100 pos-card-producto border-0 ${claseActiva}">
        ${fotoHTML}
        ${etiquetaCategoria}
        <strong class="pos-prod-title" title="${esc(p.nombre)}">${esc(p.nombre)}</strong>
        <span class="pos-prod-price">${formatearPesos(precios.unidad)}</span>

        <div class="pos-qty-pill">
          <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="-1" aria-label="Quitar una unidad de ${esc(p.nombre)}">-</button>
          <span class="pos-cant-num" id="cant-prod-${p.id}">${cant}</span>
          <button type="button" class="btn btn-pos-sq btn-pos-add" data-action="alterar-cant" data-id="${p.id}" data-delta="1" aria-label="Agregar una unidad de ${esc(p.nombre)}">+</button>
        </div>

        ${botonesDocenaHTML}
      </div>
    `;
  });

  htmlCompleto += '</div></div>';
  contenedor.innerHTML = htmlCompleto;
  pintarErrorCargaPOS();      // si hay un error de carga pendiente, el cartel vuelve a aparecer arriba
  actualizarResumenCarrito(); // Garantizamos sincronización del carrito visual
}

// -----------------------------------------------------------------------------
// obtenerPrecioProducto
//   Precio { unidad, docena } de un producto. Solo resuelve DE DÓNDE salen los datos (el caché
//   de precios y la lista elegida en pantalla); la búsqueda en sí vive en precios.js (buscarPrecio),
//   que es la que tienen las pruebas automáticas (carpeta tests/).
// -----------------------------------------------------------------------------
export function obtenerPrecioProducto(idProd, idCat, idLista = null) {
  const idL = idLista ? Number(idLista) : Number(document.getElementById('select-lista-pedido')?.value || 0);
  return buscarPrecio(cachePrecios, idProd, idCat, idL);
}

// -----------------------------------------------------------------------------
// ANUNCIOS PARA LECTORES DE PANTALLA
//   Una persona que usa lector de pantalla no ve que cambió el total ni que se agregó un producto.
//   Acá hay UNA región oculta (role="status", aria-live="polite") donde se escribe un resumen corto
//   ("Carne: 6 unidades. Pedido: 18 unidades, $ 27.000.") cada vez que se modifica el pedido.
//   - Se espera 350 ms antes de hablar: si se toca "+" varias veces seguido se anuncia solo el
//     resultado final, no cada toque.
//   - La región se crea al abrir el POS (inicializarPOS) y NO al primer mensaje: los lectores solo
//     anuncian cambios en regiones que ya existían.
//   - Los avisos comunes (utils.js) y los carteles (avisoAccion.js, cartel de error) ya son
//     regiones accesibles por sí mismos.
// -----------------------------------------------------------------------------
let temporizadorAnuncio = null;
let alternarAnuncio = false;
let cambioParaAnunciar = null;   // último producto tocado: { id, cant } (lo consume actualizarResumenCarrito)

function asegurarRegionAnuncios() {
  let region = document.getElementById('pos-anuncios');
  if (!region) {
    region = document.createElement('div');
    region.id = 'pos-anuncios';
    region.className = 'pos-sr-only';   // invisible, pero la leen los lectores de pantalla
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    document.body.appendChild(region);
  }
  return region;
}

function anunciar(texto) {
  const region = asegurarRegionAnuncios();
  clearTimeout(temporizadorAnuncio);
  temporizadorAnuncio = setTimeout(() => {
    // Un espacio al final, alternado: así un mensaje IGUAL al anterior se vuelve a leer.
    alternarAnuncio = !alternarAnuncio;
    region.textContent = texto + (alternarAnuncio ? '' : '\u00A0');
  }, 350);
}

// Se llama al final de actualizarResumenCarrito, cuando ya están calculados unidades y total.
function anunciarCambioCarrito(unidades, total) {
  if (!cambioParaAnunciar) return;
  const { id, cant } = cambioParaAnunciar;
  cambioParaAnunciar = null;

  const producto = cacheProductos.find(x => Number(x.id) === Number(id));
  const nombre = producto ? producto.nombre : 'Producto';
  const detalle = cant > 0 ? `${nombre}: ${cant} ${cant === 1 ? 'unidad' : 'unidades'}.` : `${nombre}: quitado del pedido.`;
  const resumen = unidades > 0
    ? ` Pedido: ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}, ${formatearPesos(total)}.`
    : ' El pedido está vacío.';
  anunciar(detalle + resumen);
}

export function alterarCantidad(idProducto, delta) {
  if (guardandoPedido) return;   // mientras se guarda, el pedido no se puede modificar (se perdería el cambio)
  // La papelera de la tarjeta manda un delta enorme negativo: es "quitar el producto", y eso se puede deshacer.
  if (delta <= -1000) { eliminarItemCarrito(idProducto); return; }
  // Si recién se vació el pedido y la persona empieza otro, el "Deshacer" de la vaciada ya no corresponde.
  if (pendienteDeshacer && pendienteDeshacer.tipo === 'vaciar') descartarDeshacer();
  const actual = carrito[idProducto] || 0;
  const nueva = Math.max(0, actual + delta);
  
  if (nueva === 0) {
    delete carrito[idProducto];
  } else {
    carrito[idProducto] = nueva;
  }
  cambioParaAnunciar = { id: idProducto, cant: nueva };

  // Si la tarjeta está en pantalla se actualiza sola; si no (otra solapa), se re-dibuja la grilla.
  if (!sincronizarTarjeta(idProducto, nueva)) {
    renderizarGrillaPOS();
  }

  actualizarResumenCarrito();
}

// -----------------------------------------------------------------------------
// actualizarContadoresSolapas  (interna)
//   Pone en cada solapa la cantidad de UNIDADES cargadas en el carrito para ese grupo
//   (ej.: "Empanadas 36"), así no hay que abrir cada solapa para saber qué hay cargado.
//   - Cuenta por grupo igual que las solapas (grupoDeCategoria, sin distinguir mayúsculas).
//   - No cuenta el descuento por docena (producto 999) ni la categoría "sistema".
//   - Solo cambia el texto de un <span> que ya existe; no redibuja las solapas.
//   La llama actualizarResumenCarrito, que corre ante cualquier cambio del carrito.
// -----------------------------------------------------------------------------
function actualizarContadoresSolapas() {
  const unidadesPorGrupo = {};
  Object.keys(carrito).forEach(idProd => {
    if (Number(idProd) === 999) return;
    const cant = Number(carrito[idProd]) || 0;
    if (cant <= 0) return;
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;
    const cat = cacheCategorias.find(c => Number(c.id) === Number(p.id_categoria || p.idCategoria));
    if (!cat || esCategoriaSistema(cat)) return;
    const clave = grupoDeCategoria(cat).toLowerCase();
    unidadesPorGrupo[clave] = (unidadesPorGrupo[clave] || 0) + cant;
  });

  document.querySelectorAll('.pos-category-tab').forEach(tab => {
    const unidades = unidadesPorGrupo[tab.dataset.id] || 0;
    const marca = tab.querySelector('.pos-tab-count');
    if (!marca) return;
    marca.textContent = unidades;
    marca.classList.toggle('d-none', unidades <= 0);
    marca.title = `${unidades} unidad${unidades === 1 ? '' : 'es'} cargada${unidades === 1 ? '' : 's'}`;
  });
}

// -----------------------------------------------------------------------------
// sincronizarTarjeta  (interna)
//   Deja la tarjeta del catálogo al día con la cantidad: número, insignia sobre la foto,
//   estado "activa" y papelera. Devuelve false si la tarjeta no está en pantalla (por
//   ejemplo, está en otra solapa).
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

    const insignia = tarjeta.querySelector('.pos-qty-badge');
    if (insignia) {
      insignia.textContent = cant;
      insignia.setAttribute('aria-label', `${cant} en el pedido`);
      insignia.classList.toggle('d-none', cant <= 0);
    }

    // Un botón deshabilitado no recibe toques ni foco; el CSS lo oculta pero conserva su lugar.
    const botonQuitar = tarjeta.querySelector('.pos-btn-quitar');
    if (botonQuitar) botonQuitar.disabled = cant <= 0;
  }
  return true;
}

// (calcularDescuentoDocena y resumirPedido viven ahora en precios.js: son funciones puras con pruebas
//  automáticas en tests/. Acá solo se las usa para mostrar el resumen; el servidor es la fuente de verdad.)

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
    poner('subtotal-pedido', formatearPesos(0));
    poner('monto-total-pedido', formatearPesos(0));
    poner('monto-descuento', formatearPesos(0));
    document.getElementById('pos-desglose')?.classList.add('d-none');
    totalCarritoActual = 0;
    unidadesCarritoActual = 0;
    actualizarContadoresSolapas();
    anunciarCambioCarrito(0, 0);
    return;
  }

  const idLista = document.getElementById('select-lista-pedido')?.value;

  const lineasPedido = []; // una por producto del pedido: de acá salen los totales y el descuento (precios.js)

  let html = '<ul class="pos-cart-list">';

  // 1. Renderizar cada producto a su precio unitario de lista
  keys.forEach(idProd => {

    // FILTRO: Omitir el producto bonificación 999 para que no aparezca como ítem normal
    if (Number(idProd) === 999) return;

    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cant = Number(carrito[idProd]) || 0;
    if (cant <= 0) return;

    const idCatProd = p.id_categoria || p.idCategoria;
    const cat = cacheCategorias.find(c => Number(idCatProd) === Number(c.id));
    const nombreCat = cat ? cat.nombre : '';

    const precios = obtenerPrecioProducto(p.id, idCatProd, idLista);
    const precioUnidad = precios.unidad || 0;
    const subTotalProducto = cant * precioUnidad;

    lineasPedido.push({ cantidad: cant, precioUnidad, precioDocena: precios.docena || 0, permiteDocena: !!p.m_permite_docena });

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
            <span>${formatearPesos(precioUnidad)} c/u</span>
          </span>
        </div>
        <div class="pos-cart-qty">
          <button type="button" class="pos-cart-btn" data-action="alterar-cant" data-id="${idProd}" data-delta="-1" aria-label="Quitar una unidad de ${esc(p.nombre)}"><i class="fas fa-minus" aria-hidden="true"></i></button>
          <span class="pos-cart-n">${cant}</span>
          <button type="button" class="pos-cart-btn pos-cart-btn-add" data-action="alterar-cant" data-id="${idProd}" data-delta="1" aria-label="Agregar una unidad de ${esc(p.nombre)}"><i class="fas fa-plus" aria-hidden="true"></i></button>
        </div>
        <strong class="pos-cart-total">${formatearPesos(subTotalProducto)}</strong>
        <button type="button" class="pos-cart-del" data-action="eliminar-item-carrito" data-id="${idProd}" title="Eliminar ítem" aria-label="Eliminar ${esc(p.nombre)} del pedido">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </li>
    `;
  });

  // 2. Totales y descuento por docena combinada (funciones puras de precios.js)
  const {
    unidades: totalItems, subtotal: subtotalSinDescuento, docenasCompletas, descuentoTotal, total: montoTotalFinal
  } = resumirPedido(lineasPedido);

  html += '</ul>';
  if (contenedorItems) contenedorItems.innerHTML = html;

  const textoTotal = formatearPesos(montoTotalFinal);
  poner('cant-total-items', totalItems);
  poner('badge-carrito', totalItems);
  // Desglose (solo si hay descuento): primero el Subtotal, después el Descuento, y recién abajo el total.
  poner('subtotal-pedido', formatearPesos(subtotalSinDescuento));
  poner('monto-descuento', formatearPesos(-descuentoTotal));
  poner('detalle-descuento', `(${docenasCompletas} doc.)`);
  document.getElementById('pos-desglose')?.classList.toggle('d-none', descuentoTotal <= 0);
  poner('monto-total-pedido', textoTotal);
  // Los guardamos para mostrarlos en la ventana de cobro.
  totalCarritoActual = montoTotalFinal;
  unidadesCarritoActual = totalItems;
  actualizarContadoresSolapas();
  anunciarCambioCarrito(totalItems, montoTotalFinal);
}

// -----------------------------------------------------------------------------
// fotoPedidoEnPantalla / guardarFotoPedidoEditando
//   Texto que resume lo que hay en el POS (cliente, lista, referencia y productos con su cantidad). Al abrir un pedido
//   para editarlo se guarda una foto (pedidos.js llama a guardarFotoPedidoEditando); al apretar "Guardar cambios" se
//   compara con la de ese momento: si son iguales, no hubo cambios y no se guarda nada.
// -----------------------------------------------------------------------------
function fotoPedidoEnPantalla() {
  const items = Object.entries(carrito)
    .map(([id, cant]) => [Number(id), Number(cant) || 0])
    .filter(([, cant]) => cant > 0)
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify({
    cliente: String(document.getElementById('select-cliente-pedido')?.value || ''),
    lista: String(document.getElementById('select-lista-pedido')?.value || ''),
    referencia: (document.getElementById('input-ref-cliente')?.value || '').trim(),
    items
  });
}

export function guardarFotoPedidoEditando() {
  setPedidoEditandoOriginal(fotoPedidoEnPantalla());
}

export async function resetearPedido() {
  descartarDeshacer();   // al empezar de cero (guardar, cancelar edición...) un "Deshacer" anterior ya no corresponde
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = '';


  // 2. Resetear selector de Cliente a Consumidor Final (ID 1)
  // Como ahora usamos Select2, lo actualizamos con jQuery
  const selectCli = $('#select-cliente-pedido');
  if (selectCli.length) {
    selectCli.val('1').trigger('change');
  }

  setPedidoEditandoId(null);
  setPedidoEditandoEstado(null);
  setPedidoEditandoOriginal(null);
  setPedidoPagoOrigen(null);    // y se corta el vínculo con el pago de un pedido anulado (opción B)
  actualizarModoEdicionPOS();   // vuelve el título, los colores y los botones de un pedido nuevo
  setCarrito({});

  // 3. Recargar la grilla de precios del POS
  await cargarPOS();        
}

// -----------------------------------------------------------------------------
// MODO EDICIÓN DEL POS
//   Cuando se edita un pedido existente (Gestión de Pedidos -> Más -> Editar pedido) el
//   panel lo deja bien a la vista: el título dice "Editando pedido #N", se muestra su estado,
//   el panel cambia de color y los botones son los de una edición:
//     Guardar cambios  (el pedido sigue en el mismo estado)  ·  Cobrar
//   "Cancelar edición" ocupa el lugar de "Limpiar todo". Todo se deshace en resetearPedido.
// -----------------------------------------------------------------------------
const ROTULO_ESTADO_EDICION = { EN_PREPARACION: 'En preparación', LISTO: 'Listo' };

export function actualizarModoEdicionPOS() {
  const editando = Boolean(pedidoEditandoId);
  // Opción B: pedido NUEVO que va a recibir el pago de uno anulado (si se está editando otro pedido, manda la edición).
  const conPago = Boolean(pedidoPagoOrigen) && !editando;
  const modoEspecial = editando || conPago;

  document.querySelector('.pos-order-card')?.classList.toggle('pos-modo-edicion', modoEspecial);

  const titulo = document.getElementById('pos-titulo-texto');
  if (titulo) {
    titulo.textContent = editando ? `Editando pedido #${pedidoEditandoId}`
      : conPago ? `Pedido nuevo con el pago del #${pedidoPagoOrigen.id}`
      : 'Pedido Actual';
  }

  const sub = document.getElementById('pos-titulo-estado');
  if (sub) {
    sub.classList.toggle('d-none', !modoEspecial);
    const rotulo = ROTULO_ESTADO_EDICION[pedidoEditandoEstado] || pedidoEditandoEstado || '';
    sub.textContent = editando && rotulo
      ? (pedidoEditandoEstado === 'LISTO'
          ? `Estado actual: ${rotulo} · al guardar vuelve a En preparación (la cocina lo rehace)`
          : `Estado actual: ${rotulo} · no cambia al guardar`)
      : conPago ? `Al guardar, el pago del pedido anulado #${pedidoPagoOrigen.id} (hasta $${Number(pedidoPagoOrigen.aDevolver).toLocaleString('es-AR')}) pasa a este pedido`
      : '';
  }

  document.getElementById('btn-pos-preparar')?.classList.toggle('d-none', editando);
  document.getElementById('btn-pos-guardar-cambios')?.classList.toggle('d-none', !editando);
  // Con el pago del pedido anulado no se ofrece "Cobrar" (el pago ya viene del otro pedido; la diferencia se cobra después desde el listado).
  document.querySelector('.btn-pos-cobrar')?.classList.toggle('d-none', conPago);
  document.getElementById('btn-limpiar-todo')?.classList.toggle('d-none', modoEspecial);
  document.getElementById('btn-cancelar-edicion')?.classList.toggle('d-none', !modoEspecial);
}

// "Cancelar edición": descarta lo que se cambió en pantalla (el pedido guardado no se toca)
// y deja el POS listo para un pedido nuevo.
export async function cancelarEdicionPOS() {
  // Opción B: se descarta el pedido nuevo en pantalla; el pago sigue en el pedido anulado (queda en Pendientes).
  if (!pedidoEditandoId && pedidoPagoOrigen) {
    const origen = pedidoPagoOrigen.id;
    const sigue = await confirmarAccion({
      titulo: 'Cancelar pedido nuevo',
      mensaje: `Se descarta el pedido que estás armando. El pago del pedido anulado #${origen} no se traspasa y sigue en Pendientes para resolverlo después. ¿Querés continuar?`,
      textoConfirmar: 'Sí, descartar',
      peligro: true
    });
    if (!sigue) return;
    await resetearPedido();
    mostrarNotificacion(`Pedido nuevo descartado. El pago del #${origen} sigue pendiente.`, 'info');
    return;
  }
  if (!pedidoEditandoId) return;
  const id = pedidoEditandoId;
  const ok = await confirmarAccion({
    titulo: 'Cancelar edición',
    mensaje: `Se descartan los cambios hechos al pedido #${id}. El pedido queda como estaba guardado. ¿Querés continuar?`,
    textoConfirmar: 'Sí, descartar cambios',
    peligro: true
  });
  if (!ok) return;
  await resetearPedido();
  mostrarNotificacion(`Edición del pedido #${id} cancelada. No se modificó nada.`, 'info');
}

// -----------------------------------------------------------------------------
// DESHACER (quitar una línea / vaciar el pedido)
//   Cuando se quita algo del pedido se muestra, MS_DESHACER milisegundos, un aviso con el
//   botón "Deshacer" (avisoAccion.js). Es de UN solo nivel: vale para lo último que se quitó
//   (si se quitan varias líneas seguidas, el aviso las junta y las devuelve todas).
//   "pendienteDeshacer" guarda lo necesario para volver atrás:
//     { tipo: 'lineas', lineas: [{id, cant}], carritoRef, idEdicion }
//     { tipo: 'vaciar', foto: {carrito, idCliente, idLista, referencia}, carritoRef }
//   Dejan de valer (y no hacen nada) si el pedido cambió por otro camino:
//     - carritoRef: es el OBJETO carrito del momento. alterarCantidad lo modifica "por
//       dentro" (sigue siendo el mismo), pero setCarrito (guardar, editar otro pedido, resetear)
//       pone uno nuevo: si ya no es el mismo, el pedido cambió de verdad.
//     - idEdicion: el pedido que se estaba editando (null = pedido nuevo).
// -----------------------------------------------------------------------------
const MS_DESHACER = 8000;
let pendienteDeshacer = null;

// Cantidad de productos distintos y de unidades del pedido actual (sin el descuento, producto 999).
function resumenCarrito() {
  let productos = 0;
  let unidades = 0;
  Object.keys(carrito).forEach(id => {
    if (Number(id) === 999) return;
    const cant = Number(carrito[id]) || 0;
    if (cant > 0) { productos++; unidades += cant; }
  });
  return { productos, unidades };
}

// Borra el "Deshacer" pendiente y cierra su aviso (sin tocar un aviso de error que esté en pantalla).
function descartarDeshacer() {
  pendienteDeshacer = null;
  cerrarAvisoAccion('deshacer');
}

// Se llama justo DESPUÉS de quitar una línea del carrito (ver eliminarItemCarrito).
function registrarQuitado(idProducto, cantidad) {
  const p = pendienteDeshacer;
  const vigente = p && p.tipo === 'lineas' && p.carritoRef === carrito && p.idEdicion === pedidoEditandoId;
  if (!vigente) pendienteDeshacer = { tipo: 'lineas', lineas: [], carritoRef: carrito, idEdicion: pedidoEditandoId };

  const lineas = pendienteDeshacer.lineas;
  const previa = lineas.find(l => Number(l.id) === Number(idProducto));
  if (previa) previa.cant = cantidad;
  else lineas.push({ id: idProducto, cant: cantidad });

  const producto = cacheProductos.find(x => Number(x.id) === Number(idProducto));
  const nombre = producto ? producto.nombre : 'Producto';
  mostrarAvisoConAccion({
    mensaje: lineas.length === 1 ? `Se quitó ${nombre} (${lineas[0].cant}).` : `Se quitaron ${lineas.length} productos.`,
    textoAccion: 'Deshacer',
    duracionMs: MS_DESHACER,
    tipo: 'deshacer',
    alAccionar: deshacerQuitados,
    // El pendiente se borra solo si el aviso VENCE o lo cierra el código. Si se tocó "Deshacer" ('accion')
    // la propia acción lo consume (el aviso avisa que se cerró ANTES de ejecutarla), y si se reemplazó por
    // otro igual (más líneas quitadas) el pendiente sigue vivo.
    alCerrar: (motivo) => { if (motivo === 'expiro' || motivo === 'cerrado') pendienteDeshacer = null; }
  });
}

function deshacerQuitados() {
  const p = pendienteDeshacer;
  pendienteDeshacer = null;
  if (!p || p.tipo !== 'lineas' || p.carritoRef !== carrito || p.idEdicion !== pedidoEditandoId) {
    mostrarNotificacion('Ya no se puede deshacer: el pedido cambió.', 'warning');
    return;
  }
  let repuestos = 0;
  let yaEstaban = 0;
  p.lineas.forEach(l => {
    // Si mientras tanto se volvió a cargar ese producto, no se pisa ni se duplica.
    if (carrito[l.id]) yaEstaban++;
    else { carrito[l.id] = l.cant; repuestos++; }
  });
  renderizarGrillaPOS();   // redibuja el catálogo y el carrito con lo repuesto
  anunciar(repuestos === 1 ? 'Se repuso 1 producto.' : `Se repusieron ${repuestos} productos.`);
  if (yaEstaban > 0) {
    mostrarNotificacion(repuestos > 0
      ? 'Se repuso lo quitado. Algunos productos ya estaban cargados y no se tocaron.'
      : 'Esos productos ya están en el pedido: no se repuso nada.', 'info');
  }
}

async function deshacerVaciado() {
  const p = pendienteDeshacer;
  pendienteDeshacer = null;
  const pedidoOcupado = () => pedidoEditandoId || Object.keys(carrito).length > 0;
  if (!p || p.tipo !== 'vaciar' || p.carritoRef !== carrito || pedidoOcupado()) {
    mostrarNotificacion('Ya no se puede deshacer: empezaste otro pedido.', 'warning');
    return;
  }

  const f = p.foto;
  // Cliente: Select2 dibuja su propio cuadro, por eso se usa trigger('change.select2'), que le avisa
  // SOLO a Select2 (mismo método que usa editarPedido). alCambiarCliente ajusta la etiqueta de
  // referencia y deja la lista predeterminada del cliente: la lista guardada se vuelve a poner abajo.
  if (document.getElementById('select-cliente-pedido') && f.idCliente) {
    $('#select-cliente-pedido').val(f.idCliente).trigger('change.select2');
    await alCambiarCliente();
  }

  // Mientras esperábamos la base, ¿alguien empezó otro pedido? Entonces no se pisa nada.
  if (p.carritoRef !== carrito || pedidoOcupado()) {
    mostrarNotificacion('Ya no se puede deshacer: empezaste otro pedido.', 'warning');
    return;
  }

  const selectLista = document.getElementById('select-lista-pedido');
  if (selectLista && f.idLista) {
    selectLista.value = f.idLista;
    $('#select-lista-pedido').trigger('change.select2');   // actualiza lo que muestra Select2 (ver alCambiarCliente)
  }
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = f.referencia;

  Object.assign(carrito, f.carrito);   // se repone "por dentro": sigue siendo el mismo objeto carrito
  renderizarGrillaPOS();               // se ve ya, sin esperar a la base
  await cargarPOS();                   // y se recargan los precios con la lista restaurada
  anunciar('Pedido restaurado.');
  mostrarNotificacion('Pedido restaurado.');
}

export async function vaciarCarrito() {
  if (guardandoPedido) return;   // no se vacía el pedido mientras se está guardando
  const { productos, unidades } = resumenCarrito();

  // Con productos cargados se pide confirmar (un toque accidental borraría todo) y se dice CUÁNTO se va a quitar.
  // confirmarAccion (utils.js) es nuestra ventana propia; con "await" se espera la respuesta.
  if (productos > 0) {
    const ok = await confirmarAccion({
      titulo: 'Vaciar pedido',
      mensaje: `Se van a quitar ${productos} ${productos === 1 ? 'producto' : 'productos'} (${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}) del pedido actual.\nVas a poder deshacerlo durante unos segundos.`,
      textoConfirmar: 'Sí, vaciar',
      peligro: true
    });
    if (!ok) return;   // canceló: no se toca nada
    if (guardandoPedido) return;
  }

  // Foto del pedido ANTES de vaciar: resetearPedido borra también cliente, lista y referencia.
  const foto = {
    carrito: { ...carrito },
    idCliente: (document.getElementById('select-cliente-pedido') || {}).value || '',
    idLista: (document.getElementById('select-lista-pedido') || {}).value || '',
    referencia: (document.getElementById('input-ref-cliente') || {}).value || ''
  };

  // Sin await a propósito (igual que antes): hasta su primer await, resetearPedido ya dejó el
  // carrito nuevo y vacío, que es lo que necesitamos para registrar el "Deshacer" enseguida.
  resetearPedido();

  if (productos > 0) {
    anunciar('Pedido vaciado. Podés deshacerlo durante unos segundos.');
    pendienteDeshacer = { tipo: 'vaciar', foto, carritoRef: carrito };
    mostrarAvisoConAccion({
      mensaje: 'Pedido vaciado.',
      textoAccion: 'Deshacer',
      duracionMs: MS_DESHACER,
      tipo: 'deshacer',
      alAccionar: deshacerVaciado,
      alCerrar: (motivo) => { if (motivo === 'expiro' || motivo === 'cerrado') pendienteDeshacer = null; }   // ver registrarQuitado
    });
  }
}

// -----------------------------------------------------------------------------
// guardarPedido
//   Crea o edita el pedido llamando a la función del servidor guardar_pedido (script 23).
//   El navegador manda solo qué se pidió (productos y cantidades), el cliente, la lista,
//   la referencia, el estado y, si se cobra, medio y cuenta. Los PRECIOS, el DESCUENTO por
//   docena y el TOTAL los calcula el servidor; lo que se ve en pantalla es solo una vista previa.
//   estadoInicial: 'EN_PREPARACION' (pedido nuevo), 'ENTREGADO' (se entrega en el acto) o
//   'MANTENER' (solo al editar: "Guardar cambios"; la base deja el pedido en el estado que tiene).
//   cobro: null, o { idMedio, idCuenta, monto? } cuando viene de la ventana de cobro. Con cobro, la base registra UN pago
//   (script 49): por el total del pedido, o por "monto" si viene (cobro parcial / seña, script 58; solo se manda si es menor
//   al total). Con 'ENTREGADO' es cobrar y entregar; con 'EN_PREPARACION' o 'MANTENER' es un pago por adelantado (el pedido
//   sigue su camino en cocina). Con un cobro parcial el pedido queda con saldo por cobrar.
// -----------------------------------------------------------------------------
// Mientras un pedido se está guardando, un segundo toque (doble clic) no hace nada: así no se
// crea el pedido dos veces ni se imprime dos veces. "finally" libera el bloqueo siempre.
let guardandoPedido = false;

export async function guardarPedido(estadoInicial, cobro = null) {
  if (guardandoPedido) return;
  guardandoPedido = true;
  // El botón que se apretó es "Cobrar" (data-estado="COBRAR") cuando hay cobro; si no, el del estado.
  const botonApretado = cobro ? 'COBRAR' : estadoInicial;
  marcarGuardando(true, botonApretado);
  try {
    await guardarPedidoSinBloqueo(estadoInicial, cobro);
  } finally {
    guardandoPedido = false;
    marcarGuardando(false, botonApretado);
  }
}

// -----------------------------------------------------------------------------
// marcarGuardando  (interna)
//   Muestra que se está guardando: bloquea los botones que no corresponden y pone un
//   spinner en el que se apretó (solo cambia el ícono: el texto y el tamaño no se mueven).
//   Mientras tanto alterarCantidad, eliminarItemCarrito y vaciarCarrito no hacen nada
//   (miran guardandoPedido), porque un cambio hecho con el pedido "en viaje" se perdería.
// -----------------------------------------------------------------------------
const IDS_BOTONES_AL_GUARDAR = ['btn-pos-preparar', 'btn-pos-guardar-cambios', 'btn-limpiar-todo', 'btn-cancelar-edicion'];

function marcarGuardando(activo, estadoInicial) {
  const panel = document.querySelector('.pos-order-card');
  if (panel) {
    panel.classList.toggle('pos-guardando', activo);
    panel.setAttribute('aria-busy', String(activo));
  }

  const botones = IDS_BOTONES_AL_GUARDAR.map(id => document.getElementById(id)).filter(Boolean);
  document.querySelectorAll('.pos-order-card .btn-pos-cobrar').forEach(b => botones.push(b));
  botones.forEach(b => { b.disabled = activo; });

  // Spinner en el botón que disparó la acción (EN_PREPARACION, MANTENER o COBRAR).
  const apretado = document.querySelector(`.pos-order-card [data-action="guardar-pedido"][data-estado="${estadoInicial}"]`);
  const icono = apretado ? apretado.querySelector('i') : null;
  if (icono) {
    if (activo) {
      icono.dataset.claseOriginal = icono.className;
      icono.className = 'fas fa-spinner fa-spin';
    } else if (icono.dataset.claseOriginal) {
      icono.className = icono.dataset.claseOriginal;
      delete icono.dataset.claseOriginal;
    }
  }
}

// -----------------------------------------------------------------------------
// esErrorDeConexion  (interna)
//   ¿El error es de CONEXIÓN (la respuesta nunca llegó) y no una respuesta de la base?
//   Los errores que vienen de la base traen un código (P0001, 23505, PGRST...); los de red no.
//   Distinguirlos importa: con un error de conexión NO se sabe si el pedido se guardó.
// -----------------------------------------------------------------------------
function esErrorDeConexion(error) {
  if (!error) return false;
  const codigo = String(error.code || '');
  if (codigo && !/^(FETCH|ECONN|ETIMEDOUT|ENOTFOUND)/i.test(codigo)) return false;
  return /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|abort|fetch/i.test(String(error.message || error));
}

async function guardarPedidoSinBloqueo(estadoInicial, cobro = null) {
  // "Guardar cambios" (solo existe al editar): se manda 'MANTENER' y guardar_pedido (script 39)
  // deja el pedido en el estado que tiene en la base (EN_PREPARACION o LISTO), todo en un paso.
  if (estadoInicial === 'MANTENER' && !pedidoEditandoId) {
    mostrarNotificacion('No hay un pedido en edición.', 'warning');
    return;
  }

  // "Guardar cambios" sin haber cambiado nada: no se guarda (y un pedido LISTO no vuelve a preparación para nada).
  // Se sigue en la edición por si se quiere cambiar algo; "Cancelar edición" sale sin guardar.
  if (estadoInicial === 'MANTENER' && !cobro && pedidoEditandoOriginal !== null
      && fotoPedidoEnPantalla() === pedidoEditandoOriginal) {
    mostrarNotificacion(`No hiciste ningún cambio en el pedido #${pedidoEditandoId}.`, 'info');
    return;
  }

  // Cobrar un pedido que se abrió para editar pero NO se modificó: se registra solo el cobro, sin tocar el pedido (no cuenta
  // como una edición: un pedido LISTO no vuelve a preparación). Lo único que no se puede por este camino es entregar
  // directo un pedido que todavía está EN_PREPARACION (la base exige pasar por LISTO): ese caso sigue por guardar_pedido.
  if (cobro && pedidoEditandoId && pedidoEditandoOriginal !== null
      && fotoPedidoEnPantalla() === pedidoEditandoOriginal
      && (estadoInicial === 'MANTENER' || (estadoInicial === 'ENTREGADO' && pedidoEditandoEstado === 'LISTO'))) {
    await cobrarPedidoSinCambios(estadoInicial === 'ENTREGADO', cobro);
    return;
  }

  const keys = Object.keys(carrito);
  if (keys.length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  const idCliente = document.getElementById('select-cliente-pedido').value;
  const idLista = document.getElementById('select-lista-pedido').value;

  // Medio y cuenta llegan de la ventana de cobro (cobro.js) y SOLO al cobrar.
  // Un pedido que todavía no se cobró no tiene pagos registrados.
  if (estadoInicial === 'ENTREGADO' && !cobro) {
    mostrarNotificacion('Para cobrar, usá la ventana de cobro.', 'warning');
    return;
  }

  const inputRef = document.getElementById('input-ref-cliente');
  const nombreReferencia = inputRef ? inputRef.value.trim() : '';

  // La referencia solo se exige si el pedido NO se cobra por completo y entrega en el momento (un cobro parcial deja un
  // saldo que tiene que tener dueño). (El servidor repite esta regla; acá se avisa antes para no hacer el viaje.)
  const seCobraTodoYEntregaYa = estadoInicial === 'ENTREGADO' && Boolean(cobro) && !(Number(cobro.monto) > 0);
  if (idCliente === '1' && nombreReferencia === '' && !seCobraTodoYEntregaYa) {
    mostrarNotificacion('Indicá un nombre o referencia. Solo podés omitirlo si cobrás todo y entregás en el momento.', 'warning');
    if (inputRef) inputRef.focus();
    return; // Interrumpe el guardado
  }

  // Productos y cantidades. Si alguno no tiene precio en la lista elegida, se avisa cuál
  // (el servidor también lo rechaza, pero sin decir el nombre).
  const items = [];
  for (const idProd of keys) {
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    const cantidad = Number(carrito[idProd]) || 0;
    if (!p || cantidad <= 0) continue;

    const precios = obtenerPrecioProducto(p.id, p.id_categoria || p.idCategoria, idLista);
    if (!(precios.unidad > 0)) {
      mostrarNotificacion(`"${p.nombre}" no tiene precio en la lista elegida.`, 'warning');
      return;
    }
    items.push({ id_producto: Number(p.id), cantidad });
  }
  if (items.length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  const eraEdicion = Boolean(pedidoEditandoId);
  // Opción B: pedido nuevo con el pago de uno anulado. El traspaso va DENTRO de guardar_pedido (script 55): se guarda el
  // pedido y se traspasa el pago en una sola operación; si el traspaso falla, el pedido tampoco se guarda.
  const origenPago = (!eraEdicion && pedidoPagoOrigen) ? pedidoPagoOrigen : null;
  // Si se edita un pedido que estaba LISTO, la base lo devuelve a EN_PREPARACION (script 54): la cocina tiene que rehacerlo.
  const volvioAPreparacion = eraEdicion && estadoInicial === 'MANTENER' && pedidoEditandoEstado === 'LISTO';

  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabaseAdmin.rpc('guardar_pedido', {
    p_id_pedido: pedidoEditandoId || null,
    p_id_cliente: Number(idCliente),
    p_id_lista: Number(idLista),
    p_referencia: nombreReferencia,
    p_estado: estadoInicial,
    p_items: items,
    p_id_medio: cobro ? cobro.idMedio : null,
    p_id_cuenta: cobro ? cobro.idCuenta : null,
    // Solo se manda en la opción B (así un pedido común no depende de la función nueva).
    ...(origenPago ? { p_id_origen_pago: Number(origenPago.id) } : {}),
    // Solo se manda en un cobro parcial / seña (script 58): una venta común no depende de la función nueva.
    ...(cobro && Number(cobro.monto) > 0 ? { p_monto: Number(cobro.monto) } : {})
  }));
  } catch (fallo) {
    error = fallo;   // una excepción de red cuenta como error de conexión
  }

  if (error) {
    if (esErrorDeConexion(error)) {
      // La respuesta nunca llegó: el pedido PUDO haberse guardado igual. Si se reintenta a ciegas
      // se podría crear (y cobrar) dos veces, así que se avisa que primero hay que mirar el listado.
      // El aviso queda fijo hasta que se toca "Entendido". El pedido en pantalla NO se borra.
      descartarDeshacer();
      mostrarAvisoConAccion({
        mensaje: 'No se pudo confirmar si el pedido se guardó (falló la conexión). Antes de volver a intentar, revisá en "Listado de Pedidos" si ya aparece.',
        textoAccion: 'Entendido',
        duracionMs: 0,
        tipo: 'peligro'
      });
      return;
    }
    mostrarNotificacion('Error al guardar el pedido: ' + mensajeErrorFuncion(error, 'pedido'), 'danger');
    return;
  }

  // Con un cobro parcial (seña) se aclara cuánto se cobró y cuánto falta (lo devuelve la base).
  const saldoPendiente = cobro ? Number(data.saldo) : 0;
  let textoOk = volvioAPreparacion
    ? `Pedido #${data.id_pedido} actualizado: vuelve a En Preparación para que la cocina lo rehaga.`
    : `¡Pedido #${data.id_pedido} ${eraEdicion ? 'actualizado' : 'registrado'} con éxito!`;
  if (saldoPendiente > 0) textoOk += ` Cobrado ${formatearPesos(data.cobrado)}; falta cobrar ${formatearPesos(saldoPendiente)}.`;
  mostrarNotificacion(textoOk, saldoPendiente > 0 ? 'warning' : 'success');

  // Opción B: el pago ya se traspasó dentro de guardar_pedido (misma transacción). Acá solo se avisa el resultado.
  const huboTraspaso = Boolean(origenPago);
  if (origenPago) avisarTraspaso(origenPago, data.id_pedido, data.traspaso);

  if (inputRef) inputRef.value = '';

  setPedidoEditandoId(null);
  resetearPedido();

  // Impresión automática (si este equipo la tiene activada en la pantalla "Impresión").
  programarImpresion(data.id_pedido, estadoInicial, eraEdicion, Boolean(cobro) || huboTraspaso, volvioAPreparacion);
}

// -----------------------------------------------------------------------------
// cobrarPedidoSinCambios  (interna)
//   Cobro de un pedido que se abrió para editar y no se modificó. Hace lo mismo que el Listado de Pedidos:
//     entregar ahora (pedido LISTO)  -> cambiar_estado_pedido a ENTREGADO con el cobro
//     pagó por adelantado            -> registrar_cobro_pedido (el pedido conserva su estado)
//     cobro parcial (cobro.monto)    -> registrar_cobro_pedido con p_monto; si además se entrega, la entrega es un SEGUNDO paso
//                                      (cambiar_estado_pedido sin cobro), igual que en el listado: el pedido queda con saldo.
//   El pedido no se reescribe. Si sale bien, limpia el POS e imprime el ticket según las preferencias del equipo.
// -----------------------------------------------------------------------------
async function cobrarPedidoSinCambios(entregar, cobro) {
  const idPedido = pedidoEditandoId;
  const esParcial = Number(cobro.monto) > 0;   // solo viene cuando se cobra menos que el total
  let error = null;
  let errorEntrega = null;   // solo en cobro parcial + entregar: el cobro salió bien pero la entrega falló
  try {
    ({ error } = (entregar && !esParcial)
      ? await supabaseAdmin.rpc('cambiar_estado_pedido', {
          p_id_pedido: Number(idPedido),
          p_nuevo_estado: 'ENTREGADO',
          p_id_medio: cobro.idMedio,
          p_id_cuenta: cobro.idCuenta
        })
      : await supabaseAdmin.rpc('registrar_cobro_pedido', {
          p_id_pedido: Number(idPedido),
          p_id_medio: cobro.idMedio,
          p_id_cuenta: cobro.idCuenta,
          ...(esParcial ? { p_monto: Number(cobro.monto) } : {})
        }));
  } catch (fallo) {
    error = fallo;
  }

  // Cobro parcial + entregar: segundo paso, la entrega sin cobrar el resto (el cobro ya quedó registrado).
  if (!error && entregar && esParcial) {
    try {
      ({ error: errorEntrega } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
        p_id_pedido: Number(idPedido),
        p_nuevo_estado: 'ENTREGADO'
      }));
    } catch (fallo) {
      errorEntrega = fallo;
    }
  }

  if (error) {
    if (esErrorDeConexion(error)) {
      // La respuesta nunca llegó: el cobro PUDO registrarse. Se avisa que primero hay que mirar el listado.
      mostrarAvisoConAccion({
        mensaje: `No se pudo confirmar si el cobro del pedido #${idPedido} se registró (falló la conexión). Antes de volver a intentar, revisá en "Listado de Pedidos" si ya figura como cobrado.`,
        textoAccion: 'Entendido',
        duracionMs: 0,
        tipo: 'peligro'
      });
      return;
    }
    mostrarNotificacion('Error al registrar el cobro: ' + mensajeErrorFuncion(error, 'pedido'), 'danger');
    return;
  }

  const entregado = entregar && !errorEntrega;
  if (errorEntrega) {
    mostrarNotificacion(`Se registró el cobro de ${formatearPesos(cobro.monto)} en el pedido #${idPedido}, pero no se pudo marcar como entregado: ${mensajeErrorFuncion(errorEntrega, 'pedido')} Entregalo desde el listado.`, 'warning');
  } else if (esParcial) {
    mostrarNotificacion(`Seña registrada en el pedido #${idPedido}: ${formatearPesos(cobro.monto)}. El resto queda por cobrar${entregado ? '. Pedido entregado.' : '.'}`, 'warning');
  } else {
    mostrarNotificacion(entregar
      ? `Pedido #${idPedido} cobrado y entregado.`
      : `Cobro registrado en el pedido #${idPedido}.`, 'success');
  }

  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = '';
  setPedidoEditandoId(null);
  resetearPedido();

  // Ticket según las preferencias de este equipo (la comanda ya salió cuando se tomó el pedido).
  programarImpresion(idPedido, entregado ? 'ENTREGADO' : 'MANTENER', true, true, false);
}

// -----------------------------------------------------------------------------
// avisarTraspaso  (interna)
//   Opción B: avisa cuánto se traspasó del pedido anulado (origen) al pedido recién guardado. El traspaso lo hizo
//   guardar_pedido (script 55) y devuelve el resultado en data.traspaso; esta función no llama a la base.
// -----------------------------------------------------------------------------
function avisarTraspaso(origen, idNuevo, traspaso) {
  const pesos = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`;
  let mensaje = `Pago traspasado: ${pesos(traspaso?.traspasado)} del pedido #${origen.id} al #${idNuevo}.`;
  if (Number(traspaso?.a_devolver_origen) > 0) mensaje += ` Quedan ${pesos(traspaso.a_devolver_origen)} a devolver en el #${origen.id}.`;
  if (Number(traspaso?.saldo_destino) > 0) mensaje += ` Al #${idNuevo} le faltan cobrar ${pesos(traspaso.saldo_destino)}.`;
  mostrarNotificacion(mensaje, Number(traspaso?.a_devolver_origen) > 0 || Number(traspaso?.saldo_destino) > 0 ? 'warning' : 'success');
}

// -----------------------------------------------------------------------------
// programarImpresion  (interna)
//   Decide qué imprimir después de guardar, según las preferencias de este equipo:
//     Solo preparar (pedido nuevo)             -> comanda
//     Cobrar y entregar (pedido nuevo)         -> comanda y ticket
//     Cobrar y entregar (pedido editado)       -> solo el ticket (la comanda ya salió al prepararlo)
//     Pago por adelantado (pedido nuevo)       -> comanda (si está activada) y ticket
//     Pago por adelantado (pedido editado)     -> solo el ticket
//     Editar sin cobrar                        -> nada (si estaba LISTO y vuelve a preparación: comanda MODIFICADA)
//   La impresión se difiere un instante (setTimeout) y NO se espera: el pedido ya está
//   guardado y la pantalla ya se limpió, así que un problema de la impresora no afecta nada.
// -----------------------------------------------------------------------------
function programarImpresion(idPedido, estado, eraEdicion, huboCobro, modificada = false) {
  const pref = leerPreferenciasImpresion();
  let comanda = false;
  let ticket = false;

  if (estado === 'ENTREGADO') {
    // Cobrar y entregar en el acto (antes "COMPLETADO")
    if (pref.imprimirAlCobrar) {
      comanda = !eraEdicion;
      ticket = true;
    }
  } else {
    // 'EN_PREPARACION' (nuevo) o 'MANTENER' (edición): la comanda sale solo al crear el pedido; el ticket, solo si se cobró.
    comanda = estado === 'EN_PREPARACION' && pref.comandaAlPreparar && !eraEdicion;
    // Un pedido que estaba Listo y se modificó vuelve a la cocina: sale una comanda nueva marcada como MODIFICADA.
    if (modificada && pref.comandaAlPreparar) comanda = true;
    ticket = huboCobro && pref.imprimirAlCobrar;
  }
  if (!comanda && !ticket) return;

  setTimeout(async () => {
    try {
      const ok = await imprimirAutomatico(idPedido, { comanda, ticket, modificada });
      if (!ok) throw new Error('No se encontró el pedido para imprimir.');
    } catch (err) {
      console.error('Error al imprimir automáticamente:', err);
      mostrarNotificacion(`El pedido #${idPedido} se guardó, pero no se pudo imprimir. Podés reimprimirlo desde Gestión de Pedidos (botón Más).`, 'warning');
    }
  }, 150);
}

// -----------------------------------------------------------------------------
// iniciarCobroPOS
//   Se ejecuta al apretar "Cobrar". En vez de guardar directo, abre la ventana de cobro (cobro.js);
//   el pedido se guarda recién cuando se confirma ahí. En esa ventana se elige si se entrega ahora
//   (cobrar y entregar) o si el cliente paga por adelantado (el pedido queda en preparación).
// -----------------------------------------------------------------------------
export async function iniciarCobroPOS() {
  if (pedidoPagoOrigen && !pedidoEditandoId) {
    mostrarNotificacion('Este pedido recibe el pago de un pedido anulado: guardalo con "Solo preparar" y la diferencia se cobra después desde el listado.', 'warning');
    return;
  }
  if (Object.keys(carrito).length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  // Un cobro parcial (seña) deja un saldo, y un saldo tiene que tener dueño: con Consumidor Final hace falta un nombre.
  const sinNombre = () => document.getElementById('select-cliente-pedido')?.value === '1'
    && (document.getElementById('input-ref-cliente')?.value || '').trim() === '';

  await abrirModalCobro({
    titulo: 'Cobrar',
    subtitulo: pedidoEditandoId
      ? `Pedido #${pedidoEditandoId}: completá los datos de pago.`
      : 'Completá los datos de pago del pedido.',
    permiteAnticipado: true,   // muestra "Entregar ahora" / "Pagó por adelantado"
    permiteMontoParcial: true, // muestra "Monto a cobrar ahora" (seña): arranca en el total
    ayudaParcial: sinNombre()
      ? 'Para cobrar una seña hace falta un nombre: cerrá esta ventana, completalo y volvé a cobrar.'
      : 'Queda como seña: el resto se cobra después.',
    total: totalCarritoActual,
    unidades: unidadesCarritoActual,
    // Callback: la ventana lo llama al confirmar. Devuelve true si se guardó (la ventana
    // se cierra) o false si falló (queda abierta para corregir). "monto" es lo que se cobra ahora.
    alConfirmar: async (idMedio, idCuenta, entregar, monto) => {
      const esParcial = Math.round(Number(monto) * 100) < Math.round(Number(totalCarritoActual) * 100);
      if (esParcial) {
        if (sinNombre()) {
          mostrarNotificacion('Para cobrar una seña indicá un nombre o referencia (cerrá esta ventana, completalo y volvé a cobrar).', 'warning');
          return false;
        }
        // Entregar ahora con saldo pendiente: se pide confirmación antes de guardar nada.
        if (entregar) {
          const queda = (Math.round(Number(totalCarritoActual) * 100) - Math.round(Number(monto) * 100)) / 100;
          if (!(await confirmarEntregaConSaldo(queda))) return false;
        }
      }
      // Entregar ahora -> ENTREGADO. Pagó por adelantado -> un pedido nuevo queda EN_PREPARACION y uno que se
      // está editando conserva su estado (MANTENER). En los dos casos la base registra el pago (parcial si hay monto).
      const estado = entregar ? 'ENTREGADO' : (pedidoEditandoId ? 'MANTENER' : 'EN_PREPARACION');
      await guardarPedido(estado, { idMedio, idCuenta, ...(esParcial ? { monto: Number(monto) } : {}) });
      // Si guardó bien, guardarPedido vació el carrito (resetearPedido). Si falló, el
      // carrito sigue lleno.
      return Object.keys(carrito).length === 0;
    }
  });
}

export function eliminarItemCarrito(idProducto) {
  if (guardandoPedido) return;   // mientras se guarda, el pedido no se modifica
  if (carrito[idProducto]) {
    const cantidadQuitada = carrito[idProducto];
    delete carrito[idProducto]; // Borramos el ítem del estado
    cambioParaAnunciar = { id: idProducto, cant: 0 };

    // Si la tarjeta está en pantalla se actualiza sola; si está en otra solapa, se re-dibuja la grilla.
    if (!sincronizarTarjeta(idProducto, 0)) renderizarGrillaPOS();

    actualizarResumenCarrito();

    // Se quita sin preguntar (es rápido), pero se puede deshacer unos segundos.
    registrarQuitado(idProducto, cantidadQuitada);
  }
}
