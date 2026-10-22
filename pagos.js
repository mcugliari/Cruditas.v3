// =============================================================================
// pagos.js  ·  REGISTRAR PAGOS A PROVEEDORES Y ANULARLOS
// =============================================================================
//
// QUÉ HACE
//   Maneja UNA sola ventana de pago (modal-pago) que se usa desde dos lugares:
//     - Pagar una compra puntual            (modo 'compra')
//     - Pagar a cuenta a un proveedor       (modo 'proveedor'): el monto se reparte
//       solo entre sus compras pendientes, de la más antigua a la más nueva
//   Y también anula pagos.
//
// QUIÉN LO USA
//   - compras.js : botón "Registrar pago" y "Anular" dentro del detalle de una compra.
//   - deuda.js   : pantalla de deuda a proveedores.
//
// CÓMO SE GUARDA
//   Con funciones de la base (scripts 04 y 06): registrar_pago_compra,
//   registrar_pago_proveedor y anular_egreso. Ellas validan todo (saldo, día
//   cerrado, etc.) y guardan de forma completa o no guardan nada.
//
// IDEA CLAVE DE ESTE ARCHIVO: "CALLBACKS" (funciones que se pasan como dato)
//   Este módulo no sabe qué pantalla lo abrió, ni qué hay que refrescar cuando
//   termina. Para resolverlo, quien lo llama le pasa una FUNCIÓN ("alCerrar") y
//   este módulo la ejecuta al terminar. Una función que se entrega para que otro
//   la llame más tarde se llama "callback" ("llamada de vuelta").
//   Ventaja: pagos.js no necesita importar compras.js ni deuda.js. Si lo hiciera,
//   los archivos se importarían entre sí en círculo ("dependencia circular"),
//   que es una fuente típica de errores.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, mensajeErrorFuncion, formatearMoneda, llenarSelectCuentas
} from './utils.js';


// Contexto del pago que está abierto. Se completa en abrirModalPago:
//   { modo: 'compra' | 'proveedor',
//     id: número de la compra o del proveedor,
//     saldo: lo máximo que se puede pagar,
//     titulo, descripcion: textos para mostrar,
//     modalAnterior: selector de la ventana que hay que cerrar antes (o null),
//     alCerrar: función que se ejecuta cuando la ventana de pago se cierra }
let contexto = null;

// ¿El pago se guardó? alCerrar recibe este dato para saber si hay que refrescar.
let guardado = false;

// Medios y cuentas cargados al abrir la ventana. Los guardamos para saber, al elegir
// un medio, si es efectivo (es_efectivo) y entonces no hace falta pedir cuenta.
let mediosPago = [];
let cuentasPago = [];

// -----------------------------------------------------------------------------
// actualizarCuentaPago  (interna)
//   Muestra el desplegable de cuenta SOLO si el medio elegido no es efectivo.
//   (En efectivo la plata sale de la cuenta Efectivo; la base la pone sola.)
// -----------------------------------------------------------------------------
function actualizarCuentaPago() {
  const idMedio = document.getElementById('pago-medio').value;
  // .find() devuelve el primer elemento que cumple la condición (o undefined).
  const medio = mediosPago.find(m => String(m.id) === idMedio);
  // "!!" convierte a true/false: hay medio elegido Y no es efectivo.
  const pideCuenta = !!medio && !medio.es_efectivo;
  document.getElementById('pago-grupo-cuenta').classList.toggle('d-none', !pideCuenta);
}


// -----------------------------------------------------------------------------
// mostrarModalTrasCerrar  (interna)
//   Bootstrap 4 no maneja bien dos ventanas abiertas a la vez. Entonces, si hay
//   una ventana abierta, la cerramos, ESPERAMOS a que termine de cerrarse y
//   recién después abrimos la nueva.
//   Recibe: selectorAnterior -> ventana a cerrar (o null)
//           selectorNuevo    -> ventana a abrir
// -----------------------------------------------------------------------------
function mostrarModalTrasCerrar(selectorAnterior, selectorNuevo) {
  // "$" es jQuery. .hasClass('show') pregunta si la ventana está abierta.
  if (selectorAnterior && $(selectorAnterior).hasClass('show')) {
    // .one('hidden.bs.modal', función): "la PRÓXIMA vez que esta ventana termine
    // de cerrarse, ejecutá esta función (una sola vez)". Es otro callback.
    $(selectorAnterior).one('hidden.bs.modal', () => $(selectorNuevo).modal('show'));
    $(selectorAnterior).modal('hide');
  } else {
    $(selectorNuevo).modal('show');
  }
}


// -----------------------------------------------------------------------------
// abrirModalPago
//   Prepara y abre la ventana de pago.
//   Recibe: ctx -> un objeto con los datos del contexto (ver arriba).
// -----------------------------------------------------------------------------
export async function abrirModalPago(ctx) {
  // Medios de pago para el desplegable.
  const { data: medios, error } = await supabaseAdmin
    .from('TB_BMEDIO_PAGO')
    .select('id, nombre, es_efectivo')
    .order('id', { ascending: true });

  if (error) {
    mostrarNotificacion(mensajeErrorBD(error), 'danger');
    return;
  }

  // Cuentas activas (dónde está la plata) para los pagos que no son en efectivo.
  const { data: cuentas, error: errorCuentas } = await supabaseAdmin
    .from('TB_BCUENTAS')
    .select('id, nombre, tipo')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (errorCuentas) {
    mostrarNotificacion(mensajeErrorBD(errorCuentas), 'danger');
    return;
  }

  mediosPago = medios || [];
  cuentasPago = cuentas || [];

  contexto = ctx;
  guardado = false;

  document.getElementById('pago-titulo').innerText = ctx.titulo;
  document.getElementById('pago-info').innerHTML = ctx.descripcion;   // HTML armado por quien llama, ya con esc()

  document.getElementById('pago-medio').innerHTML =
    '<option value="">-- Seleccionar medio --</option>' +
    (medios || []).map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');

  // Cuenta: se llena una vez por apertura; el grupo queda oculto hasta elegir un medio no efectivo.
  llenarSelectCuentas(document.getElementById('pago-cuenta'), cuentasPago, null);
  // Usamos "onchange =" (propiedad) y no addEventListener: asignarla de nuevo en cada
  // apertura REEMPLAZA a la anterior, así los avisos no se acumulan.
  document.getElementById('pago-medio').onchange = () => actualizarCuentaPago();
  actualizarCuentaPago();

  // El monto propone pagar todo el saldo; el usuario puede bajarlo para un pago parcial.
  const inputMonto = document.getElementById('pago-monto');
  inputMonto.value = ctx.saldo;
  inputMonto.max = ctx.saldo;           // el navegador avisa si se pasa del saldo
  document.getElementById('pago-observaciones').value = '';

  document.getElementById('pago-ayuda').innerText = ctx.modo === 'proveedor'
    ? 'El monto se aplica primero a las compras que vencen antes (las que no tienen vencimiento, al final).'
    : 'El pago se registra con la fecha de hoy.';

  // Cuando la ventana de pago termine de cerrarse (se haya guardado o cancelado),
  // avisamos a quien nos llamó ejecutando su callback "alCerrar".
  // "?." significa "si existe, ejecutalo". Es un .one: se registra una vez por apertura.
  $('#modal-pago').one('hidden.bs.modal', async () => {
    if (contexto?.alCerrar) await contexto.alCerrar(guardado);
  });

  mostrarModalTrasCerrar(ctx.modalAnterior, '#modal-pago');
}


// -----------------------------------------------------------------------------
// guardarPago
//   Se ejecuta al enviar el formulario de pago.
// -----------------------------------------------------------------------------
export async function guardarPago(event) {
  event.preventDefault();
  if (!contexto) return;

  const boton = document.getElementById('btn-guardar-pago');
  const idMedio = document.getElementById('pago-medio').value;
  const monto = parseFloat(document.getElementById('pago-monto').value);
  const observaciones = document.getElementById('pago-observaciones').value.trim();
  const idCuentaElegida = document.getElementById('pago-cuenta').value;

  if (idMedio === '') {
    mostrarNotificacion('Elegí el medio de pago.', 'warning');
    return;
  }
  // Si el medio NO es efectivo, la cuenta es obligatoria en pantalla.
  const medioElegido = mediosPago.find(m => String(m.id) === idMedio);
  const esEfectivo = !!medioElegido?.es_efectivo;
  if (!esEfectivo && idCuentaElegida === '') {
    mostrarNotificacion('Elegí la cuenta desde la que se paga.', 'warning');
    return;
  }
  // En efectivo mandamos null: la base usa la cuenta Efectivo sola.
  const idCuenta = esEfectivo ? null : Number(idCuentaElegida);

  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('El monto debe ser mayor a cero.', 'warning');
    return;
  }
  // Este control es para avisar rápido; la base vuelve a validar el saldo.
  if (monto > Number(contexto.saldo) + 0.005) {
    mostrarNotificacion(`El monto supera lo que se debe ($${formatearMoneda(contexto.saldo)}).`, 'warning');
    return;
  }

  boton.disabled = true;
  try {
    // Según el modo se llama a una función distinta de la base.
    // Los nombres de los parámetros (p_...) deben coincidir con los de los scripts 04 y 06.
    let respuesta;
    if (contexto.modo === 'compra') {
      respuesta = await supabaseAdmin.rpc('registrar_pago_compra', {
        p_id_compra: contexto.id,
        p_id_cuenta: idCuenta,       // los parámetros van por nombre: el orden no importa
        p_id_medio_pago: Number(idMedio),
        p_monto: monto,
        p_observaciones: observaciones || null
      });
    } else {
      respuesta = await supabaseAdmin.rpc('registrar_pago_proveedor', {
        p_id_proveedor: contexto.id,
        p_id_cuenta: idCuenta,
        p_id_medio_pago: Number(idMedio),
        p_monto: monto,
        p_observaciones: observaciones || null
      });
    }

    const { data, error } = respuesta;
    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'pago'), 'danger');
      return;
    }

    // Mensaje de éxito según lo que devolvió la función.
    if (contexto.modo === 'compra') {
      mostrarNotificacion(`Pago registrado. Saldo de la compra: $${formatearMoneda(data.saldo)}.`);
    } else {
      const cantidad = (data.pagos || []).length;
      mostrarNotificacion(
        `Pago de $${formatearMoneda(data.aplicado)} aplicado a ${cantidad} compra${cantidad === 1 ? '' : 's'}. ` +
        `Deuda restante: $${formatearMoneda(data.deuda_restante)}.`
      );
    }

    // Marcamos que se guardó y cerramos. Al terminar de cerrarse se ejecuta
    // el callback alCerrar (registrado en abrirModalPago) con guardado = true.
    guardado = true;
    $('#modal-pago').modal('hide');

  } catch (err) {
    console.error('Error al registrar el pago:', err);
    mostrarNotificacion('No se pudo registrar el pago. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    boton.disabled = false;
  }
}


// -----------------------------------------------------------------------------
// anularPago
//   Anula un pago o, en general, cualquier egreso (pide un motivo). Si el día del
//   movimiento ya se cerró, la base lo rechaza.
//   Recibe: idEgreso   -> número del movimiento a anular
//           alTerminar -> callback que se ejecuta si se anuló (para refrescar la pantalla)
//           textos     -> (opcional) { motivo, ok }: textos propios para la pregunta
//                         y para el aviso de éxito. egresos.js los usa para gastos y retiros.
// -----------------------------------------------------------------------------
// "textos = {}" es un PARÁMETRO CON VALOR POR DEFECTO: si quien llama no pasa nada,
// textos vale {} (un objeto vacío) y se usan los textos de abajo.
export async function anularPago(idEgreso, alTerminar, textos = {}) {
  // prompt() pide un texto; devuelve null si el usuario cancela.
  // "textos.motivo || '...'" usa el texto recibido o, si no vino, el de siempre.
  const motivo = prompt(textos.motivo || 'Motivo de la anulación del pago (obligatorio):')?.trim();
  if (!motivo) {
    mostrarNotificacion('Se necesita un motivo para anular el pago.', 'warning');
    return;
  }

  const { error } = await supabaseAdmin.rpc('anular_egreso', {
    p_id: idEgreso,
    p_motivo: motivo
  });

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'pago'), 'danger');
    return;
  }

  mostrarNotificacion(textos.ok || 'Pago anulado. La compra volvió a tener ese saldo pendiente.');
  if (alTerminar) await alTerminar();
}
