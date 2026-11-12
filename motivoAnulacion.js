// =============================================================================
// motivoAnulacion.js  ·  VENTANA "ANULAR PEDIDO" (pide el motivo antes de anular)
// =============================================================================
//
// QUÉ HACE
//   Al tocar "Anular pedido" (menú "Más" del listado) se abre esta ventana: hay que elegir un
//   motivo de una lista corta, con BOTONES GRANDES (pensados para tocar con el dedo en una tablet).
//   Si el motivo es "Otro" aparece un cuadro para una aclaración (opcional).
//   Sirve también de confirmación: hasta ahora anular no preguntaba nada.
//   La base vuelve a validar el motivo (cambiar_estado_pedido, script 48): esto es solo la parte
//   visual.
//
// IDEA CLAVE: PROMESA (la misma de confirmarAccion en utils.js)
//   pedirMotivoAnulacion(id) devuelve una promesa. Quien la llama espera con "await" y recibe:
//     { motivo, detalle }  -> la persona eligió y confirmó
//     null                 -> cerró la ventana sin confirmar (Cancelar, la X o Esc)
//   Así esta ventana no sabe nada de pedidos.js (evitamos dependencias circulares).
//
// CÓMO SE CONECTA: pedidos.js la llama desde cambiarEstadoPedido; historialPedido.js usa la
// lista ETIQUETA_MOTIVO para mostrar el motivo. La ventana se crea sola por código.
// =============================================================================

import { esc } from './utils.js';

// Códigos (los mismos que acepta la base) y cómo se muestran. El orden es el de la pantalla.
// "icono" es de Font Awesome; "ancho: 'completo'" ocupa toda la fila (el resto va de a dos por fila).
export const MOTIVOS_ANULACION = [
  { codigo: 'ERROR_CARGA',          texto: 'Error de carga',               icono: 'fa-exclamation-triangle' },
  { codigo: 'CLIENTE_PIDIO_CAMBIO', texto: 'El cliente pidió un cambio',   icono: 'fa-sync-alt' },
  { codigo: 'CLIENTE_CANCELO',      texto: 'El cliente canceló',           icono: 'fa-user-times' },
  { codigo: 'NO_SE_PUDO_PREPARAR',  texto: 'No se pudo preparar',          icono: 'fa-ban' },
  { codigo: 'OTRO',                 texto: 'Otro',                         icono: 'fa-ellipsis-h', ancho: 'completo' }
];

// { ERROR_CARGA: 'Error de carga', ... } para buscar el texto por código.
export const ETIQUETA_MOTIVO = Object.fromEntries(MOTIVOS_ANULACION.map(m => [m.codigo, m.texto]));

const ID_MODAL = 'modal-motivo-anulacion';

export function pedirMotivoAnulacion(idPedido) {
  return new Promise((resolve) => {
    // Por si quedó una ventana de una vez anterior.
    document.getElementById(ID_MODAL)?.remove();

    // Si se cierra sin confirmar, se devuelve null.
    let resultado = null;

    const modal = document.createElement('div');
    modal.id = ID_MODAL;
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-backdrop', 'static');   // no se cierra al tocar afuera
    modal.style.zIndex = 1070;                       // por encima de cualquier otra ventana abierta
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered" role="document" style="max-width: 440px;">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title font-weight-bold">
              <i class="fas fa-ban text-danger mr-2"></i>Anular pedido #${esc(idPedido)}
            </h5>
          </div>
          <div class="modal-body">
            <p class="mb-2">¿Por qué se anula el pedido?</p>
            <!-- Botones grandes en vez de casillas: se tocan fácil con el dedo. Uno solo queda elegido (como una casilla de opción). -->
            <div class="row mx-n1" id="motivo-anul-lista" role="radiogroup" aria-label="Motivo de la anulación">
              ${MOTIVOS_ANULACION.map(m => `
              <div class="${m.ancho === 'completo' ? 'col-12' : 'col-6'} px-1 mb-2">
                <button type="button" id="motivo-anul-${m.codigo}" data-motivo="${m.codigo}" role="radio" aria-checked="false"
                        class="btn btn-outline-secondary btn-block motivo-anul-btn d-flex flex-column align-items-center justify-content-center"
                        style="min-height: 72px; white-space: normal; line-height: 1.2;">
                  <i class="fas ${m.icono} mb-1" style="font-size: 1.35rem;" aria-hidden="true"></i>
                  <span>${esc(m.texto)}</span>
                </button>
              </div>`).join('')}
            </div>
            <div class="small text-danger d-none mt-1" id="motivo-anul-error">Elegí un motivo para continuar.</div>
            <div class="form-group mt-3 mb-0 d-none" id="motivo-anul-grupo-detalle">
              <label for="motivo-anul-detalle" class="small text-muted mb-1">Aclaración (opcional)</label>
              <textarea class="form-control" id="motivo-anul-detalle" rows="3" maxlength="200" style="font-size: 16px;" placeholder="Si querés, contá qué pasó..."></textarea>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-light btn-lg px-4" data-dismiss="modal">Volver</button>
            <button type="button" class="btn btn-danger btn-lg font-weight-bold px-4" id="motivo-anul-aceptar">Anular pedido</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const lista = document.getElementById('motivo-anul-lista');
    const error = document.getElementById('motivo-anul-error');
    const grupoDetalle = document.getElementById('motivo-anul-grupo-detalle');
    let motivoElegido = null;   // código del botón tocado
    const eleccion = () => motivoElegido;

    // Al tocar un motivo: queda marcado (el anterior se desmarca), se saca el aviso de error y, solo con "Otro",
    // aparece la aclaración.
    lista.addEventListener('click', (e) => {
      const btn = e.target.closest('.motivo-anul-btn');
      if (!btn) return;
      motivoElegido = btn.dataset.motivo;
      lista.querySelectorAll('.motivo-anul-btn').forEach(b => {
        const activo = b === btn;
        b.classList.toggle('btn-danger', activo);
        b.classList.toggle('btn-outline-secondary', !activo);
        b.setAttribute('aria-checked', String(activo));
      });
      error.classList.add('d-none');
      grupoDetalle.classList.toggle('d-none', motivoElegido !== 'OTRO');
      if (motivoElegido === 'OTRO') document.getElementById('motivo-anul-detalle').focus();
    });

    document.getElementById('motivo-anul-aceptar').addEventListener('click', () => {
      const motivo = eleccion();
      if (!motivo) {                       // sin motivo no se puede continuar
        error.classList.remove('d-none');
        return;
      }
      // La aclaración solo cuenta con "Otro" (la base también la ignora con los demás).
      const detalle = motivo === 'OTRO'
        ? document.getElementById('motivo-anul-detalle').value.trim()
        : '';
      resultado = { motivo, detalle };
      $(modal).modal('hide');
    });

    $(modal).on('shown.bs.modal', () => {
      // Bootstrap 4 pone el fondo oscuro de la segunda ventana debajo de la primera: lo subimos.
      $('.modal-backdrop').last().css('z-index', 1065);
    });

    $(modal).on('hidden.bs.modal', () => {
      modal.remove();
      // Si había otra ventana abierta debajo, Bootstrap le sacó el bloqueo de scroll: se lo devolvemos.
      if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
      resolve(resultado);                  // acá se entrega la respuesta a quien esperaba
    });

    $(modal).modal('show');
  });
}
