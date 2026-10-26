// =============================================================================
// categorias.js  ·  ADMINISTRACIÓN DE CATEGORÍAS DE INSUMOS Y DE GASTOS
// =============================================================================
//
// QUÉ HACE
//   Una sola ventana (#modal-categorias) sirve para dos tablas:
//     'insumo' -> TB_BCATEGORIAS_INSUMO   (se abre desde la pantalla Insumos)
//     'egreso' -> TB_BCATEGORIAS_EGRESO   (se abre desde la pantalla Gastos y Retiros)
//   Permite agregar, renombrar y activar / desactivar categorías. No se borran:
//   se desactivan, así el historial (insumos y gastos ya cargados) no se rompe.
//
// CÓMO SE CONECTA
//   Se engancha sola con los botones que tienen data-categorias="insumo" o
//   data-categorias="egreso" (index.html). Solo hace falta importarla una vez en
//   main.js:   import './categorias.js';
// =============================================================================

import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, esc, mensajeErrorBD, confirmarAccion } from './utils.js';
import { cargarInsumos } from './insumos.js';
import { cargarEgresos } from './egresos.js';

const TIPOS = {
  insumo: { tabla: 'TB_BCATEGORIAS_INSUMO', titulo: 'Categorías de insumos', refrescar: () => cargarInsumos() },
  egreso: { tabla: 'TB_BCATEGORIAS_EGRESO', titulo: 'Categorías de gastos',  refrescar: () => cargarEgresos() }
};

let tipoActual = null;
let categoriasCache = [];

// Compara nombres sin tildes ni mayúsculas: "Lácteos" y "lacteos" son la misma.
function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

async function abrirModalCategorias(tipo) {
  if (!TIPOS[tipo]) return;
  tipoActual = tipo;
  document.getElementById('modal-categorias-title').innerText = TIPOS[tipo].titulo;
  prepararFormulario();
  await cargarCategorias();
  $('#modal-categorias').modal('show');
}

// Deja el formulario en modo "agregar" (vacío).
function prepararFormulario() {
  document.getElementById('categoria-adm-id').value = '';
  document.getElementById('categoria-adm-nombre').value = '';
  document.getElementById('categoria-adm-label').innerText = 'Nueva categoría';
  document.getElementById('btn-guardar-categoria').innerText = 'Agregar';
  document.getElementById('categoria-adm-cancelar-wrap').classList.add('d-none');
}

async function cargarCategorias() {
  const tbody = document.getElementById('tabla-categorias-adm-body');
  const { data, error } = await supabaseAdmin
    .from(TIPOS[tipoActual].tabla)
    .select('id, nombre, activo')
    .order('nombre', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-danger text-center">${esc(mensajeErrorBD(error, 'categoría'))}</td></tr>`;
    return;
  }

  categoriasCache = data || [];

  if (categoriasCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3">Todavía no hay categorías.</td></tr>`;
    return;
  }

  tbody.innerHTML = categoriasCache.map(c => `
    <tr class="${c.activo ? '' : 'text-muted'}">
      <td class="font-weight-bold">${esc(c.nombre)}</td>
      <td class="text-center">
        ${c.activo
          ? '<span class="badge badge-success">Activa</span>'
          : '<span class="badge badge-secondary">Inactiva</span>'}
      </td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-warning mr-1" title="Renombrar"
                data-cat-adm="editar" data-id="${c.id}"><i class="fas fa-edit"></i></button>
        <button type="button" class="btn btn-sm ${c.activo ? 'btn-outline-danger' : 'btn-outline-success'}"
                title="${c.activo ? 'Desactivar' : 'Activar'}"
                data-cat-adm="estado" data-id="${c.id}"><i class="fas ${c.activo ? 'fa-ban' : 'fa-check'}"></i></button>
      </td>
    </tr>
  `).join('');
}

function editarCategoria(id) {
  const cat = categoriasCache.find(c => c.id === id);
  if (!cat) return;
  document.getElementById('categoria-adm-id').value = cat.id;
  document.getElementById('categoria-adm-nombre').value = cat.nombre;
  document.getElementById('categoria-adm-label').innerText = 'Renombrar categoría';
  document.getElementById('btn-guardar-categoria').innerText = 'Guardar';
  document.getElementById('categoria-adm-cancelar-wrap').classList.remove('d-none');
  document.getElementById('categoria-adm-nombre').focus();
}

async function guardarCategoria(event) {
  event.preventDefault();
  const id = document.getElementById('categoria-adm-id').value;
  const nombre = document.getElementById('categoria-adm-nombre').value.trim();

  if (nombre.length < 2) {
    mostrarNotificacion('El nombre es obligatorio (mínimo 2 letras).', 'warning');
    return;
  }
  // Evita duplicados (sin importar tildes ni mayúsculas), salvo la propia categoría al renombrar.
  const repetida = categoriasCache.some(c => String(c.id) !== id && normalizar(c.nombre) === normalizar(nombre));
  if (repetida) {
    mostrarNotificacion('Ya existe una categoría con ese nombre.', 'warning');
    return;
  }

  const { tabla, refrescar } = TIPOS[tipoActual];
  const resultado = id
    ? await supabaseAdmin.from(tabla).update({ nombre }).eq('id', id)
    : await supabaseAdmin.from(tabla).insert([{ nombre, activo: true }]);

  if (resultado.error) {
    mostrarNotificacion(mensajeErrorBD(resultado.error, 'categoría'), 'danger');
    return;
  }

  mostrarNotificacion(id ? 'Categoría actualizada.' : 'Categoría creada.');
  prepararFormulario();
  await cargarCategorias();
  await refrescar();   // la pantalla de fondo refleja el cambio (filtros, selects y tabla)
}

async function cambiarEstadoCategoria(id) {
  const cat = categoriasCache.find(c => c.id === id);
  if (!cat) return;
  const nuevoEstado = !cat.activo;

  if (!nuevoEstado && !(await confirmarAccion({
    titulo: 'Desactivar categoría',
    mensaje: `¿Desactivar "${cat.nombre}"? Dejará de ofrecerse al cargar datos nuevos (lo ya cargado se conserva).`,
    textoConfirmar: 'Sí, desactivar',
    peligro: true
  }))) {
    return;
  }

  const { tabla, refrescar } = TIPOS[tipoActual];
  const { error } = await supabaseAdmin.from(tabla).update({ activo: nuevoEstado }).eq('id', id);
  if (error) {
    mostrarNotificacion(mensajeErrorBD(error, 'categoría'), 'danger');
    return;
  }

  mostrarNotificacion(nuevoEstado ? 'Categoría activada.' : 'Categoría desactivada.');
  await cargarCategorias();
  await refrescar();
}

// -----------------------------------------------------------------------------
// Enganche de eventos (delegación sobre document: no depende de cuándo se dibujó cada elemento)
// -----------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  const abrir = e.target.closest('[data-categorias]');
  if (abrir) {
    abrirModalCategorias(abrir.dataset.categorias);
    return;
  }
  if (e.target.closest('#btn-cancelar-edicion-categoria')) {
    prepararFormulario();
    return;
  }
  const accion = e.target.closest('[data-cat-adm]');
  if (accion) {
    const id = Number(accion.dataset.id);
    if (accion.dataset.catAdm === 'editar') editarCategoria(id);
    else if (accion.dataset.catAdm === 'estado') cambiarEstadoCategoria(id);
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'form-categoria') guardarCategoria(e);
});
