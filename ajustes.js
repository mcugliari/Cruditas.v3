// =============================================================================
// ajustes.js  ·  PANTALLA "AJUSTES" (solo el Dueño): WhatsApp del negocio
// =============================================================================
//
// QUÉ HACE
//   Muestra el número de WhatsApp del negocio (el que usa el botón "Avisarnos por WhatsApp" del
//   formulario público) y deja al Dueño cambiarlo o apagarlo, sin entrar al SQL Editor.
//
// DE DÓNDE SALEN LOS DATOS Y QUIÉN LO PROTEGE
//   Leer:    función whatsapp_negocio()            (script 40)
//   Guardar: función guardar_whatsapp_negocio(...) (script 41; exige rol DUENO en la base)
//   Esta pantalla es solo la comodidad: aunque alguien la viera, la base rechaza el cambio.
//
// EL NÚMERO
//   Se escribe como lo diría una persona (11 2233 4455, 011 15 2233-4455...) y se convierte a
//   549 + característica + número con telefono.js, el mismo conversor del aviso de "pedido listo".
//   Solo celulares argentinos.
//
// CÓMO SE CONECTA: index.html (sec-ajustes), main.js (navegarA), telefono.js, utils.js y config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, confirmarAccion, mensajeErrorFuncion } from './utils.js';
import { telefonoParaWhatsApp } from './telefono.js';

let numeroActual = '';             // lo que hay guardado hoy ('' = botón apagado)
let escuchadoresListos = false;    // los oyentes se ponen UNA sola vez

const el = (id) => document.getElementById(id);

// '5491122334455' -> '+54 9 1122334455' (solo para mostrar)
function formatoLegible(numero) {
  return numero ? `+54 9 ${numero.slice(3)}` : '';
}

function mostrarError(texto) {
  const caja = el('ajuste-whatsapp-error');
  if (!caja) return;
  caja.textContent = texto;
  caja.classList.remove('d-none');
}

function ocultarError() {
  el('ajuste-whatsapp-error')?.classList.add('d-none');
}

// Traduce el error de la base a un texto claro.
function textoError(error) {
  if ((error?.message || '').includes('numero_invalido')) {
    return 'El número no es válido. Escribilo con característica, sin 0 ni 15 (ej.: 11 2233 4455).';
  }
  return mensajeErrorFuncion(error, 'número');
}

// Muestra el número guardado hoy.
function pintarActual() {
  const actual = el('ajuste-whatsapp-actual');
  if (actual) actual.textContent = numeroActual ? formatoLegible(numeroActual) : 'No hay número cargado (el botón no se muestra)';
  el('btn-quitar-whatsapp')?.classList.toggle('d-none', !numeroActual);
}

// Cada vez que se escribe: muestra cómo quedaría y habilita o no los botones.
function actualizarVista() {
  const texto = el('ajuste-whatsapp-input')?.value.trim() || '';
  const nuevo = telefonoParaWhatsApp(texto);
  const vista = el('ajuste-whatsapp-vista');
  const btnGuardar = el('btn-guardar-whatsapp');
  const btnProbar = el('btn-probar-whatsapp');
  if (!vista || !btnGuardar || !btnProbar) return;

  ocultarError();
  vista.classList.remove('text-muted', 'text-danger', 'text-success');

  if (!texto) {
    vista.textContent = 'Escribí el número con característica, sin 0 ni 15 (ej.: 11 2233 4455).';
    vista.classList.add('text-muted');
  } else if (!nuevo) {
    vista.textContent = 'No se pudo interpretar el número. Probá con característica, sin 0 ni 15 (ej.: 11 2233 4455).';
    vista.classList.add('text-danger');
  } else {
    vista.textContent = `Se guardará como: ${formatoLegible(nuevo)}`;
    vista.classList.add('text-success');
  }

  btnGuardar.disabled = !nuevo || nuevo === numeroActual;   // nada para guardar si es el mismo
  if (nuevo) {
    btnProbar.href = `https://wa.me/${nuevo}`;
    btnProbar.classList.remove('disabled');
    btnProbar.removeAttribute('aria-disabled');
  } else {
    btnProbar.removeAttribute('href');
    btnProbar.classList.add('disabled');
    btnProbar.setAttribute('aria-disabled', 'true');
  }
}

// Guarda en la base (nuevo = número ya normalizado, o '' para apagar).
async function enviarANumero(nuevo) {
  const btnGuardar = el('btn-guardar-whatsapp');
  const btnQuitar = el('btn-quitar-whatsapp');
  ocultarError();
  if (btnGuardar) btnGuardar.disabled = true;
  if (btnQuitar) btnQuitar.disabled = true;

  const { data, error } = await supabaseAdmin.rpc('guardar_whatsapp_negocio', { p_numero: nuevo });

  if (btnQuitar) btnQuitar.disabled = false;
  if (error) {
    console.error('Error al guardar el WhatsApp del negocio:', error);
    actualizarVista();               // primero se reacomodan los botones (esto limpia errores)...
    mostrarError(textoError(error)); // ...y recién después se muestra el error
    return;
  }

  numeroActual = String(data ?? '');
  const input = el('ajuste-whatsapp-input');
  if (input) input.value = numeroActual;
  pintarActual();
  actualizarVista();
  mostrarNotificacion(numeroActual ? 'WhatsApp del negocio guardado.' : 'Botón de WhatsApp desactivado.');
}

async function guardarWhatsApp() {
  const nuevo = telefonoParaWhatsApp(el('ajuste-whatsapp-input')?.value || '');
  if (!nuevo) return;   // el botón ya está bloqueado en este caso; por las dudas
  await enviarANumero(nuevo);
}

async function quitarWhatsApp() {
  const ok = await confirmarAccion({
    titulo: 'Desactivar el botón de WhatsApp',
    mensaje: 'Los clientes ya no van a ver el botón "Avisarnos por WhatsApp" al terminar su pedido. ¿Desactivarlo?',
    textoConfirmar: 'Sí, desactivar',
    peligro: false
  });
  if (ok) await enviarANumero('');
}

// -----------------------------------------------------------------------------
// cargarAjustes
//   Se llama al entrar a la pantalla (main.js). La primera vez conecta los botones.
// -----------------------------------------------------------------------------
export async function cargarAjustes() {
  if (!escuchadoresListos) {
    el('ajuste-whatsapp-input')?.addEventListener('input', actualizarVista);
    el('btn-guardar-whatsapp')?.addEventListener('click', guardarWhatsApp);
    el('btn-quitar-whatsapp')?.addEventListener('click', quitarWhatsApp);
    escuchadoresListos = true;
  }

  ocultarError();
  const { data, error } = await supabaseAdmin.rpc('whatsapp_negocio');
  if (error) {
    console.error('Error al leer el WhatsApp del negocio:', error);
    mostrarError(textoError(error));
    return;
  }

  numeroActual = String(data ?? '');
  const input = el('ajuste-whatsapp-input');
  if (input) input.value = numeroActual;
  pintarActual();
  actualizarVista();
}
