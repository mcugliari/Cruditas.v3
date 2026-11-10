// =============================================================================
// cobro.js  ·  VENTANA DE COBRO (la usan el POS y el listado de pedidos)
// =============================================================================
//
// QUÉ HACE
//   Maneja UNA sola ventana (modal-cobro-pedido) para cobrar: muestra el total y
//   las unidades, deja elegir el medio de pago con botones, pide la cuenta (también con
//   botones, no con un desplegable) si el medio NO es efectivo y, en efectivo, calcula el
//   vuelto ("Paga con $").
//   El "Paga con $" es solo una ayuda en pantalla: NO se guarda en la base.
//
// IDEA CLAVE: CALLBACK (la misma que en pagos.js)
//   Esta ventana no sabe QUÉ se está cobrando. Quien la abre le pasa una función
//   "alConfirmar(idMedio, idCuenta, entregar)" que hace el guardado y devuelve:
//     true  -> se guardó bien: la ventana se cierra
//     false -> falló: la ventana queda abierta para corregir
//   Así cobro.js no importa pos.js ni pedidos.js (evitamos dependencias circulares).
//
// CÓMO SE CONECTA: index.html (modal-cobro-pedido), main.js (eventos), pos.js y
// pedidos.js (la abren), utils.js y config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, formatearPesos
} from './utils.js';


// Datos de la ventana abierta: { total, unidades, alConfirmar, ... } (ver abrirModalCobro).
let contexto = null;
// Medios y cuentas traídos de la base (para saber si el medio elegido es efectivo).
let mediosCobro = [];
let cuentasCobro = [];
// Medio elegido en este momento (número).
let idMedioElegido = null;
// Solo si quien abre la ventana lo permite (POS): ¿se entrega ahora (true) o el pedido queda en preparación
// porque el cliente paga por adelantado (false)?
let entregarAhora = true;
// Devolución de plata: no hay "Paga con $" ni vuelto (lo decide quien abre la ventana con ctx.sinVuelto).
let sinVuelto = false;
// ¿Se está guardando un cobro? Evita que un segundo envío del formulario pise el estado del primero.
let procesandoCobro = false;


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
//     etiquetaTotal -> texto sobre el importe (opcional; por defecto "Total a cobrar"; "Saldo a cobrar" si ya hubo pagos)
//     sinVuelto -> true = oculta "Paga con $" (para devolver plata, donde no hay vuelto)
//     tituloCuenta -> texto sobre la lista de cuentas (por defecto "Cuenta donde entra el cobro")
//     textoConfirmar -> texto del botón (por defecto "Confirmar cobro")
//     unidades -> si no viene, no se muestra el conteo de unidades
//     permiteAnticipado -> true = muestra "¿Se entrega ahora?" (Entregar ahora / Pagó por adelantado). El POS lo usa.
//     subtitulo   -> línea chica debajo del título
//     total       -> importe a cobrar (número)
//     unidades    -> cantidad de unidades (número)
//     alConfirmar -> async (idMedio, idCuenta, entregar) => true | false   (entregar solo cambia con permiteAnticipado)
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
  document.getElementById('cobro-total-etiqueta').textContent = ctx.etiquetaTotal || 'Total a cobrar';
  document.getElementById('cobro-total').textContent = formatearPesos(ctx.total);
  document.getElementById('cobro-unidades').textContent = ctx.unidades == null
    ? ''
    : `${ctx.unidades} unidad${Number(ctx.unidades) === 1 ? '' : 'es'}`;
  sinVuelto = Boolean(ctx.sinVuelto);
  document.getElementById('cobro-cuentas-titulo').textContent = ctx.tituloCuenta || 'Cuenta donde entra el cobro';
  document.getElementById('btn-confirmar-cobro').innerHTML =
    `<i class="fas fa-check mr-1"></i> ${esc(ctx.textoConfirmar || 'Confirmar cobro')}`;
  document.getElementById('cobro-paga-con').value = '';
  document.getElementById('cobro-cuenta').value = '';   // sin cuenta elegida al abrir

  // "¿Se entrega ahora?": solo se ofrece cuando quien abre la ventana lo permite. Arranca en "Entregar ahora".
  document.getElementById('cobro-grupo-entrega').classList.toggle('d-none', !ctx.permiteAnticipado);
  elegirEntrega(true);
  document.getElementById('cobro-entrega').onclick = (e) => {
    const btn = e.target.closest('[data-entregar]');
    if (btn) elegirEntrega(btn.dataset.entregar === '1');
  };

  // Clics sobre la lista de cuentas. Se asigna con "onclick" (no addEventListener) para que,
  // aunque la ventana se abra muchas veces, quede UN solo oyente.
  document.getElementById('cobro-cuentas-lista').onclick = (e) => {
    const btn = e.target.closest('.cobro-cuenta-btn');
    if (btn) elegirCuenta(btn.dataset.id);
  };

  // Un botón por medio de pago. El nombre viene de la base, por eso pasa por esc().
  // "icono" y "tipo" salen de estiloMedio (textos fijos del código), no hace falta esc().
  document.getElementById('cobro-medios').innerHTML = mediosCobro.map(m => {
    const { icono, tipo } = estiloMedio(m);
    return `
    <button type="button" class="cobro-medio-btn tipo-${tipo}" data-id="${m.id}" role="radio" aria-checked="false">
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
// elegirEntrega  (interna)
//   Marca "Entregar ahora" o "Pagó por adelantado" (el pedido queda en preparación).
// -----------------------------------------------------------------------------
function elegirEntrega(entregar) {
  entregarAhora = Boolean(entregar);
  document.querySelectorAll('#cobro-entrega [data-entregar]').forEach(btn => {
    const activo = (btn.dataset.entregar === '1') === entregarAhora;
    btn.classList.toggle('active', activo);
    btn.setAttribute('aria-checked', String(activo));
  });
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
    const activo = Number(btn.dataset.id) === idMedioElegido;
    btn.classList.toggle('activo', activo);
    btn.setAttribute('aria-checked', String(activo));
  });

  const medio = mediosCobro.find(m => Number(m.id) === idMedioElegido);
  const esEfectivo = !!medio?.es_efectivo;

  // Cuenta: solo si NO es efectivo (en efectivo la base usa la cuenta Efectivo sola).
  document.getElementById('cobro-grupo-cuenta').classList.toggle('d-none', esEfectivo);
  if (!esEfectivo) dibujarCuentasCobro();

  // "Paga con $": solo tiene sentido en efectivo.
  document.getElementById('cobro-grupo-efectivo').classList.toggle('d-none', !esEfectivo || sinVuelto);
  actualizarVueltoCobro();
}


// -----------------------------------------------------------------------------
// dibujarCuentasCobro  (interna)
//   Arma la lista de cuentas como botones (una por botón, una elegida a la vez).
//   Solo se ofrecen cuentas que NO son de efectivo: el efectivo va solo al cajón, y las
//   reservas de efectivo no cobran. Si hay una sola cuenta, queda elegida. Si ya había una
//   elegida y sigue en la lista (por ejemplo al cambiar de medio), se conserva.
//   La cuenta elegida se guarda en el campo oculto #cobro-cuenta, que lee confirmarCobro.
// -----------------------------------------------------------------------------
function dibujarCuentasCobro() {
  const lista = document.getElementById('cobro-cuentas-lista');
  const campo = document.getElementById('cobro-cuenta');
  const cuentas = cuentasCobro.filter(c => c.tipo !== 'EFECTIVO');

  let elegida = cuentas.some(c => String(c.id) === campo.value) ? campo.value : '';
  if (!elegida && cuentas.length === 1) elegida = String(cuentas[0].id);
  campo.value = elegida;

  lista.innerHTML = cuentas.length === 0
    ? '<p class="text-muted small mb-0">No hay cuentas cargadas para este medio de pago.</p>'
    : cuentas.map(c => {
        const activa = String(c.id) === elegida;
        return `
    <button type="button" class="cobro-cuenta-btn ${activa ? 'activo' : ''}" data-id="${c.id}" role="radio" aria-checked="${activa}">
      <span class="cobro-cuenta-nombre">${esc(c.nombre)}</span>
      <i class="fas fa-check-circle cobro-cuenta-check" aria-hidden="true"></i>
    </button>`;
      }).join('');

  marcarErrorCuenta(false);
}

// Marca la cuenta elegida (clic en un botón de la lista).
function elegirCuenta(idCuenta) {
  document.getElementById('cobro-cuenta').value = String(idCuenta);
  document.querySelectorAll('#cobro-cuentas-lista .cobro-cuenta-btn').forEach(btn => {
    const activa = btn.dataset.id === String(idCuenta);
    btn.classList.toggle('activo', activa);
    btn.setAttribute('aria-checked', String(activa));
  });
  marcarErrorCuenta(false);
}

// Resalta en rojo la lista cuando se intenta confirmar sin elegir cuenta.
function marcarErrorCuenta(hayError) {
  document.getElementById('cobro-cuentas-lista').classList.toggle('es-invalido', hayError);
  document.getElementById('cobro-cuenta-error').classList.toggle('d-none', !hayError);
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
    salida.textContent = `Vuelto: ${formatearPesos(diferencia)}`;
    salida.className = 'cobro-vuelto text-success';
  } else {
    salida.textContent = `Faltan ${formatearPesos(-diferencia)}`;
    salida.className = 'cobro-vuelto text-danger';
  }
}


// -----------------------------------------------------------------------------
// confirmarCobro
//   Se ejecuta al enviar el formulario (botón "Confirmar cobro"). Valida el medio y
//   la cuenta y llama al callback "alConfirmar" que dejó quien abrió la ventana.
// -----------------------------------------------------------------------------
export async function confirmarCobro(e) {
  e.preventDefault();
  if (!contexto || procesandoCobro) return;

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
    marcarErrorCuenta(true);
    document.getElementById('cobro-cuentas-lista').scrollIntoView({ block: 'nearest' });
    mostrarNotificacion('Elegí a qué cuenta entra el cobro.', 'warning');
    return;
  }

  // Mientras se procesa: el botón muestra "Guardando…", no se puede cancelar ni cerrar la ventana
  // (ni con la X ni con Esc) y no se puede apretar de nuevo (evita un doble clic que cobre dos veces).
  const boton = document.getElementById('btn-confirmar-cobro');
  const botonCancelar = document.querySelector('#modal-cobro-pedido .modal-footer [data-dismiss="modal"]');
  const botonCerrar = document.querySelector('#modal-cobro-pedido .modal-header .close');
  const contenidoOriginal = boton.innerHTML;
  const impedirCierre = (ev) => ev.preventDefault();   // Bootstrap cierra la ventana con el evento hide.bs.modal

  procesandoCobro = true;
  boton.disabled = true;
  boton.innerHTML = '<i class="fas fa-spinner fa-spin mr-1" aria-hidden="true"></i> Guardando…';
  if (botonCancelar) botonCancelar.disabled = true;
  if (botonCerrar) botonCerrar.disabled = true;
  $('#modal-cobro-pedido').on('hide.bs.modal', impedirCierre);

  let guardado = false;
  // try / finally: "finally" se ejecuta SIEMPRE al salir, así el botón nunca queda trabado.
  try {
    guardado = await contexto.alConfirmar(Number(medio.id), idCuenta, contexto.permiteAnticipado ? entregarAhora : true);
  } finally {
    $('#modal-cobro-pedido').off('hide.bs.modal', impedirCierre);   // antes de cerrar: si no, el cierre quedaría bloqueado
    procesandoCobro = false;
    boton.disabled = false;
    boton.innerHTML = contenidoOriginal;
    if (botonCancelar) botonCancelar.disabled = false;
    if (botonCerrar) botonCerrar.disabled = false;
  }

  if (guardado) {
    $('#modal-cobro-pedido').modal('hide');
    contexto = null;
  }
}
