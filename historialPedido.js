// =============================================================================
// historialPedido.js  ·  VENTANA "HISTORIAL DEL PEDIDO" (quién cambió el estado y cuándo)
// =============================================================================
//
// QUÉ HACE
//   Desde el menú "Más" de un pedido (pedidos.js) se abre esta ventana con la línea de tiempo
//   de ESE pedido: cuándo se creó, y cada cambio de estado con fecha, hora y usuario.
//   Los datos salen de la función de la base pedido_historial (scripts 47 y 48), que solo
//   responde a Encargado y Dueño y devuelve el email de cada usuario.
//   Cada fila es un cambio de estado (con el motivo, si fue una anulación) o una edición del
//   pedido (con el total antes y después).
//
// CÓMO SE CONECTA
//   - La ventana (modal) se crea sola por código la primera vez que se usa: no hace falta
//     tocar index.html.
//   - pedidos.js la llama con verHistorialPedido(idPedido).
//   - Solo LEE la base: no cambia nada.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { esc, mostrarNotificacion, mensajeErrorFuncion, formatearPesos } from './utils.js';
import { ETIQUETA_MOTIVO } from './motivoAnulacion.js';   // texto de cada motivo de anulación

const ID_MODAL = 'modal-historial-pedido';

// Cómo se muestra cada estado (mismos textos que el listado de pedidos).
const ETIQUETA_ESTADO = {
  PREPARACION: '⏳ En Preparación',
  PREPARADO: '🔔 Preparado',
  ENTREGADO_IMPAGO: '📦 Entregado (Impago)',
  COMPLETADO: '✅ Completado',
  ANULADO: '🚫 Anulado'
};

// Número de la última consulta: si se abre otro pedido antes de que llegue la respuesta
// del anterior, la respuesta vieja se descarta (no pisa la pantalla).
let numeroConsulta = 0;

// Crea la ventana la primera vez (después ya existe en la página y se reutiliza).
function asegurarModal() {
  if (document.getElementById(ID_MODAL)) return;
  const modal = document.createElement('div');
  modal.className = 'modal fade';
  modal.id = ID_MODAL;
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title"><i class="fas fa-history mr-2"></i><span id="historial-pedido-titulo">Historial del pedido</span></h5>
          <button type="button" class="close" data-dismiss="modal" aria-label="Cerrar"><span aria-hidden="true">&times;</span></button>
        </div>
        <div class="modal-body" id="historial-pedido-cuerpo"></div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Cerrar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

// Fecha y hora SIEMPRE en hora de Argentina, aunque el equipo tenga mal la zona.
function fechaHora(iso) {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }) + ' hs';
}

// Quién hizo el cambio. Un alta sin usuario es un pedido hecho por el cliente desde el formulario web.
function textoUsuario(fila) {
  if (fila.r_email) return esc(fila.r_email);
  if (!fila.r_estado_anterior) return 'Cliente (web)';
  return '<span class="text-muted">Sin dato</span>';
}

function textoEstado(estado) {
  return esc(ETIQUETA_ESTADO[estado] || estado || '');
}

// Texto de la columna "Cambio" según el tipo de fila.
function textoCambio(f) {
  // Edición del pedido: el estado no cambia; se muestra el total antes y después.
  if (f.r_evento === 'EDICION') {
    const antes = Number(f.r_importe_anterior), despues = Number(f.r_importe_nuevo);
    const total = antes === despues
      ? `total sin cambios (${esc(formatearPesos(despues))})`
      : `total ${esc(formatearPesos(antes))} <i class="fas fa-arrow-right mx-1 text-muted"></i> ${esc(formatearPesos(despues))}`;
    return `✏️ <strong>Pedido editado</strong> <span class="text-muted">(${textoEstado(f.r_estado_nuevo)})</span><br><small>${total}</small>`;
  }

  // Cambio de estado.
  let html = f.r_estado_anterior
    ? `${textoEstado(f.r_estado_anterior)} <i class="fas fa-arrow-right mx-1 text-muted"></i> ${textoEstado(f.r_estado_nuevo)}`
    : `<span class="text-muted">Pedido creado</span> <i class="fas fa-arrow-right mx-1 text-muted"></i> ${textoEstado(f.r_estado_nuevo)}`;

  // Anulación: el motivo y, si eligió "Otro", la aclaración. Las anulaciones anteriores al
  // script 48 no tienen motivo.
  if (f.r_estado_nuevo === 'ANULADO') {
    const motivo = f.r_motivo
      ? `Motivo: ${esc(ETIQUETA_MOTIVO[f.r_motivo] || f.r_motivo)}${f.r_detalle ? ` — ${esc(f.r_detalle)}` : ''}`
      : '<span class="text-muted">Sin motivo registrado</span>';
    html += `<br><small>${motivo}</small>`;
  }
  return html;
}

// -----------------------------------------------------------------------------
// verHistorialPedido: abre la ventana y carga la línea de tiempo del pedido.
// -----------------------------------------------------------------------------
export async function verHistorialPedido(idPedido) {
  asegurarModal();
  const consulta = ++numeroConsulta;
  const cuerpo = document.getElementById('historial-pedido-cuerpo');

  document.getElementById('historial-pedido-titulo').textContent = `Historial del pedido #${idPedido}`;
  cuerpo.innerHTML = '<p class="text-muted text-center my-4"><i class="fas fa-spinner fa-spin mr-1"></i> Cargando…</p>';
  $('#' + ID_MODAL).modal('show');

  const { data, error } = await supabaseAdmin.rpc('pedido_historial', { p_id_pedido: idPedido });
  if (consulta !== numeroConsulta) return;   // se abrió otro pedido mientras tanto

  if (error) {
    cuerpo.innerHTML = '<p class="text-danger text-center my-4">No se pudo cargar el historial.</p>';
    mostrarNotificacion(mensajeErrorFuncion(error, 'historial'), 'danger');
    return;
  }

  const filas = data || [];
  if (filas.length === 0) {
    cuerpo.innerHTML = `<p class="text-muted text-center my-4">Este pedido no tiene historial
      (es anterior a que se empezara a registrar).</p>`;
    return;
  }

  // Una fila por cambio, de la más vieja a la más nueva (así viene de la base).
  const htmlFilas = filas.map(f => `
    <tr>
      <td class="text-nowrap">${esc(fechaHora(f.r_fecha))}</td>
      <td>${textoCambio(f)}</td>
      <td>${textoUsuario(f)}</td>
    </tr>`).join('');

  cuerpo.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-striped mb-2">
        <thead><tr><th>Fecha y hora</th><th>Cambio de estado</th><th>Usuario</th></tr></thead>
        <tbody>${htmlFilas}</tbody>
      </table>
    </div>
    <p class="small text-muted mb-0">Se registran los cambios de estado y cada vez que se guardan cambios en el pedido.</p>`;
}
