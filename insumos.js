// =============================================================================
// insumos.js  ·  CATÁLOGO DE INSUMOS (muzzarella, cebolla, tapas, etc.)
// =============================================================================
//
// QUÉ HACE
//   Lista los insumos con filtros (por texto y por categoría) y permite
//   crearlos, editarlos y activarlos / desactivarlos.
//
// PARA QUÉ SIRVE EL CATÁLOGO
//   Cada compra a un proveedor va a tener un detalle de insumos (cuánto, a qué
//   precio). Tener los insumos ordenados y clasificados permite después ver,
//   por ejemplo, cuánto subió la muzzarella o cuánto se gasta en lácteos.
//
// REGLA DE LA BASE (script 05)
//   Una vez que un insumo se usó en una compra, no se puede cambiar su unidad
//   (pasar de KG a LT dejaría las cantidades viejas sin sentido). Esa regla la
//   hace cumplir la base de datos; acá solo mostramos el mensaje.
//
// CÓMO SE CONECTA: index.html (sec-insumos, modal-insumo), main.js, utils.js
// y config.js, igual que proveedores.js. Si algo de la sintaxis no se entiende,
// los conceptos básicos están explicados en los comentarios de proveedores.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, esc, mensajeErrorBD, confirmarAccion } from './utils.js';


// Lista de unidades de medida. IMPORTANTE: los códigos ('UN', 'KG', ...) tienen
// que ser exactamente los que acepta la base (restricción "check" de la tabla
// TB_BINSUMOS). Si algún día se agrega una unidad nueva, hay que agregarla
// en los dos lugares: acá y en la base.
// Es una lista [ ... ] de objetos { ... }: cada objeto tiene un "codigo" (lo que
// se guarda) y un "nombre" (lo que se muestra).
const UNIDADES = [
  { codigo: 'UN',   nombre: 'Unidad' },
  { codigo: 'KG',   nombre: 'Kilogramo' },
  { codigo: 'GR',   nombre: 'Gramo' },
  { codigo: 'LT',   nombre: 'Litro' },
  { codigo: 'ML',   nombre: 'Mililitro' },
  { codigo: 'DOC',  nombre: 'Docena' },
  { codigo: 'PAQ',  nombre: 'Paquete' },
  { codigo: 'CAJA', nombre: 'Caja' }
];

// Copias en memoria de lo que trajimos de la base (ver proveedores.js).
let insumosCache = [];
let categoriasCache = [];


// -----------------------------------------------------------------------------
// cargarInsumos
//   Trae categorías e insumos de la base, llena los desplegables y dibuja la tabla.
// -----------------------------------------------------------------------------
export async function cargarInsumos() {
  const tbody = document.getElementById('tabla-insumos-body');
  if (!tbody) return;

  // Promise.all lanza las dos consultas AL MISMO TIEMPO y espera a que terminen
  // las dos. Es más rápido que pedirlas una detrás de la otra.
  // El resultado es una lista con las dos respuestas, en el mismo orden;
  // las guardamos en dos constantes con la sintaxis [a, b] = ...
  const [resCategorias, resInsumos] = await Promise.all([
    supabaseAdmin
      .from('TB_BCATEGORIAS_INSUMO')
      .select('id, nombre, activo')
      .order('nombre', { ascending: true }),
    supabaseAdmin
      // "TB_BCATEGORIAS_INSUMO ( nombre )" trae además el nombre de la categoría
      // de cada insumo, porque las tablas están relacionadas (clave foránea).
      .from('TB_BINSUMOS')
      .select('id, nombre, unidad_medida, activo, id_categoria_insumo, TB_BCATEGORIAS_INSUMO ( nombre )')
      .order('nombre', { ascending: true })
  ]);

  // Si cualquiera de las dos falló, mostramos el error y paramos.
  // "||" acá significa "o": usamos el primer error que exista.
  const errorCarga = resCategorias.error || resInsumos.error;
  if (errorCarga) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${esc(mensajeErrorBD(errorCarga))}</td></tr>`;
    return;
  }

  categoriasCache = resCategorias.data || [];
  insumosCache = resInsumos.data || [];

  llenarSelects();
  renderizarInsumos();
}


// -----------------------------------------------------------------------------
// llenarSelects  (interna)
//   Completa los desplegables: categorías (en el filtro y en el modal) y unidades.
// -----------------------------------------------------------------------------
function llenarSelects() {
  // Armamos una sola vez el texto HTML de las opciones de categoría.
  // Las categorías inactivas se marcan para que se note.
  const opcionesCategorias = categoriasCache
    .map(c => `<option value="${c.id}">${esc(c.nombre)}${c.activo ? '' : ' (inactiva)'}</option>`)
    .join('');

  // Desplegable del modal (crear / editar).
  const selModal = document.getElementById('insumo-categoria');
  if (selModal) {
    selModal.innerHTML = '<option value="">-- Seleccionar Categoría --</option>' + opcionesCategorias;
  }

  // Desplegable del filtro de la tabla. Antes de rehacerlo guardamos qué estaba
  // elegido y después lo volvemos a elegir, para no perder el filtro del usuario.
  const selFiltro = document.getElementById('filtro-insumo-categoria');
  if (selFiltro) {
    const valorElegido = selFiltro.value;
    selFiltro.innerHTML = '<option value="">Todas las categorías</option>' + opcionesCategorias;
    selFiltro.value = valorElegido;
  }

  // Desplegable de unidades, armado desde la lista UNIDADES de arriba.
  const selUnidad = document.getElementById('insumo-unidad');
  if (selUnidad) {
    selUnidad.innerHTML = UNIDADES
      .map(u => `<option value="${u.codigo}">${esc(u.nombre)} (${u.codigo})</option>`)
      .join('');
  }
}


// Devuelve el nombre legible de una unidad a partir de su código.
// Ejemplo: nombreUnidad('KG') -> 'Kilogramo'.
// El "?." evita un error si no se encuentra; si no hay coincidencia
// devolvemos el código tal cual (con "||").
function nombreUnidad(codigo) {
  return UNIDADES.find(u => u.codigo === codigo)?.nombre || codigo;
}


// -----------------------------------------------------------------------------
// renderizarInsumos
//   Dibuja la tabla aplicando los filtros. NO consulta a la base: trabaja con
//   insumosCache. main.js la llama cada vez que el usuario escribe en el buscador
//   o cambia la categoría del filtro (por eso lleva "export").
// -----------------------------------------------------------------------------
export function renderizarInsumos() {
  const tbody = document.getElementById('tabla-insumos-body');
  if (!tbody) return;

  // Leemos los filtros. "?.value || ''" = si el campo no existe, usá ''.
  // toLowerCase() pasa a minúsculas para que "Mozza" encuentre "muzzarella" sin
  // importar mayúsculas (se compara todo en minúsculas).
  const texto = (document.getElementById('filtro-insumo')?.value || '').trim().toLowerCase();
  const idCategoria = document.getElementById('filtro-insumo-categoria')?.value || '';

  // .filter() recorre la lista y se queda SOLO con los elementos para los que la
  // función devuelve true. Un insumo pasa el filtro si coincide con el texto
  // (.includes: "contiene este trozo de texto") Y con la categoría.
  // "&&" significa "y". "===" compara que sean exactamente iguales.
  // String(...) convierte el id numérico a texto, porque el valor del
  // desplegable siempre es texto.
  const filtrados = insumosCache.filter(i => {
    const coincideTexto = i.nombre.toLowerCase().includes(texto);
    const coincideCategoria = idCategoria === '' || String(i.id_categoria_insumo) === idCategoria;
    return coincideTexto && coincideCategoria;
  });

  if (insumosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No hay insumos cargados todavía.</td></tr>`;
    return;
  }
  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">Ningún insumo coincide con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(i => `
    <tr class="${i.activo ? '' : 'text-muted'}">
      <td><span class="badge badge-secondary">#${i.id}</span></td>
      <td><span class="badge badge-info">${i.TB_BCATEGORIAS_INSUMO ? esc(i.TB_BCATEGORIAS_INSUMO.nombre) : 'Sin categoría'}</span></td>
      <td class="font-weight-bold">${esc(i.nombre)}</td>
      <td>${esc(nombreUnidad(i.unidad_medida))} <small class="text-muted">(${esc(i.unidad_medida)})</small></td>
      <td class="text-center">
        ${i.activo
          ? '<span class="badge badge-success">Activo</span>'
          : '<span class="badge badge-secondary">Inactivo</span>'}
      </td>
      <td class="text-center">
        <button class="btn btn-accion btn-accion-editar mr-1" title="Editar"
                data-action="editar-insumo" data-id="${i.id}">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-accion ${i.activo ? 'btn-accion-peligro' : 'btn-accion-ok'}"
                title="${i.activo ? 'Desactivar' : 'Activar'}"
                data-action="cambiar-estado-insumo" data-id="${i.id}">
          <i class="fas ${i.activo ? 'fa-ban' : 'fa-check'}"></i> ${i.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('');
}


// -----------------------------------------------------------------------------
// abrirModalNuevoInsumo / abrirModalEditarInsumo
//   Abren la ventana del formulario vacía (nuevo) o con los datos (editar).
// -----------------------------------------------------------------------------
export function abrirModalNuevoInsumo() {
  document.getElementById('insumo-id').value = '';
  document.getElementById('form-insumo').reset();
  document.getElementById('modal-insumo-title').innerText = 'Nuevo Insumo';
  $('#modal-insumo').modal('show');
}

export function abrirModalEditarInsumo(id) {
  const insumo = insumosCache.find(i => i.id === id);
  if (!insumo) return;

  document.getElementById('insumo-id').value = insumo.id;
  document.getElementById('insumo-nombre').value = insumo.nombre;
  // "?? ''": si la categoría fuera null, dejamos el desplegable en "Seleccionar".
  document.getElementById('insumo-categoria').value = insumo.id_categoria_insumo ?? '';
  document.getElementById('insumo-unidad').value = insumo.unidad_medida;
  document.getElementById('modal-insumo-title').innerText = 'Editar Insumo';
  $('#modal-insumo').modal('show');
}


// -----------------------------------------------------------------------------
// guardarInsumo
//   Crea o actualiza un insumo al enviar el formulario del modal.
// -----------------------------------------------------------------------------
export async function guardarInsumo(event) {
  event.preventDefault();

  const id = document.getElementById('insumo-id').value;
  const nombre = document.getElementById('insumo-nombre').value.trim();
  const idCategoria = document.getElementById('insumo-categoria').value;
  const unidad = document.getElementById('insumo-unidad').value;

  if (nombre.length < 2) {
    mostrarNotificacion('El nombre es obligatorio (mínimo 2 letras).', 'warning');
    return;
  }
  if (idCategoria === '') {
    mostrarNotificacion('Elegí una categoría.', 'warning');
    return;
  }

  // Number(...) convierte el texto del desplegable ("3") en número (3).
  const datos = {
    nombre,
    id_categoria_insumo: Number(idCategoria),
    unidad_medida: unidad
  };

  const resultado = id
    ? await supabaseAdmin.from('TB_BINSUMOS').update(datos).eq('id', id)
    : await supabaseAdmin.from('TB_BINSUMOS').insert([datos]);

  if (resultado.error) {
    // Si la base rechazó el cambio de unidad (insumo ya usado en compras),
    // mensajeErrorBD ya sabe traducir ese caso.
    mostrarNotificacion(mensajeErrorBD(resultado.error, 'insumo'), 'danger');
    return;
  }

  $('#modal-insumo').modal('hide');
  mostrarNotificacion(id ? 'Insumo actualizado.' : 'Insumo creado.');
  await cargarInsumos();
}


// -----------------------------------------------------------------------------
// cambiarEstadoInsumo
//   Activa o desactiva un insumo (baja lógica, igual que los proveedores).
// -----------------------------------------------------------------------------
export async function cambiarEstadoInsumo(id) {
  const insumo = insumosCache.find(i => i.id === id);
  if (!insumo) return;

  const nuevoEstado = !insumo.activo;

  if (!nuevoEstado && !(await confirmarAccion({
    titulo: 'Desactivar insumo',
    mensaje: `¿Desactivar "${insumo.nombre}"? No podrá elegirse en compras nuevas (el historial se conserva).`,
    textoConfirmar: 'Sí, desactivar',
    peligro: true
  }))) {
    return;
  }

  const { error } = await supabaseAdmin
    .from('TB_BINSUMOS')
    .update({ activo: nuevoEstado })
    .eq('id', id);

  if (error) {
    mostrarNotificacion(mensajeErrorBD(error, 'insumo'), 'danger');
    return;
  }

  mostrarNotificacion(nuevoEstado ? 'Insumo activado.' : 'Insumo desactivado.');
  await cargarInsumos();
}
