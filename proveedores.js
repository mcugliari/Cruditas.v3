// =============================================================================
// proveedores.js  ·  ALTA, EDICIÓN Y BAJA LÓGICA DE PROVEEDORES
// =============================================================================
//
// QUÉ HACE
//   Muestra la lista de proveedores y permite crearlos, editarlos y
//   activarlos / desactivarlos.
//
// BAJA LÓGICA (importante)
//   Un proveedor NO se borra: se "desactiva". Si ya tiene compras, borrarlo
//   dejaría esas compras sin dueño. Un proveedor inactivo se sigue viendo en el
//   historial, pero ya no se puede elegir para compras nuevas.
//
// CÓMO SE CONECTA
//   - index.html : la sección "sec-proveedores" y el modal "modal-proveedor".
//   - main.js    : conecta los botones con las funciones exportadas de acá.
//   - utils.js   : de ahí salen mostrarNotificacion, esc y mensajeErrorBD.
//   - config.js  : la conexión a Supabase.
//
// Es el mismo patrón que clientes.js y productos.js, con tres mejoras:
//   1) los textos pasan por esc() antes de mostrarse (seguridad),
//   2) los botones de la tabla solo llevan el id (no copian todos los datos),
//   3) se desactiva en lugar de borrar.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, esc, mensajeErrorBD, confirmarAccion } from './utils.js';


// "Caché" = una copia en memoria de la lista que acabamos de traer de la base.
// La usamos para buscar un proveedor por su id sin volver a consultar a Supabase.
// Es "let" porque se reemplaza cada vez que se recarga la lista.
let proveedoresCache = [];


// -----------------------------------------------------------------------------
// cargarProveedores
//   Trae los proveedores de la base y dibuja la tabla.
//   Se llama al entrar a la pantalla y después de cada cambio.
// -----------------------------------------------------------------------------
// "export" = disponible para otros archivos (main.js la importa).
// "async" = la función espera respuestas lentas con "await".
export async function cargarProveedores() {
  const tbody = document.getElementById('tabla-proveedores-body');
  // Si la pantalla no está en la página, no hay nada que hacer.
  if (!tbody) return;

  // Consulta a Supabase, leída como una frase:
  //   "de la tabla TB_BPROVEEDORES, seleccioná estas columnas,
  //    ordenadas por nombre de la A a la Z".
  // La respuesta es un objeto { data, error }. La desestructuración
  // "{ data, error }" saca esas dos partes; "data: lista" además renombra
  // "data" como "lista" para que el código sea más claro.
  const { data: lista, error } = await supabaseAdmin
    .from('TB_BPROVEEDORES')
    .select('id, nombre, telefono, cuit, activo')
    .order('nombre', { ascending: true });

  if (error) {
    // Un colSpan="6" hace que la celda ocupe las 6 columnas de la tabla.
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${esc(mensajeErrorBD(error))}</td></tr>`;
    return;
  }

  // Si "lista" viniera vacía o nula, usamos [] (una lista vacía) para que
  // el resto del código no falle.
  proveedoresCache = lista || [];
  renderizarProveedores();
}


// -----------------------------------------------------------------------------
// renderizarProveedores  (función interna: no lleva "export")
//   Dibuja la tabla a partir de proveedoresCache. No consulta a la base.
// -----------------------------------------------------------------------------
function renderizarProveedores() {
  const tbody = document.getElementById('tabla-proveedores-body');
  if (!tbody) return;

  if (proveedoresCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">No hay proveedores cargados todavía.</td></tr>`;
    return;
  }

  // .map() recorre la lista y transforma CADA proveedor en un trozo de HTML
  // (una fila de la tabla). .join('') pega todos los trozos en un solo texto.
  // "p" representa al proveedor de turno.
  tbody.innerHTML = proveedoresCache.map(p => `
    <tr class="${p.activo ? '' : 'text-muted'}">
      <td><span class="badge badge-secondary">#${p.id}</span></td>
      <td class="font-weight-bold">${esc(p.nombre)}</td>
      <td>${esc(p.telefono) || '-'}</td>
      <td>${esc(p.cuit) || '-'}</td>
      <td class="text-center">
        ${p.activo
          ? '<span class="badge badge-success">Activo</span>'
          : '<span class="badge badge-secondary">Inactivo</span>'}
      </td>
      <td class="text-center">
        <button class="btn btn-accion btn-accion-editar mr-1" title="Editar"
                data-action="editar-proveedor" data-id="${p.id}">
          <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-accion ${p.activo ? 'btn-accion-peligro' : 'btn-accion-ok'}"
                title="${p.activo ? 'Desactivar' : 'Activar'}"
                data-action="cambiar-estado-proveedor" data-id="${p.id}">
          <i class="fas ${p.activo ? 'fa-ban' : 'fa-check'}"></i> ${p.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('');

  // ---- Detalles de sintaxis usados arriba ----
  // ${ ... }            inserta el resultado de una expresión dentro del texto.
  // condición ? A : B   "operador ternario": si la condición es verdadera da A,
  //                     si no, B. Es un if/else escrito en una sola línea.
  // esc(p.telefono) || '-'
  //                     esc() devuelve '' si no hay teléfono; como '' cuenta
  //                     como "falso", el || lo reemplaza por un guion.
  // data-id="${p.id}"   guarda el id dentro del botón. main.js lo lee después
  //                     con btn.dataset.id para saber sobre qué proveedor se hizo clic.
}


// -----------------------------------------------------------------------------
// abrirModalNuevoProveedor
//   Abre la ventana (modal) con el formulario vacío.
// -----------------------------------------------------------------------------
export function abrirModalNuevoProveedor() {
  // El campo oculto "prov-id" distingue crear (vacío) de editar (con id).
  document.getElementById('prov-id').value = '';
  // reset() deja el formulario en blanco.
  document.getElementById('form-proveedor').reset();
  // innerText cambia el texto visible del título.
  document.getElementById('modal-proveedor-title').innerText = 'Nuevo Proveedor';
  // "$" es jQuery (ya cargado en index.html). .modal('show') abre la ventana.
  $('#modal-proveedor').modal('show');
}


// -----------------------------------------------------------------------------
// abrirModalEditarProveedor
//   Abre el modal con los datos del proveedor elegido.
//   Recibe: id -> número del proveedor.
// -----------------------------------------------------------------------------
export function abrirModalEditarProveedor(id) {
  // .find() recorre la lista y devuelve el PRIMER elemento que cumple la
  // condición (acá, el que tiene ese id), o undefined si no hay ninguno.
  const prov = proveedoresCache.find(p => p.id === id);
  if (!prov) return;

  document.getElementById('prov-id').value = prov.id;
  document.getElementById('prov-nombre').value = prov.nombre;
  // "|| ''": si el dato es null, dejamos el campo vacío en lugar de escribir "null".
  document.getElementById('prov-telefono').value = prov.telefono || '';
  document.getElementById('prov-cuit').value = prov.cuit || '';
  document.getElementById('modal-proveedor-title').innerText = 'Editar Proveedor';
  $('#modal-proveedor').modal('show');
}


// -----------------------------------------------------------------------------
// guardarProveedor
//   Se ejecuta al enviar el formulario del modal: crea o actualiza.
//   Recibe: event -> información del evento "submit" del formulario.
// -----------------------------------------------------------------------------
export async function guardarProveedor(event) {
  // Evita que el navegador recargue la página al enviar el formulario.
  event.preventDefault();

  const id = document.getElementById('prov-id').value;
  // .trim() quita los espacios del principio y del final.
  const nombre = document.getElementById('prov-nombre').value.trim();
  const telefono = document.getElementById('prov-telefono').value.trim();
  const cuit = document.getElementById('prov-cuit').value.trim();

  // Validación: el atributo "required" del HTML acepta un nombre de puros
  // espacios; por eso volvemos a controlar acá, ya sin los espacios.
  if (nombre.length < 2) {
    mostrarNotificacion('El nombre es obligatorio (mínimo 2 letras).', 'warning');
    return; // "return" corta la función: no se guarda nada.
  }

  // Si el teléfono o el CUIT están vacíos guardamos null (vacío real en la base)
  // en lugar de un texto vacío ''.
  const datos = { nombre, telefono: telefono || null, cuit: cuit || null };

  // Si hay id estamos EDITANDO (update ... donde id = ese), si no, CREANDO (insert).
  // Insert recibe una lista [ ... ] porque admite varias filas a la vez.
  const resultado = id
    ? await supabaseAdmin.from('TB_BPROVEEDORES').update(datos).eq('id', id)
    : await supabaseAdmin.from('TB_BPROVEEDORES').insert([datos]);

  if (resultado.error) {
    mostrarNotificacion(mensajeErrorBD(resultado.error, 'proveedor'), 'danger');
    return;
  }

  $('#modal-proveedor').modal('hide');
  mostrarNotificacion(id ? 'Proveedor actualizado.' : 'Proveedor creado.');
  await cargarProveedores(); // recarga la tabla para ver el cambio
}


// -----------------------------------------------------------------------------
// cambiarEstadoProveedor
//   Activa o desactiva un proveedor (baja lógica).
//   Recibe: id -> número del proveedor.
// -----------------------------------------------------------------------------
export async function cambiarEstadoProveedor(id) {
  const prov = proveedoresCache.find(p => p.id === id);
  if (!prov) return;

  // "!" invierte: si estaba activo (true) pasa a false, y viceversa.
  const nuevoEstado = !prov.activo;

  // Al DESACTIVAR pedimos confirmación con nuestra ventana propia (confirmarAccion, utils.js):
  // "await" espera la respuesta (true o false). "&&" significa "y": solo preguntamos si se está
  // desactivando; y si el usuario cancela, salimos sin cambiar nada.
  if (!nuevoEstado && !(await confirmarAccion({
    titulo: 'Desactivar proveedor',
    mensaje: `¿Desactivar a "${prov.nombre}"? No podrá elegirse en compras nuevas (el historial se conserva).`,
    textoConfirmar: 'Sí, desactivar',
    peligro: true
  }))) {
    return;
  }

  const { error } = await supabaseAdmin
    .from('TB_BPROVEEDORES')
    .update({ activo: nuevoEstado })
    .eq('id', id);

  if (error) {
    mostrarNotificacion(mensajeErrorBD(error, 'proveedor'), 'danger');
    return;
  }

  mostrarNotificacion(nuevoEstado ? 'Proveedor activado.' : 'Proveedor desactivado.');
  await cargarProveedores();
}
