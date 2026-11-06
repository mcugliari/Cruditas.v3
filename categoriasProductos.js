// =============================================================================
// categoriasProductos.js  ·  ADMINISTRACIÓN DE LAS CATEGORÍAS DE PRODUCTOS
// =============================================================================
//
// QUÉ HACE
//   Ventana "Categorías de productos" (#modal-categorias-producto), que se abre con el botón
//   "Categorías" de la pantalla Gestión de Productos. Trabaja sobre TB_BCATEGORIAS
//   (Empanada, Canastita, Pizza simple...). Permite:
//     - crear una categoría nueva,
//     - cambiar su nombre,
//     - cambiar su GRUPO (el que arma las pestañas de la toma de pedidos), y
//     - cambiar su GRUPO PARA EL RECUENTO DE CAJA (script 46): si se deja vacío se usa el grupo de
//       las pestañas; las categorías con el mismo grupo de recuento se suman en el cierre de caja.
//   NO borra categorías: tienen productos y pedidos detrás (y no tienen "activo"). Las categorías
//   internas del sistema (Bonificación, id 99 / grupo SISTEMA) no se muestran ni se tocan.
//
// CÓMO SE CONECTA
//   - Se engancha sola (delegación de eventos) con #btn-categorias-productos, #form-categoria-producto, etc.
//   - productos.js la importa y le pasa, con registrarAlCambiarCategoriasProductos, la función que
//     refresca esa pantalla. Así este archivo NO importa a productos.js (evita la dependencia circular).
//   - Al guardar actualiza el caché de categorías (state.js) que usan el select de productos y el POS.
//
// REQUIERE el script 46 (columna grupo_caja). Quien escribe en TB_BCATEGORIAS: solo el Dueño.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { setCacheCategorias } from './state.js';
import { mostrarNotificacion, esc, mensajeErrorBD } from './utils.js';

// Todas las categorías de la última carga (incluidas las del sistema, que se necesitan para el caché).
let categorias = [];
// Función que refresca la pantalla de Productos (la registra productos.js).
let alCambiar = null;

export function registrarAlCambiarCategoriasProductos(funcion) {
  alCambiar = funcion;
}

// Categorías internas del sistema: no se muestran ni se editan (mismo criterio que productos.js).
function esCategoriaSistema(cat) {
  if (!cat) return false;
  return Number(cat.id) === 99 || String(cat.grupo || '').trim().toUpperCase() === 'SISTEMA';
}

// Compara nombres sin tildes ni mayúsculas: "Pizza" y "pizza " son la misma.
function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Los grupos se guardan en mayúsculas y con un solo espacio entre palabras (como los que ya existen),
// para que "Empanadas" y "EMPANADAS " no se vean como dos grupos distintos.
function normalizarGrupo(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// -----------------------------------------------------------------------------
// validarCategoria  (interna, sin pantalla: se puede probar sola)
//   Controla lo escrito en el formulario.
//   Recibe: datos -> { id, nombre, grupo, grupoCaja } (textos tal como se escribieron)
//           existentes -> lista de categorías ya cargadas
//   Devuelve { error } con un texto para mostrar, o { payload } listo para guardar:
//           { nombre, grupo, grupo_caja }  (grupo_caja = null si se dejó vacío)
// -----------------------------------------------------------------------------
export function validarCategoria(datos, existentes) {
  const nombre = String(datos.nombre || '').trim().replace(/\s+/g, ' ');
  const grupo = normalizarGrupo(datos.grupo);
  const grupoCaja = normalizarGrupo(datos.grupoCaja);

  if (nombre.length < 2) return { error: 'El nombre es obligatorio (mínimo 2 letras).' };
  if (nombre.length > 80) return { error: 'El nombre es demasiado largo (máximo 80 letras).' };
  if (grupo === '') return { error: 'Indicá el grupo de las pestañas del pedido (por ejemplo, el de una categoría parecida).' };
  if (grupo.length > 50 || grupoCaja.length > 50) return { error: 'Los grupos pueden tener hasta 50 letras.' };
  if (grupo === 'SISTEMA' || grupoCaja === 'SISTEMA') return { error: '"SISTEMA" es un grupo interno: elegí otro nombre.' };

  const repetida = (existentes || []).some(c =>
    String(c.id) !== String(datos.id || '') && normalizar(c.nombre) === normalizar(nombre));
  if (repetida) return { error: 'Ya existe una categoría con ese nombre.' };

  return { payload: { nombre, grupo, grupo_caja: grupoCaja === '' ? null : grupoCaja } };
}

// Deja el formulario en modo "nueva categoría".
function prepararFormulario() {
  document.getElementById('catprod-id').value = '';
  document.getElementById('catprod-nombre').value = '';
  document.getElementById('catprod-grupo').value = '';
  document.getElementById('catprod-grupo-caja').value = '';
  document.getElementById('catprod-label').innerText = 'Nueva categoría';
  document.getElementById('btn-guardar-catprod').innerText = 'Agregar';
  document.getElementById('catprod-cancelar-wrap').classList.add('d-none');
}

// Sugerencias de grupo (lista desplegable del campo): los que ya existen, así no se escriben dos veces distinto.
function llenarSugerenciasGrupos() {
  const visibles = categorias.filter(c => !esCategoriaSistema(c));
  const grupos = new Set();
  visibles.forEach(c => {
    if (c.grupo) grupos.add(normalizarGrupo(c.grupo));
    if (c.grupo_caja) grupos.add(normalizarGrupo(c.grupo_caja));
  });
  document.getElementById('catprod-sugerencias').innerHTML =
    [...grupos].sort().map(g => `<option value="${esc(g)}"></option>`).join('');
}

async function cargarCategoriasProducto() {
  const tbody = document.getElementById('tabla-catprod-body');

  const { data, error } = await supabaseAdmin
    .from('TB_BCATEGORIAS')
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-danger text-center">${esc(mensajeErrorBD(error, 'categoría'))}</td></tr>`;
    return false;
  }

  categorias = data || [];
  // El caché lo usan el select de productos y el POS (necesitan TODAS, incluida la del sistema).
  setCacheCategorias(categorias);
  llenarSugerenciasGrupos();

  const visibles = categorias.filter(c => !esCategoriaSistema(c));
  if (visibles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Todavía no hay categorías.</td></tr>';
    return true;
  }

  tbody.innerHTML = visibles.map(c => {
    const grupo = c.grupo ? esc(normalizarGrupo(c.grupo)) : '<span class="text-muted">—</span>';
    const grupoCaja = c.grupo_caja
      ? `<span class="badge badge-warning">${esc(normalizarGrupo(c.grupo_caja))}</span>`
      : `<span class="text-muted small">igual que las pestañas</span>`;
    return `
      <tr>
        <td class="font-weight-bold">${esc(c.nombre)}</td>
        <td>${grupo}</td>
        <td>${grupoCaja}</td>
        <td class="text-center">
          <button type="button" class="btn btn-accion btn-accion-editar" title="Editar"
                  data-catprod="editar" data-id="${c.id}"><i class="fas fa-edit"></i> Editar</button>
        </td>
      </tr>`;
  }).join('');
  return true;
}

async function abrirModalCategoriasProducto() {
  prepararFormulario();
  await cargarCategoriasProducto();
  $('#modal-categorias-producto').modal('show');
}

function editarCategoriaProducto(id) {
  const cat = categorias.find(c => Number(c.id) === Number(id));
  if (!cat || esCategoriaSistema(cat)) return;
  document.getElementById('catprod-id').value = cat.id;
  document.getElementById('catprod-nombre').value = cat.nombre || '';
  document.getElementById('catprod-grupo').value = cat.grupo ? normalizarGrupo(cat.grupo) : '';
  document.getElementById('catprod-grupo-caja').value = cat.grupo_caja ? normalizarGrupo(cat.grupo_caja) : '';
  document.getElementById('catprod-label').innerText = 'Editar categoría';
  document.getElementById('btn-guardar-catprod').innerText = 'Guardar';
  document.getElementById('catprod-cancelar-wrap').classList.remove('d-none');
  document.getElementById('catprod-nombre').focus();
}

async function guardarCategoriaProducto(event) {
  event.preventDefault();
  const id = document.getElementById('catprod-id').value;
  const boton = document.getElementById('btn-guardar-catprod');

  const r = validarCategoria({
    id,
    nombre: document.getElementById('catprod-nombre').value,
    grupo: document.getElementById('catprod-grupo').value,
    grupoCaja: document.getElementById('catprod-grupo-caja').value
  }, categorias);
  if (r.error) {
    mostrarNotificacion(r.error, 'warning');
    return;
  }

  boton.disabled = true;   // evita un doble clic que cree la categoría dos veces
  try {
    const resultado = id
      ? await supabaseAdmin.from('TB_BCATEGORIAS').update(r.payload).eq('id', id)
      : await supabaseAdmin.from('TB_BCATEGORIAS').insert([r.payload]);

    if (resultado.error) {
      mostrarNotificacion(mensajeErrorBD(resultado.error, 'categoría'), 'danger');
      return;
    }

    mostrarNotificacion(id ? 'Categoría actualizada.' : 'Categoría creada.');
    prepararFormulario();
    await cargarCategoriasProducto();
    if (alCambiar) await alCambiar();   // la pantalla de Productos refleja el cambio (select y tabla)
  } finally {
    boton.disabled = false;
  }
}

// -----------------------------------------------------------------------------
// Enganche de eventos (delegación sobre document: no depende de cuándo se dibujó cada elemento)
// -----------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-categorias-productos')) {
    abrirModalCategoriasProducto();
    return;
  }
  if (e.target.closest('#btn-cancelar-edicion-catprod')) {
    prepararFormulario();
    return;
  }
  const editar = e.target.closest('[data-catprod="editar"]');
  if (editar) editarCategoriaProducto(editar.dataset.id);
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-categoria-producto') guardarCategoriaProducto(e);
});
