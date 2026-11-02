// =============================================================================
// usuarios.js  ·  PANTALLA "USUARIOS" (solo el Dueño): asignar el rol de cada usuario
// =============================================================================
//
// QUÉ HACE
//   Lista los usuarios que existen en el sistema con su rol, y permite al Dueño
//   cambiarlo (Empleado, Encargado, Dueño) o quitarlo (el usuario queda sin acceso).
//
// DE DÓNDE SALEN LOS DATOS Y QUIÉN LO PROTEGE
//   Todo pasa por dos funciones de la base (script 37): listar_usuarios y asignar_rol.
//   Ambas verifican que quien las usa sea Dueño: aunque alguien viera esta pantalla,
//   la base rechaza el cambio. La pantalla solo es la comodidad.
//
// CREAR USUARIOS
//   No se hace acá: se crean en Supabase (Authentication > Users > Add user, con
//   "Auto Confirm User"). Después aparecen en esta lista como "Sin rol".
//
// CÓMO SE CONECTA: index.html (sec-usuarios), main.js, utils.js y config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, confirmarAccion, esc, mensajeErrorFuncion } from './utils.js';

const NOMBRE_ROL = { EMPLEADO: 'Empleado', ENCARGADO: 'Encargado', DUENO: 'Dueño' };

// Copia en memoria de la última lista (para buscar un usuario por su id).
let usuariosCache = [];
// Id del usuario que tiene la sesión abierta (no puede cambiarse el rol a sí mismo).
let miId = null;


// Fecha y hora en horario de Argentina. Devuelve '—' si no hay dato.
function formatearFechaHora(valor) {
  if (!valor) return '—';
  return new Date(valor).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}


// -----------------------------------------------------------------------------
// cargarUsuarios
//   Trae la lista de la base y dibuja la tabla. Se llama al entrar a la pantalla.
// -----------------------------------------------------------------------------
export async function cargarUsuarios() {
  const tbody = document.getElementById('tabla-usuarios-body');
  if (!tbody) return;

  // Quién soy yo: sirve para bloquear mi propia fila.
  try {
    const { data } = await supabaseAdmin.auth.getSession();
    miId = data?.session?.user?.id || null;
  } catch (err) {
    miId = null;
  }

  const { data, error } = await supabaseAdmin.rpc('listar_usuarios');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">${esc(mensajeErrorFuncion(error, 'usuarios'))}</td></tr>`;
    return;
  }

  usuariosCache = data || [];
  renderizarUsuarios();
}


// -----------------------------------------------------------------------------
// renderizarUsuarios  (interna)
//   Dibuja la tabla a partir de usuariosCache. No consulta a la base.
// -----------------------------------------------------------------------------
function renderizarUsuarios() {
  const tbody = document.getElementById('tabla-usuarios-body');
  if (!tbody) return;

  if (usuariosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay usuarios.</td></tr>`;
    return;
  }

  tbody.innerHTML = usuariosCache.map(u => {
    const esYo = u.id_usuario === miId;
    const rol = u.rol || '';
    const opciones = [
      ['', 'Sin rol (no puede ingresar)'],
      ['EMPLEADO', 'Empleado'],
      ['ENCARGADO', 'Encargado'],
      ['DUENO', 'Dueño']
    ].map(([valor, texto]) => `<option value="${valor}"${valor === rol ? ' selected' : ''}>${texto}</option>`).join('');

    return `
    <tr class="${rol ? '' : 'table-warning'}">
      <td class="font-weight-bold">
        ${esc(u.email || '(sin email)')}
        ${esYo ? '<span class="badge badge-dark ml-1">Vos</span>' : ''}
      </td>
      <td style="min-width: 240px;">
        <select class="form-control form-control-sm" data-id="${esc(u.id_usuario)}" data-anterior="${esc(rol)}"
                ${esYo ? 'disabled title="No podés cambiar tu propio rol"' : ''}>
          ${opciones}
        </select>
      </td>
      <td class="small text-muted">${formatearFechaHora(u.creado)}</td>
      <td class="small text-muted">${formatearFechaHora(u.ultimo_ingreso)}</td>
      <td class="text-center">
        ${rol
          ? `<span class="badge badge-success">${esc(NOMBRE_ROL[rol] || rol)}</span>`
          : '<span class="badge badge-warning">Sin rol</span>'}
      </td>
    </tr>`;
  }).join('');
}


// -----------------------------------------------------------------------------
// cambiarRolUsuario
//   Se ejecuta cuando el Dueño elige otro rol en el desplegable de una fila.
//   Recibe: select -> el <select> que cambió (lleva data-id y data-anterior).
// -----------------------------------------------------------------------------
export async function cambiarRolUsuario(select) {
  const idUsuario = select.dataset.id;
  const anterior = select.dataset.anterior || '';
  const nuevo = select.value;
  if (nuevo === anterior) return;

  const usuario = usuariosCache.find(u => u.id_usuario === idUsuario);
  const email = usuario?.email || 'este usuario';
  const nombreAnterior = anterior ? NOMBRE_ROL[anterior] : 'Sin rol';
  const nombreNuevo = nuevo ? NOMBRE_ROL[nuevo] : 'Sin rol';

  let aviso = '';
  if (nuevo === 'DUENO') {
    aviso = ' Va a poder hacer TODO, incluso administrar usuarios y roles.';
  } else if (nuevo === '') {
    aviso = ' Ya no va a poder usar el sistema.';
  }

  const ok = await confirmarAccion({
    titulo: 'Cambiar rol',
    mensaje: `¿Cambiar el rol de ${email} de ${nombreAnterior} a ${nombreNuevo}?${aviso} ` +
             'El cambio vale ya mismo; su menú se actualiza cuando vuelva a ingresar.',
    textoConfirmar: 'Sí, cambiar',
    peligro: nuevo === 'DUENO' || nuevo === ''
  });
  if (!ok) {
    select.value = anterior;   // vuelve a mostrar el rol que tenía
    return;
  }

  select.disabled = true;
  const { error } = await supabaseAdmin.rpc('asignar_rol', {
    p_id_usuario: idUsuario,
    p_rol: nuevo === '' ? null : nuevo
  });

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'usuario'), 'danger');
    select.value = anterior;
    select.disabled = false;
    return;
  }

  mostrarNotificacion(nuevo ? `${email}: ahora es ${nombreNuevo}.` : `${email}: se le quitó el rol.`);
  await cargarUsuarios();
}
