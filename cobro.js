// =============================================================================
// cobro.js  ·  VENTANA DE COBRO (la usan el POS y el listado de pedidos)
// =============================================================================
//
// QUÉ HACE
//   Maneja UNA sola ventana (modal-cobro-pedido) para cobrar: muestra el total y
//   las unidades, deja elegir el medio de pago con botones, pide la cuenta si el
//   medio NO es efectivo y, en efectivo, calcula el vuelto ("Paga con $").
//   El "Paga con $" es solo una ayuda en pantalla: NO se guarda en la base.
//
// IDEA CLAVE: CALLBACK (la misma que en pagos.js)
//   Esta ventana no sabe QUÉ se está cobrando. Quien la abre le pasa una función
//   "alConfirmar(idMedio, idCuenta)" que hace el guardado y devuelve:
//     true  -> se guardó bien: la ventana se cierra
//     false -> falló: la ventana queda abierta para corregir
//   Así cobro.js no importa pos.js ni pedidos.js (evitamos dependencias circulares).
//
// CÓMO SE CONECTA: index.html (modal-cobro-pedido), main.js (eventos), pos.js y
// pedidos.js (la abren), utils.js y config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, formatearMoneda, llenarSelectCuentas
} from './utils.js';


// Datos de la ventana abierta: { total, unidades, alConfirmar, ... } (ver abrirModalCobro).
let contexto = null;
// Medios y cuentas traídos de la base (para saber si el medio elegido es efectivo).
let mediosCobro = [];
let cuentasCobro = [];
// Medio elegido en este momento (número).
let idMedioElegido = null;


// -----------------------------------------------------------------------------
// estiloMedio  (interna)
//   Decide el ícono (Font Awesome) y el "tipo" de cada botón de medio. El tipo
//   se usa como clase CSS (tipo-efectivo, tipo-qr...) para darle su color al ícono.
//   Se decide por es_efectivo y por palabras del nombre; si no reconoce nada,
//   queda como "otro" con una billetera.
//   Devuelve un objeto { icono, tipo }.
// -----------------------------------------------------------------------------
function estiloMedio(m) {
  const nombre = String(m.nombre || '').toLowerCase();
  if (m.es_efectivo) return { icono: 'fa-money-bill-wave', tipo: 'efectivo' };
  if (nombre.includes('transfer')) return { icono: 'fa-university', tipo: 'transferencia' };
  if (nombre.includes('tarjeta')) return { icono: 'fa-credit-card', tipo: 'tarjeta' };
  if (nombre.includes('qr') || nombre.includes('mercado')) return { icono: 'fa-qrcode', tipo: 'qr' };
  return { icono: 'fa-wallet', tipo: 'otro' };
}


// -----------------------------------------------------------------------------
// abrirModalCobro
//   Prepara y abre la ventana. Recibe un objeto "ctx":
//     titulo      -> texto del encabezado (opcional; por defecto "Cobrar y Entregar")
//     subtitulo   -> línea chica debajo del título
//     total       -> importe a cobrar (número)
//     unidades    -> cantidad de unidades (número)
//     alConfirmar -> async (idMedio, idCuenta) => true | false
// -----------------------------------------------------------------------------
export async function abrirModalCobro(ctx) {
  // Las dos consultas salen AL MISMO TIEMPO (Promise.all) y se espera a ambas.
  const [resMedios, resCuentas] = await Promise.all([
    supabaseAdmin.from('TB_BMEDIO_PAGO').select('id, nombre, es_efectivo').order('id', { ascending: true }),
    supabaseAdmin.from('TB_BCUENTAS').select('id, nombre, tipo').eq('activo', true).order('id', { ascending: true })
  ]);

  const errorCarga = resMedios.error || resCuentas.error;
  if (errorCarga) {
    mostrarNotificacion(mensajeErrorBD(errorCarga), 'danger');
    return;
  }

  mediosCobro = resMedios.data || [];
  cuentasCobro = resCuentas.data || [];
  if (mediosCobro.length === 0) {
    mostrarNotificacion('No hay medios de pago cargados.', 'warning');
    return;
  }

  contexto = ctx;

  // textContent escribe texto plano (no hace falta esc()).
  document.getElementById('cobro-titulo').textContent = ctx.titulo || 'Cobrar y Entregar';
  document.getElementById('cobro-subtitulo').textContent = ctx.subtitulo || '';
  document.getElementById('cobro-total').textContent = formatearMoneda(ctx.total);
  document.getElementById('cobro-unidades').textContent =
    `${ctx.unidades} unidad${Number(ctx.unidades) === 1 ? '' : 'es'}`;
  document.getElementById('cobro-paga-con').value = '';

  // Un botón por medio de pago. El nombre viene de la base, por eso pasa por esc().
  // "icono" y "tipo" salen de estiloMedio (textos fijos del código), no hace falta esc().
  document.getElementById('cobro-medios').innerHTML = mediosCobro.map(m => {
    const { icono, tipo } = estiloMedio(m);
    return `
    <button type="button" class="cobro-medio-btn tipo-${tipo}" data-id="${m.id}">
      <span class="cobro-medio-check"><i class="fas fa-check-circle"></i></span>
      <i class="fas ${icono}"></i>
      <span>${esc(m.nombre)}</span>
    </button>`;
  }).join('');

  // Arranca en efectivo (identificado por es_efectivo); si no hubiera, el primero.
  const porDefecto = mediosCobro.find(m => m.es_efectivo) || mediosCobro[0];
  seleccionarMedio(porDefecto.id);

  $('#modal-cobro-pedido').modal('show');
}


// -----------------------------------------------------------------------------
// seleccionarMedio  (interna)
//   Marca el botón elegido y muestra/oculta lo que depende del medio:
//     - efectivo   -> se muestra "Paga con $" (vuelto); la cuenta se oculta
//     - no efectivo -> se muestra la cuenta; "Paga con $" se oculta
// -----------------------------------------------------------------------------
function seleccionarMedio(idMedio) {
  idMedioElegido = Number(idMedio);

  // El botón elegido lleva la clase "activo" (el estilo está en styles.css).
  document.querySelectorAll('#cobro-medios [data-id]').forEach(btn => {
    btn.classList.toggle('activo', Number(btn.dataset.id) === idMedioElegido);
  });

  const medio = mediosCobro.find(m => Number(m.id) === idMedioElegido);
  const esEfectivo = !!medio?.es_efectivo;

  // Cuenta: solo si NO es efectivo (en efectivo la base usa la cuenta Efectivo sola).
  document.getElementById('cobro-grupo-cuenta').classList.toggle('d-none', esEfectivo);
  if (!esEfectivo) {
    llenarSelectCuentas(document.getElementById('cobro-cuenta'), cuentasCobro, null);
  }

  // "Paga con $": solo tiene sentido en efectivo.
  document.getElementById('cobro-grupo-efectivo').classList.toggle('d-none', !esEfectivo);
  actualizarVueltoCobro();
}


// -----------------------------------------------------------------------------
// elegirMedioCobro
//   Listener de clics sobre el contenedor de botones (main.js). Es "delegación de
//   eventos": un solo listener en el contenedor y e.target.closest() descubre
//   cuál botón se apretó (los botones se crean cada vez que se abre la ventana).
// -----------------------------------------------------------------------------
export function elegirMedioCobro(e) {
  const btn = e.target.closest('[data-id]');
  if (btn) seleccionarMedio(btn.dataset.id);
}


// -----------------------------------------------------------------------------
// actualizarVueltoCobro
//   Calcula en pantalla el vuelto (o lo que falta) según "Paga con $".
//   No guarda nada: es solo una ayuda para quien cobra.
// -----------------------------------------------------------------------------
export function actualizarVueltoCobro() {
  const salida = document.getElementById('cobro-vuelto');
  const pagaCon = parseFloat(document.getElementById('cobro-paga-con').value);

  if (!contexto || isNaN(pagaCon) || pagaCon <= 0) {
    salida.textContent = '';
    return;
  }

  const diferencia = pagaCon - Number(contexto.total);
  if (diferencia >= 0) {
    salida.textContent = `Vuelto: $${formatearMoneda(diferencia)}`;
    salida.className = 'small mt-1 font-weight-bold text-success';
  } else {
    salida.textContent = `Faltan $${formatearMoneda(-diferencia)}`;
    salida.className = 'small mt-1 font-weight-bold text-danger';
  }
}


// -----------------------------------------------------------------------------
// confirmarCobro
//   Se ejecuta al enviar el formulario (botón "Confirmar cobro"). Valida el medio y
//   la cuenta y llama al callback "alConfirmar" que dejó quien abrió la ventana.
// -----------------------------------------------------------------------------
export async function confirmarCobro(e) {
  e.preventDefault();
  if (!contexto) return;

  const medio = mediosCobro.find(m => Number(m.id) === idMedioElegido);
  if (!medio) {
    mostrarNotificacion('Elegí un medio de pago.', 'warning');
    return;
  }

  // Cuenta: obligatoria si el medio no es efectivo (la plata entra en ese momento).
  const pideCuenta = !medio.es_efectivo;
  const valorCuenta = document.getElementById('cobro-cuenta').value;
  const idCuenta = (pideCuenta && valorCuenta) ? Number(valorCuenta) : null;
  if (pideCuenta && !idCuenta) {
    mostrarNotificacion('Elegí a qué cuenta entra el cobro.', 'warning');
    return;
  }

  // Desactivamos el botón para evitar un doble clic que cobre dos veces.
  const boton = document.getElementById('btn-confirmar-cobro');
  boton.disabled = true;

  // try / finally: "finally" se ejecuta SIEMPRE al salir, así el botón nunca queda trabado.
  try {
    const guardado = await contexto.alConfirmar(Number(medio.id), idCuenta);
    if (guardado) {
      $('#modal-cobro-pedido').modal('hide');
      contexto = null;
    }
  } finally {
    boton.disabled = false;
  }
}
