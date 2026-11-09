import { supabasePublic } from './config.js';
import { buscarPrecio, resumirPedido } from './precios.js';

let cacheCategorias = [];
let cacheProductos = [];
let cachePrecios = [];
let carrito = {}; // { id_producto: cantidad }
let grupoDeProducto = {}; // { id_producto: id del bloque (g0, g1...) } (se arma al dibujar el menú)
let enviando = false; // true mientras se está enviando el pedido (evita envíos duplicados)

// Categorías desplegables: false = arranca abierta solo la primera; true = arrancan todas abiertas.
const ABRIR_TODAS_LAS_CATEGORIAS = false;

// Foto FIJA por grupo: la misma imagen en todas las tarjetas del grupo. Los archivos van en la
// carpeta "img" junto a cliente.html. Se elige la foto cuando el nombre del grupo CONTIENE la clave
// (ej.: "Pizzas" contiene "pizza"). Si el archivo no existe o no carga, se ve el ícono del grupo.
const FOTOS_GRUPO = {
  empanada: 'img/empanada.jpg',
  canastita: 'img/canastita.jpg',
  pizza: 'img/pizza.jpg'
};

// WhatsApp del NEGOCIO al que apunta el botón "Avisarnos por WhatsApp" de la pantalla "Pedido recibido".
// No está escrito acá: se lee de la base (función whatsapp_negocio, script 40) y se cambia con un UPDATE.
// Solo dígitos, formato internacional (549 + característica + número). Si está vacío, el botón no se muestra.
let whatsappNegocio = '';

// Token opcional del link (?t=...). Lo genera el bot desde el servidor.
// Cliente consumidor final, lista de precios y medio de pago se fijan en la base.
const TOKEN_LINK = new URLSearchParams(window.location.search).get('t');

// Escapa texto antes de ponerlo en innerHTML (evita inyección de HTML/JS)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Importe en pesos con formato argentino. Enteros sin decimales; si hay centavos, hasta 2.
// Ejemplo: 17000 -> '$17.000'   |   26533.33 -> '$26.533,33'
function formatoPesos(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
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
  // UN solo oyente para todos los botones + y −. El menú se dibuja una vez y al tocar
  // solo se actualiza la tarjeta tocada (no se rehace todo, así las categorías
  // desplegadas/cerradas se mantienen).
  document.getElementById('contenedor-productos-cliente')?.addEventListener('click', alTocarCantidad);

  // El número del negocio se pide aparte y SIN esperar: si falla, solo no aparece el botón de WhatsApp.
  cargarWhatsAppNegocio();

  await cargarDatosMenu();

  // Al abrir el modal: vuelve al paso de datos, autocompleta lo que vino en la URL y arma el desglose.
  $('#modalConfirmarCliente').on('show.bs.modal', prepararModalConfirmacion);

  // Mientras se está enviando no se puede cerrar el modal (ni con la X ni tocando afuera).
  $('#modalConfirmarCliente').on('hide.bs.modal', (e) => {
    if (enviando) e.preventDefault();
  });

  document.getElementById('btn-confirmar-pedido')?.addEventListener('click', () => {
    $('#modalConfirmarCliente').modal('show');
  });

  document.getElementById('btn-finalizar-pedido')?.addEventListener('click', enviarPedidoASupabase);
});

// Pide a la base el WhatsApp del negocio. Cualquier error se ignora (queda vacío y no se muestra el botón).
async function cargarWhatsAppNegocio() {
  try {
    const { data, error } = await supabasePublic.rpc('whatsapp_negocio');
    if (error) throw error;
    whatsappNegocio = String(data ?? '').replace(/\D/g, '');
  } catch (err) {
    console.warn('No se pudo leer el WhatsApp del negocio (el botón no se mostrará):', err);
  }
}

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

// -----------------------------------------------------------------------------
// Grupos, íconos y orden: MISMA lógica que el POS (pos.js), para que el menú del cliente se vea
// agrupado igual: Empanada / Canastita / Pizzas (sin abrir por Simple, Especial y Premium).
// Si se cambia la lógica en pos.js, cambiarla también acá.
// -----------------------------------------------------------------------------

// Grupo (bloque) de una categoría. Si la categoría no tiene grupo cargado, usa su propio nombre.
function grupoDeCategoria(cat) {
  return String(cat.grupo || '').trim() || String(cat.nombre || '').trim();
}

// El grupo "sistema" (bonificaciones) no se muestra. Se mantiene también la comprobación del id 99.
function esCategoriaSistema(cat) {
  return Number(cat.id) === 99 || grupoDeCategoria(cat).toUpperCase() === 'SISTEMA';
}

// Texto del bloque: 'PIZZAS' -> 'Pizzas'
function titularGrupo(texto) {
  const t = String(texto).trim();
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Clase del ícono de Font Awesome según el nombre (los mismos íconos que el POS).
function iconoCategoria(nombre) {
  const nom = String(nombre || '').toLowerCase();
  if (nom.includes('pizza')) return 'fa-pizza-slice';
  if (nom.includes('empanada')) return 'fa-cookie-bite';
  if (nom.includes('canastita')) return 'fa-shopping-basket';
  if (nom.includes('bebida')) return 'fa-wine-bottle';
  if (nom.includes('otros')) return 'fa-th-large';
  return 'fa-utensils'; // respaldo para cualquier categoría nueva
}

// Orden de las tarjetas: 1) por categoría (en el orden en que vienen), 2) por el campo "orden" del
// producto (el menor primero; los que no tienen número van al final), 3) por id.
function compararProductosCatalogo(a, b) {
  const posCategoria = p => cacheCategorias.findIndex(c => Number(c.id) === Number(p.id_categoria || p.idCategoria));
  // Sin orden = Infinity: queda al final. (Number(null) daría 0 y los pondría primeros.)
  const ordenDe = p => (p.orden === null || p.orden === undefined || p.orden === '') ? Infinity : Number(p.orden);

  const porCategoria = posCategoria(a) - posCategoria(b);
  if (porCategoria !== 0) return porCategoria;

  const oa = ordenDe(a);
  const ob = ordenDe(b);
  if (oa !== ob) return oa < ob ? -1 : 1; // (no se resta: Infinity - Infinity daría NaN)

  return Number(a.id) - Number(b.id);
}

// Clave de la foto fija de un grupo ('' si no hay foto definida para ese grupo).
function claveFotoGrupo(titulo) {
  const nom = String(titulo || '').toLowerCase();
  return Object.keys(FOTOS_GRUPO).find(clave => nom.includes(clave)) || '';
}

// Pone la foto fija en las tarjetas. El ícono queda debajo SIEMPRE: la foto se agrega solo si el
// archivo carga. Se prueba UNA vez por foto (no una por tarjeta), así un archivo faltante no genera
// decenas de pedidos fallidos.
function cargarFotosFijas() {
  Object.entries(FOTOS_GRUPO).forEach(([clave, url]) => {
    const fichas = document.querySelectorAll(`.prod-foto[data-foto="${clave}"]`);
    if (fichas.length === 0) return;

    const prueba = new Image();
    prueba.onload = () => {
      fichas.forEach(ficha => {
        if (ficha.querySelector('img')) return;
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.decoding = 'async';
        ficha.appendChild(img);
      });
    };
    prueba.src = url; // si el archivo no existe, no pasa nada: queda el ícono
  });
}

// -----------------------------------------------------------------------------
// renderizarMenuPorCategorias
//   Dibuja el menú UNA vez (al cargar), agrupado como el POS. Cada grupo es un bloque desplegable
//   (Bootstrap "collapse"): el encabezado es un botón que abre/cierra la lista y muestra un globito
//   con las unidades elegidas aunque esté cerrado. Todos los encabezados tienen el mismo color.
// -----------------------------------------------------------------------------
function renderizarMenuPorCategorias() {
  const contenedor = document.getElementById('contenedor-productos-cliente');
  if (!contenedor) return;

  // Grupos SIN repetir, en el orden en que aparecen las categorías. La clave va en minúsculas
  // para que 'Pizzas' y 'PIZZAS' cuenten como el mismo grupo.
  const grupos = new Map(); // clave -> { titulo, ids: ids de las categorías del grupo }
  cacheCategorias.forEach(cat => {
    if (esCategoriaSistema(cat)) return;
    const nombreGrupo = grupoDeCategoria(cat);
    const clave = nombreGrupo.toLowerCase();
    if (!grupos.has(clave)) grupos.set(clave, { titulo: titularGrupo(nombreGrupo), ids: new Set() });
    grupos.get(clave).ids.add(Number(cat.id));
  });

  let html = '';
  let indice = 0;
  grupoDeProducto = {};

  grupos.forEach(grupo => {
    // Productos de TODAS las categorías del grupo, en el orden del catálogo (sin el producto 999).
    const prodsGrupo = cacheProductos
      .filter(p => Number(p.id) !== 999 && grupo.ids.has(Number(p.id_categoria || p.idCategoria)))
      .sort(compararProductosCatalogo);
    if (prodsGrupo.length === 0) return;

    const idDom = `g${indice}`;
    const abierta = ABRIR_TODAS_LAS_CATEGORIAS || indice === 0;
    indice++;

    const icono = iconoCategoria(grupo.titulo);
    const claveFoto = claveFotoGrupo(grupo.titulo);
    // Si el grupo reúne varias categorías (ej. Pizzas: Simple, Especial, Premium), cada tarjeta
    // muestra una etiqueta chica con la suya, porque el precio puede cambiar entre ellas.
    const variasCategorias = grupo.ids.size > 1;

    html += `
      <section class="grupo-cat">
        <button type="button" class="cat-header ${abierta ? '' : 'collapsed'}"
                data-toggle="collapse" data-target="#cat-${idDom}"
                aria-expanded="${abierta ? 'true' : 'false'}" aria-controls="cat-${idDom}">
          <span class="cat-titulo"><i class="fas ${icono}" aria-hidden="true"></i>${esc(grupo.titulo)}</span>
          <span class="cat-der">
            <span class="cat-badge d-none" id="badge-${idDom}"></span>
            <i class="fas fa-chevron-down cat-chevron" aria-hidden="true"></i>
          </span>
        </button>
        <div class="collapse ${abierta ? 'show' : ''}" id="cat-${idDom}">
          <div class="cat-lista">
    `;

    prodsGrupo.forEach(p => {
      grupoDeProducto[p.id] = idDom;

      const cant = carrito[p.id] || 0;
      const idCatProd = p.id_categoria || p.idCategoria;
      const precios = obtenerPrecioProductoCliente(p.id, idCatProd);

      let htmlEtiqueta = '';
      if (variasCategorias) {
        const cat = cacheCategorias.find(c => Number(c.id) === Number(idCatProd));
        if (cat) htmlEtiqueta = `<span class="prod-cat">${esc(cat.nombre)}</span>`;
      }

      // Jerarquía: nombre (protagonista) > precio por unidad > precio por docena (discreto)
      let htmlDocena = '';
      if (p.m_permite_docena && precios.docena) {
        htmlDocena = `<span class="prod-docena">${formatoPesos(precios.docena)} doc.</span>`;
      }

      html += `
            <div class="prod-card ${cant > 0 ? 'en-carrito' : ''}" data-prod="${p.id}">
              <div class="prod-foto" ${claveFoto ? `data-foto="${claveFoto}"` : ''} aria-hidden="true">
                <i class="fas ${icono}"></i>
              </div>
              <div class="prod-info">
                ${htmlEtiqueta}
                <div class="prod-nombre">${esc(p.nombre)}</div>
                <div class="prod-precio">${formatoPesos(precios.unidad)} <span class="prod-unidad">/ u</span></div>
                ${htmlDocena}
              </div>
              <div class="qty">
                <button type="button" class="qty-btn qty-menos" data-accion="restar" data-id="${p.id}"
                        aria-label="Quitar uno de ${esc(p.nombre)}" ${cant === 0 ? 'disabled' : ''}>&minus;</button>
                <span class="qty-num" aria-live="polite">${cant}</span>
                <button type="button" class="qty-btn qty-mas" data-accion="sumar" data-id="${p.id}"
                        aria-label="Agregar uno de ${esc(p.nombre)}">+</button>
              </div>
            </div>
      `;
    });

    html += `
          </div>
        </div>
      </section>
    `;
  });

  contenedor.innerHTML = html;

  // Globitos de los grupos y barra de abajo, según lo que ya haya en el carrito.
  for (let i = 0; i < indice; i++) actualizarBadgeGrupo(`g${i}`);
  actualizarBarraCarrito();

  // Fotos fijas por grupo (solo se agregan si el archivo carga).
  cargarFotosFijas();
}

// Atiende los toques en + y − (delegación: un solo oyente sobre el contenedor).
function alTocarCantidad(e) {
  const btn = e.target.closest('.qty-btn');
  if (!btn || btn.disabled) return;
  cambiarCantidad(Number(btn.dataset.id), btn.dataset.accion === 'sumar' ? 1 : -1);
}

// Precio { unidad, docena } de un producto. La búsqueda vive en precios.js (la misma que usa el POS, con pruebas
// automáticas en tests/). Acá no se filtra por lista: menu_publico ya devuelve los precios de UNA sola lista.
function obtenerPrecioProductoCliente(idProd, idCat) {
  return buscarPrecio(cachePrecios, idProd, idCat);
}

function cambiarCantidad(idProd, cambio) {
  const actual = carrito[idProd] || 0;
  const nuevo = actual + cambio;

  if (nuevo <= 0) {
    delete carrito[idProd];
  } else {
    carrito[idProd] = nuevo;
  }

  // Se actualiza solo lo que cambió (tarjeta, globito de su categoría y barra de abajo).
  actualizarTarjeta(idProd);
  actualizarBadgeGrupo(grupoDeProducto[idProd]);
  actualizarBarraCarrito();
}

// Pone en la tarjeta de un producto la cantidad actual: número, resaltado y botón −.
function actualizarTarjeta(idProd) {
  const card = document.querySelector(`.prod-card[data-prod="${Number(idProd)}"]`);
  if (!card) return;

  const cant = carrito[idProd] || 0;
  card.classList.toggle('en-carrito', cant > 0);

  const num = card.querySelector('.qty-num');
  if (num) num.textContent = cant;

  const menos = card.querySelector('.qty-menos');
  if (menos) menos.disabled = cant === 0;
}

// Globito del encabezado de un grupo: unidades elegidas en él (oculto si es 0).
function actualizarBadgeGrupo(idDom) {
  const badge = document.getElementById(`badge-${idDom}`);
  if (!badge) return;

  let unidades = 0;
  Object.entries(carrito).forEach(([idProd, cant]) => {
    if (grupoDeProducto[idProd] === idDom) unidades += cant;
  });

  badge.textContent = `${unidades} u.`;
  badge.classList.toggle('d-none', unidades === 0);
}

// (El descuento por docena y los totales del pedido viven en precios.js: es el MISMO código que usa el POS, con
//  pruebas automáticas en tests/. El servidor es la fuente de verdad: crear_pedido_cliente calcula el total real.)

// Cálculo centralizado para el cliente
function obtenerResumenCarritoCliente() {
  const lineasPedido = []; // una por producto del pedido: de acá salen los totales y el descuento (precios.js)
  const listaItems = [];

  Object.entries(carrito).forEach(([idProd, cant]) => {

    // FILTRO: Omitir el producto bonificación 999 del desglose normal
    if (Number(idProd) === 999) return;
    
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cantidad = Number(cant) || 0;
    if (cantidad <= 0) return;

    const idCatProd = p.id_categoria || p.idCategoria;
    const precios = obtenerPrecioProductoCliente(p.id, idCatProd);
    const precioUnidad = precios.unidad || 0;
    const subTotal = cantidad * precioUnidad;

    lineasPedido.push({ cantidad, precioUnidad, precioDocena: precios.docena || 0, permiteDocena: !!p.m_permite_docena });

    listaItems.push({
      id: p.id,
      nombre: p.nombre,
      cantidad: cantidad,
      precioUnitario: precioUnidad,
      subTotal: subTotal
    });
  });

  const {
    unidades: totalUnidades, subtotal: subtotalSinDescuento, docenasCompletas, descuentoTotal, total
  } = resumirPedido(lineasPedido);

  // Nunca negativo (como estaba antes en esta pantalla).
  const totalFinal = Math.max(0, total);

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
  if (badgeMonto) badgeMonto.innerText = formatoPesos(resumen.totalFinal);

  if (btn) {
    if (resumen.totalUnidades > 0) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'true');
    }
  }
}

// -----------------------------------------------------------------------------
// Modal de confirmación
// -----------------------------------------------------------------------------

// Texto del botón final. Incluye el total para que se vea qué importe se confirma.
function textoBotonConfirmar() {
  const total = obtenerResumenCarritoCliente().totalFinal;
  return `<i class="fas fa-check mr-1" aria-hidden="true"></i> CONFIRMAR PEDIDO · ${formatoPesos(total)}`;
}

// Bloquea / desbloquea el botón final. "html" opcional: si no viene, el texto normal.
function ponerBotonConfirmar(bloqueado, html) {
  const btn = document.getElementById('btn-finalizar-pedido');
  if (!btn) return;
  btn.disabled = bloqueado;
  btn.innerHTML = html ?? textoBotonConfirmar();
}

// Aviso rojo dentro del modal (reemplaza a los alert del navegador).
// "campo" opcional: el input que se marca y recibe el foco.
function mostrarErrorModal(mensaje, campo) {
  const caja = document.getElementById('cliente-error');
  if (caja) {
    caja.textContent = mensaje;
    caja.classList.remove('d-none');
  }
  if (campo) {
    campo.classList.add('is-invalid');
    campo.focus();
  }
}

function ocultarErrorModal() {
  document.getElementById('cliente-error')?.classList.add('d-none');
  ['cliente-nombre', 'cliente-telefono'].forEach(id => {
    document.getElementById(id)?.classList.remove('is-invalid');
  });
}

// Muestra el paso 1 (datos) y oculta el paso 2 (pedido recibido).
function mostrarPasoDatos() {
  document.getElementById('cliente-paso-datos')?.classList.remove('d-none');
  document.getElementById('cliente-paso-exito')?.classList.add('d-none');
}

function prepararModalConfirmacion() {
  mostrarPasoDatos();
  ocultarErrorModal();

  // Datos que pueden venir en el link del bot (?tel=...&nombre=...). Solo se completan
  // si el campo está vacío, para no pisar lo que la persona ya escribió.
  const params = new URLSearchParams(window.location.search);
  const telParam = params.get('tel');
  const nombreParam = params.get('nombre');

  const inputTel = document.getElementById('cliente-telefono');
  const inputNombre = document.getElementById('cliente-nombre');
  if (telParam && inputTel && !inputTel.value) inputTel.value = telParam;
  if (nombreParam && inputNombre && !inputNombre.value) inputNombre.value = nombreParam;

  renderizarResumenEnModalCliente();
  ponerBotonConfirmar(false);
}

// Nombre de la categoría de un producto (ej.: 'Canastita', 'Empanada', 'Pizza especial'). Sirve para distinguir
// productos que se llaman igual en categorías distintas (ej.: Caprese). Devuelve '' si no se encuentra.
function nombreCategoriaDeProducto(idProd) {
  const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
  if (!p) return '';
  const cat = cacheCategorias.find(c => Number(c.id) === Number(p.id_categoria || p.idCategoria));
  return cat ? String(cat.nombre) : '';
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
    // Categoría del producto, para distinguir por ejemplo un Caprese de Canastita de uno de Empanada.
    const categoria = nombreCategoriaDeProducto(item.id);
    const htmlCategoria = categoria ? `<span class="prod-cat">${esc(categoria)}</span>` : '';

    html += `
      <li class="list-group-item d-flex justify-content-between align-items-center p-2 bg-transparent border-bottom">
        <div>
          ${htmlCategoria}
          <strong class="d-block text-dark">${esc(item.nombre)}</strong>
          <small class="text-muted">${item.cantidad} u. x ${formatoPesos(item.precioUnitario)}</small>
        </div>
        <span class="font-weight-bold text-dark">${formatoPesos(item.subTotal)}</span>
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
        <span class="font-weight-bold">-${formatoPesos(resumen.descuentoTotal)}</span>
      </li>
    `;
  }

  html += `</ul>
    <div class="d-flex justify-content-between align-items-center p-2 mb-3 bg-white rounded border">
      <span class="font-weight-bold">TOTAL DEL PEDIDO:</span>
      <span class="h5 font-weight-bold text-success mb-0">${formatoPesos(resumen.totalFinal)}</span>
    </div>
  `;

  contenedor.innerHTML = html;
}

// Paso 2: "Pedido recibido". Deja claro que se está verificando, no que ya se prepara.
function mostrarPasoExito(idPedido, total, nombre, telefono) {
  const paso = document.getElementById('cliente-paso-exito');
  if (!paso) return;

  // Botón OPCIONAL: abre WhatsApp con el mensaje ya escrito hacia el negocio. Es un simple link (wa.me):
  // no usa la API de Meta, no cuesta nada y el cliente decide si lo manda.
  const numeroNegocio = whatsappNegocio;
  let htmlWhatsApp = '';
  if (numeroNegocio) {
    const mensajeWS = `Hola! Envié mi pedido *#${idPedido}* por *${formatoPesos(total)}* a nombre de *${nombre}*. Quedo atento a la confirmación!`;
    const urlWS = `https://wa.me/${numeroNegocio}?text=${encodeURIComponent(mensajeWS)}`;
    htmlWhatsApp = `
      <a class="btn btn-success btn-block font-weight-bold py-2 mb-2" href="${urlWS}" target="_blank" rel="noopener">
        <i class="fa-brands fa-whatsapp mr-1" aria-hidden="true"></i> AVISARNOS POR WHATSAPP
      </a>`;
  }

  paso.innerHTML = `
    <div class="modal-body text-center py-4">
      <div class="mb-2" style="font-size: 3.2rem; color: #198754;"><i class="fas fa-circle-check" aria-hidden="true"></i></div>
      <h4 class="font-weight-bold text-dark mb-1">¡Pedido recibido!</h4>
      <p class="text-muted mb-3">Pedido <strong>#${esc(idPedido)}</strong> · Estamos verificando tu pedido antes de empezar a prepararlo.</p>
      <p class="lead mb-2">Total del pedido: <strong class="text-success">${formatoPesos(total)}</strong></p>
      <div class="alert alert-light border my-3">
        <small class="text-secondary d-block">Cliente: <strong>${esc(nombre)}</strong></small>
        <small class="text-secondary d-block">Teléfono: <strong>${esc(telefono)}</strong></small>
      </div>
      <p class="small text-muted mb-4">Podés cerrar esta ventana.</p>
      ${htmlWhatsApp}
      <button type="button" class="btn ${htmlWhatsApp ? 'btn-outline-secondary' : 'btn-success'} btn-block font-weight-bold py-2" id="btn-exito-aceptar">
        ACEPTAR
      </button>
    </div>
  `;

  document.getElementById('btn-exito-aceptar')?.addEventListener('click', () => location.reload());

  document.getElementById('cliente-paso-datos')?.classList.add('d-none');
  paso.classList.remove('d-none');
}

async function enviarPedidoASupabase() {
  // Si ya hay un envío en curso, se ignora el toque (evita pedidos duplicados).
  if (enviando) return;

  const inputNombre = document.getElementById('cliente-nombre');
  const inputTelefono = document.getElementById('cliente-telefono');
  const inputObservaciones = document.getElementById('cliente-observaciones');

  const nombre = inputNombre ? inputNombre.value.trim() : '';
  const telefono = inputTelefono ? inputTelefono.value.trim() : '';
  const observaciones = inputObservaciones ? inputObservaciones.value.trim() : '';

  ocultarErrorModal();

  if (!nombre) {
    mostrarErrorModal('Escribí tu nombre o una referencia.', inputNombre);
    return;
  }
  if (!telefono) {
    mostrarErrorModal('Escribí tu teléfono o WhatsApp.', inputTelefono);
    return;
  }

  const resumen = obtenerResumenCarritoCliente();
  if (resumen.listaItems.length === 0) {
    mostrarErrorModal('El carrito está vacío. Cerrá esta ventana y elegí productos.');
    return;
  }

  enviando = true;
  ponerBotonConfirmar(true, '<span class="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true"></span>Enviando pedido...');

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
      mostrarErrorModal(mensajeError(errPedido));
      return;
    }

    // El id y el total válidos son los que calculó el servidor
    const pedidoCreado = { id: resultado.id_pedido };
    const totalServidor = Number(resultado.total);

    // El pedido ya quedó guardado: se vacía el carrito y el formulario.
    carrito = {};
    if (inputNombre) inputNombre.value = '';
    if (inputTelefono) inputTelefono.value = '';
    if (inputObservaciones) inputObservaciones.value = '';

    // Pantalla "Pedido recibido" dentro del modal (con el botón opcional de WhatsApp)
    mostrarPasoExito(pedidoCreado.id, totalServidor, nombre, telefono);

    // Se vuelve a pedir el menú por si cambiaron precios o productos.
    await cargarDatosMenu();

  } catch (err) {
    console.error('Error al procesar el pedido:', err);
    mostrarErrorModal('Ocurrió un error inesperado. Intentá de nuevo.');
  } finally {
    enviando = false;
    ponerBotonConfirmar(false);
  }
}
