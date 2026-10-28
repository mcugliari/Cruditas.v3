import { supabaseAdmin } from './config.js';
import { cacheCategorias, setCacheCategorias } from './state.js';
import { mostrarNotificacion, confirmarAccion, esc } from './utils.js';

// Bucket público de Supabase Storage donde viven las fotos (lo crea el script 19).
const BUCKET_FOTOS = 'productos';
const MAX_BYTES_FOTO = 3 * 1024 * 1024; // 3 MB

// Productos de la última carga, por id. Sirve para completar el formulario de edición
// (la URL de la foto) sin pasarla por el botón de la tabla.
let productosPorId = new Map();
// Los listeners de la foto se enganchan UNA sola vez (la primera vez que se abre el modal).
let fotoIniciada = false;
// Dirección temporal (blob:) de la foto elegida, solo para la vista previa. Hay que liberarla.
let urlVistaLocal = null;


// Acepta solo direcciones http(s); cualquier otra cosa cuenta como "sin foto".
function urlHttp(valor) {
  const u = String(valor || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

function liberarVistaLocal() {
  if (urlVistaLocal) {
    URL.revokeObjectURL(urlVistaLocal);
    urlVistaLocal = null;
  }
}

// Muestra la foto en el recuadro del formulario (o el ícono si no hay).
function mostrarVistaPrevia(url) {
  const img = document.getElementById('prod-foto-img');
  const icono = document.getElementById('prod-foto-ph');
  const quitar = document.getElementById('btn-quitar-foto');
  if (!img || !icono || !quitar) return;
  const hay = !!url;
  if (hay) img.src = url; else img.removeAttribute('src');
  img.classList.toggle('d-none', !hay);
  icono.classList.toggle('d-none', hay);
  quitar.classList.toggle('d-none', !hay);
}

// Deja el campo de foto en un estado conocido (al abrir "nuevo" o "editar").
function prepararFoto(url) {
  iniciarFoto();
  liberarVistaLocal();
  document.getElementById('prod-imagen-archivo').value = '';
  document.getElementById('prod-imagen-url').value = url || '';
  mostrarVistaPrevia(urlHttp(url));
}

function iniciarFoto() {
  if (fotoIniciada) return;
  fotoIniciada = true;

  const inputArchivo = document.getElementById('prod-imagen-archivo');
  const inputUrl = document.getElementById('prod-imagen-url');
  const img = document.getElementById('prod-foto-img');

  // Elegir un archivo: se valida y se muestra la vista previa (todavía no se sube).
  inputArchivo.addEventListener('change', () => {
    liberarVistaLocal();
    const archivo = inputArchivo.files[0];
    if (!archivo) { mostrarVistaPrevia(urlHttp(inputUrl.value)); return; }

    if (!archivo.type.startsWith('image/')) {
      mostrarNotificacion('El archivo tiene que ser una imagen (JPG, PNG o WebP).', 'warning');
      inputArchivo.value = '';
      return;
    }
    if (archivo.size > MAX_BYTES_FOTO) {
      mostrarNotificacion('La foto pesa más de 3 MB. Achicala y probá de nuevo.', 'warning');
      inputArchivo.value = '';
      return;
    }
    urlVistaLocal = URL.createObjectURL(archivo);
    mostrarVistaPrevia(urlVistaLocal);
  });

  // Escribir una dirección: tiene prioridad sobre un archivo elegido antes.
  inputUrl.addEventListener('input', () => {
    inputArchivo.value = '';
    liberarVistaLocal();
    mostrarVistaPrevia(urlHttp(inputUrl.value));
  });

  // Si la dirección no carga, se muestra el ícono (sin borrar lo escrito).
  img.addEventListener('error', () => {
    img.classList.add('d-none');
    document.getElementById('prod-foto-ph').classList.remove('d-none');
  });

  document.getElementById('btn-quitar-foto').addEventListener('click', () => {
    inputArchivo.value = '';
    inputUrl.value = '';
    liberarVistaLocal();
    mostrarVistaPrevia('');
  });
}

// Sube el archivo al bucket y devuelve su URL pública (o null si falló).
async function subirFoto(archivo) {
  const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  // Nombre único: así dos productos nunca pisan la foto del otro.
  const ruta = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET_FOTOS)
    .upload(ruta, archivo, { contentType: archivo.type, cacheControl: '31536000' });

  if (error) {
    const falta = /row-level security|policy|not authorized|unauthorized/i.test(error.message)
      ? ' Falta el permiso de subida: ejecutá el script 20.' : '';
    mostrarNotificacion('No se pudo subir la foto: ' + error.message + falta, 'danger');
    return null;
  }
  return supabaseAdmin.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl;
}


export async function cargarCategoriasSelect() {
  if (cacheCategorias && cacheCategorias.length > 0) {
    const select = document.getElementById('prod-categoria');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Categoría --</option>' + 
        cacheCategorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    }
    return;
  }

  const { data: categorias, error } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('nombre', { ascending: true });
  if (!error && categorias) {
    setCacheCategorias(categorias);
    const select = document.getElementById('prod-categoria');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Categoría --</option>' + 
        categorias.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    }
  }
}

export async function cargarProductos() {
  await cargarCategoriasSelect();
  const tbody = document.getElementById('tabla-productos-body');

  const { data: productos, error } = await supabaseAdmin
    .from('TB_BPRODUCTOS')
    .select('id, nombre, m_permite_docena, id_categoria, imagen_url, orden, TB_BCATEGORIAS ( nombre )')
    .order('id_categoria', { ascending: true })
    .order('orden', { ascending: true, nullsFirst: false }) // los que tienen orden primero; sin orden al final
    .order('nombre', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger text-center">Error: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!productos || productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No hay productos registrados.</td></tr>`;
    return;
  }

  productosPorId = new Map(productos.map(p => [Number(p.id), p]));

  tbody.innerHTML = productos.map(prod => {
    const foto = urlHttp(prod.imagen_url);
    return `
    <tr>
        <td><span class="badge badge-secondary">#${prod.id}</span></td>
        <td>
          <div class="prod-tabla-foto">
            <i class="fas fa-image" aria-hidden="true"></i>
            ${foto ? `<img src="${esc(foto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          </div>
        </td>
        <td><span class="badge badge-info">${prod.TB_BCATEGORIAS ? esc(prod.TB_BCATEGORIAS.nombre) : 'Sin Cat.'}</span></td>
        <td class="font-weight-bold">${esc(prod.nombre)}</td>
        <td class="text-center">${prod.orden === null || prod.orden === undefined ? '<span class="text-muted">—</span>' : Number(prod.orden)}</td>
        <td class="text-center">
        ${prod.m_permite_docena 
            ? '<span class="badge badge-success"><i class="fas fa-check mr-1"></i>Sí</span>' 
            : '<span class="badge badge-light border"><i class="fas fa-times mr-1 text-muted"></i>No</span>'}
        </td>
        <td class="text-center">
        <button class="btn btn-accion btn-accion-editar mr-1" data-action="editar-producto" data-id="${prod.id}" data-nombre="${esc(prod.nombre)}" data-categoria="${prod.id_categoria}" data-docena="${prod.m_permite_docena}">
            <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-accion btn-accion-peligro" data-action="eliminar-producto" data-id="${prod.id}" data-nombre="${esc(prod.nombre)}">
            <i class="fas fa-trash-alt"></i> Eliminar
        </button>
        </td>
    </tr>
    `;
  }).join('');
}

export function abrirModalNuevoProducto() {
  document.getElementById('prod-id').value = '';
  document.getElementById('form-producto').reset();
  prepararFoto('');
  document.getElementById('modal-producto-title').innerText = 'Nuevo Producto';
  $('#modal-producto').modal('show');
}

export function abrirModalEditarProducto(id, nombre, id_categoria, permiteDocena) {
  document.getElementById('prod-id').value = id;
  document.getElementById('prod-nombre').value = nombre;
  document.getElementById('prod-categoria').value = id_categoria;
  document.getElementById('prod-permite-docena').checked = permiteDocena;
  const guardado = productosPorId.get(Number(id));
  document.getElementById('prod-orden').value = guardado?.orden ?? '';
  prepararFoto(guardado?.imagen_url || '');
  document.getElementById('modal-producto-title').innerText = 'Editar Producto';
  $('#modal-producto').modal('show');
}

export async function guardarProducto(event) {
  event.preventDefault();
  const id = document.getElementById('prod-id').value;
  const nombre = document.getElementById('prod-nombre').value;
  const id_categoria = document.getElementById('prod-categoria').value;
  const m_permite_docena = document.getElementById('prod-permite-docena').checked;

  // Desactivamos el botón: la subida de la foto tarda y un doble clic crearía el producto dos veces.
  const boton = event.submitter || document.querySelector('#form-producto [type="submit"]');
  if (boton) boton.disabled = true;

  // try / finally: "finally" corre SIEMPRE al salir, así el botón nunca queda trabado.
  try {
    // Orden en el catálogo: vacío = sin orden (NULL); si hay número, entero mayor o igual a 0.
    // Se valida ANTES de subir la foto, para no subir un archivo si el guardado igual va a fallar.
    const textoOrden = document.getElementById('prod-orden').value.trim();
    const orden = textoOrden === '' ? null : Number(textoOrden);
    if (orden !== null && (!Number.isInteger(orden) || orden < 0)) {
      mostrarNotificacion('El orden tiene que ser un número entero (0 o más), o dejarlo vacío.', 'warning');
      return;
    }

    // Foto: si se eligió un archivo se sube; si no, se usa la dirección escrita.
    // Sin foto se guarda NULL (no texto vacío: la base lo rechaza).
    let imagen_url = null;
    const archivo = document.getElementById('prod-imagen-archivo').files[0];
    if (archivo) {
      imagen_url = await subirFoto(archivo);
      if (!imagen_url) return; // ya se avisó el error; el modal queda abierto
    } else {
      const texto = document.getElementById('prod-imagen-url').value.trim();
      if (texto && !urlHttp(texto)) {
        mostrarNotificacion('La dirección de la foto tiene que empezar con http:// o https://', 'warning');
        return;
      }
      imagen_url = texto || null;
    }

    const payload = { nombre, id_categoria, m_permite_docena, imagen_url, orden };
    let result = id 
      ? await supabaseAdmin.from('TB_BPRODUCTOS').update(payload).eq('id', id)
      : await supabaseAdmin.from('TB_BPRODUCTOS').insert([payload]);

    if (result.error) mostrarNotificacion('Error al guardar producto: ' + result.error.message, 'danger');
    else {
      $('#modal-producto').modal('hide');
      cargarProductos();
    }
  } finally {
    if (boton) boton.disabled = false;
  }
}

export async function eliminarProducto(id, nombre) {
  const ok = await confirmarAccion({
    titulo: 'Eliminar producto',
    mensaje: `¿Estás seguro de borrar "${nombre}"?`,
    textoConfirmar: 'Sí, eliminar',
    peligro: true
  });
  if (ok) {
    const { error } = await supabaseAdmin.from('TB_BPRODUCTOS').delete().eq('id', id);
    if (error) mostrarNotificacion('Error al eliminar: ' + error.message, 'danger');
    else cargarProductos();
  }
}
