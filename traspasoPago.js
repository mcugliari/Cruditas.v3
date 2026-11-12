// =============================================================================
// traspasoPago.js  ·  VENTANA "TRASPASAR PAGO" (elegir el pedido que recibe el pago)
// =============================================================================
//
// QUÉ HACE
//   Cuando se anula un pedido que ya estaba pagado y el cliente quiere otro pedido, la plata se pasa del
//   pedido anulado al nuevo (en vez de devolverla). Esta ventana lista los pedidos abiertos que todavía
//   tienen saldo, deja elegir uno y muestra qué va a pasar antes de confirmar:
//     - cuánto se traspasa (lo menor entre lo que hay a devolver y lo que le falta pagar al nuevo),
//     - cuánto queda a devolver en el viejo (si el nuevo cuesta menos),
//     - cuánto falta cobrar del nuevo (si cuesta más).
//   El traspaso lo hace la base (traspasar_pago_pedido, script 51); esto es solo la parte visual.
//
// IDEA CLAVE: PROMESA (la misma de motivoAnulacion.js)
//   elegirPedidoDestino({ idOrigen, aDevolver }) devuelve una promesa:
//     id del pedido elegido (número)  -> la persona eligió y confirmó
//     null                            -> cerró la ventana sin confirmar
//
//   elegirQueHacerConElPago({ idOrigen, aDevolver }) es la pregunta que se hace apenas se anula un pedido pagado
//   (y desde el menú del pedido anulado): ¿qué se hace con la plata? Devuelve, también como promesa:
//     'NUEVO'     -> cargar un pedido nuevo en el POS con este pago (opción B)
//     'TRASPASAR' -> pasar el pago a un pedido que ya está cargado (opción A)
//     'DEVOLVER'  -> devolver la plata ahora
//     null        -> resolverlo después (queda en Pendientes)
//
// CÓMO SE CONECTA: pedidos.js la llama desde traspasarPago. La ventana se crea sola por código.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { esc, mostrarNotificacion, mensajeErrorBD } from './utils.js';

const ID_MODAL = 'modal-traspaso-pago';

const ETIQUETA_ESTADO = { EN_PREPARACION: '⏳ En preparación', LISTO: '🔔 Listo', ENTREGADO: '📦 Entregado' };
const pesos = (n) => `$${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('es-AR')}`;

// Pedidos abiertos con saldo por cobrar (los que pueden recibir el pago). Devuelve [] si no hay.
async function traerCandidatos(idOrigen) {
  const { data: saldos, error } = await supabaseAdmin
    .from('VW_PEDIDO_SALDO')
    .select('id_pedido, saldo, estado')
    .in('estado', ['EN_PREPARACION', 'LISTO', 'ENTREGADO'])
    .gt('saldo', 0)
    .order('id_pedido', { ascending: false })
    .limit(100);
  if (error) throw error;

  const ids = (saldos || []).map(s => s.id_pedido).filter(id => Number(id) !== Number(idOrigen));
  if (ids.length === 0) return [];

  const { data: pedidos, error: errPed } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('id, fecha, estado, importe_total, nombre_referencia, TB_BCLIENTES(nombre)')
    .in('id', ids)
    .order('id', { ascending: false });
  if (errPed) throw errPed;

  const saldoPorId = Object.fromEntries(saldos.map(s => [s.id_pedido, Number(s.saldo)]));
  return (pedidos || []).map(p => ({ ...p, saldo: saldoPorId[p.id] }));
}

export async function elegirPedidoDestino({ idOrigen, aDevolver }) {
  let candidatos;
  try {
    candidatos = await traerCandidatos(idOrigen);
  } catch (e) {
    mostrarNotificacion(mensajeErrorBD(e), 'danger');
    return null;
  }

  return new Promise((resolve) => {
    document.getElementById(ID_MODAL)?.remove();
    let resultado = null;   // si se cierra sin confirmar
    let elegido = null;     // pedido elegido en la lista

    const modal = document.createElement('div');
    modal.id = ID_MODAL;
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-backdrop', 'static');
    modal.style.zIndex = 1070;
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" role="document" style="max-width: 520px;">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title font-weight-bold"><i class="fas fa-exchange-alt text-primary mr-2"></i>Traspasar pago del pedido #${esc(idOrigen)}</h5>
          </div>
          <div class="modal-body">
            <p class="mb-2">Hay <strong>${esc(pesos(aDevolver))}</strong> pagados en el pedido anulado.
               Elegí el pedido <strong>nuevo</strong> que recibe ese pago:</p>
            <input type="search" class="form-control mb-2" style="font-size: 16px;" id="traspaso-buscar" placeholder="Buscar por número o nombre…" autocomplete="off">
            <div id="traspaso-lista" class="list-group" style="max-height: 280px; overflow-y: auto;"></div>
            <div id="traspaso-resumen" class="alert alert-info small mt-3 mb-0 d-none"></div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-light btn-lg px-4" data-dismiss="modal">Cancelar</button>
            <button type="button" class="btn btn-primary btn-lg font-weight-bold px-4" id="traspaso-aceptar" disabled>
              <i class="fas fa-exchange-alt mr-1"></i> Traspasar pago
            </button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const lista = modal.querySelector('#traspaso-lista');
    const resumen = modal.querySelector('#traspaso-resumen');
    const botonAceptar = modal.querySelector('#traspaso-aceptar');

    function dibujarLista() {
      const texto = modal.querySelector('#traspaso-buscar').value.trim().toLowerCase();
      const visibles = candidatos.filter(p => {
        if (!texto) return true;
        const nombre = `${p.nombre_referencia || ''} ${p.TB_BCLIENTES?.nombre || ''}`.toLowerCase();
        return String(p.id).includes(texto.replace('#', '')) || nombre.includes(texto);
      });
      if (candidatos.length === 0) {
        lista.innerHTML = '<div class="text-muted small p-3">No hay pedidos abiertos con saldo para recibir el pago. Cargá primero el pedido nuevo en el POS y volvé a intentar.</div>';
        return;
      }
      if (visibles.length === 0) {
        lista.innerHTML = '<div class="text-muted small p-3">Ningún pedido coincide con la búsqueda.</div>';
        return;
      }
      lista.innerHTML = visibles.map(p => `
        <button type="button" class="list-group-item list-group-item-action py-3 ${elegido === p.id ? 'active' : ''}" data-id="${p.id}">
          <div class="d-flex justify-content-between">
            <strong>#${p.id} · ${esc(p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final')}</strong>
            <span>${esc(pesos(p.importe_total))}</span>
          </div>
          <small>${esc(ETIQUETA_ESTADO[p.estado] || p.estado)} · falta pagar ${esc(pesos(p.saldo))}</small>
        </button>`).join('');
    }

    function dibujarResumen() {
      const p = candidatos.find(c => c.id === elegido);
      if (!p) { resumen.classList.add('d-none'); botonAceptar.disabled = true; return; }
      const monto = Math.min(Number(aDevolver), Number(p.saldo));
      const sobra = Math.round((Number(aDevolver) - monto) * 100) / 100;
      const falta = Math.round((Number(p.saldo) - monto) * 100) / 100;
      resumen.innerHTML = `Se traspasan <strong>${esc(pesos(monto))}</strong> al pedido #${p.id}.`
        + (sobra > 0 ? `<br>Quedan <strong>${esc(pesos(sobra))}</strong> a devolver en el pedido #${esc(idOrigen)}.` : '')
        + (falta > 0 ? `<br>Al pedido #${p.id} le faltan cobrar <strong>${esc(pesos(falta))}</strong>.` : '')
        + (sobra === 0 && falta === 0 ? '<br>El pedido nuevo queda pagado por completo.' : '');
      resumen.classList.remove('d-none');
      botonAceptar.disabled = false;
    }

    lista.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      elegido = Number(btn.dataset.id);
      dibujarLista();
      dibujarResumen();
    });
    modal.querySelector('#traspaso-buscar').addEventListener('input', dibujarLista);
    botonAceptar.addEventListener('click', () => {
      if (!elegido) return;
      resultado = elegido;
      $(modal).modal('hide');
    });

    dibujarLista();

    $(modal).on('shown.bs.modal', () => {
      $('.modal-backdrop').last().css('z-index', 1065);   // el fondo oscuro de la segunda ventana, por encima de la primera
      modal.querySelector('#traspaso-buscar')?.focus();
    });
    $(modal).on('hidden.bs.modal', () => {
      modal.remove();
      if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
      resolve(resultado);
    });
    $(modal).modal('show');
  });
}


// -----------------------------------------------------------------------------
// elegirQueHacerConElPago: pregunta qué hacer con la plata de un pedido anulado.
// -----------------------------------------------------------------------------
const ID_MODAL_ELEGIR = 'modal-que-hacer-con-el-pago';

export function elegirQueHacerConElPago({ idOrigen, aDevolver }) {
  return new Promise((resolve) => {
    document.getElementById(ID_MODAL_ELEGIR)?.remove();
    let resultado = null;   // si se cierra sin elegir: se resuelve después

    const modal = document.createElement('div');
    modal.id = ID_MODAL_ELEGIR;
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-backdrop', 'static');
    modal.style.zIndex = 1070;
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered" role="document" style="max-width: 460px;">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title font-weight-bold"><i class="fas fa-hand-holding-usd text-primary mr-2"></i>¿Qué hacemos con el pago?</h5>
          </div>
          <div class="modal-body">
            <p class="mb-3">El pedido #${esc(idOrigen)} tenía <strong>${esc(pesos(aDevolver))}</strong> pagados.</p>
            <div class="list-group">
              <button type="button" class="list-group-item list-group-item-action py-3" data-opcion="NUEVO">
                <strong><i class="fas fa-plus-circle mr-2 text-success"></i>Cargar un pedido nuevo con este pago</strong>
                <div class="small text-muted">Abre el POS con los productos del pedido para cambiarlos. Al guardar, el pago pasa al nuevo.</div>
              </button>
              <button type="button" class="list-group-item list-group-item-action py-3" data-opcion="TRASPASAR">
                <strong><i class="fas fa-exchange-alt mr-2 text-primary"></i>Pasarlo a un pedido que ya cargué</strong>
                <div class="small text-muted">Elegís el pedido de una lista.</div>
              </button>
              <button type="button" class="list-group-item list-group-item-action py-3" data-opcion="DEVOLVER">
                <strong><i class="fas fa-undo mr-2 text-danger"></i>Devolver la plata ahora</strong>
                <div class="small text-muted">Por efectivo del cajón o desde una cuenta.</div>
              </button>
            </div>
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-light btn-lg px-4" data-opcion="DESPUES">Resolverlo después</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-opcion]');
      if (!btn) return;
      resultado = btn.dataset.opcion === 'DESPUES' ? null : btn.dataset.opcion;
      $(modal).modal('hide');
    });
    $(modal).on('shown.bs.modal', () => {
      $('.modal-backdrop').last().css('z-index', 1065);
    });
    $(modal).on('hidden.bs.modal', () => {
      modal.remove();
      if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
      resolve(resultado);
    });
    $(modal).modal('show');
  });
}
