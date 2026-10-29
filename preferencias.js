// =============================================================================
// preferencias.js  ·  PREFERENCIAS DE IMPRESIÓN DE ESTE EQUIPO
// =============================================================================
//
// QUÉ HACE
//   - Guarda, en el navegador de ESTE equipo, si el POS debe imprimir solo al tomar un pedido:
//       comandaAlPreparar -> al elegir "Solo preparar" imprime la comanda de cocina
//       imprimirAlCobrar  -> al elegir "Cobrar y entregar" imprime comanda y ticket
//   - Maneja la pantalla "Impresión" (menú CONFIGURACIÓN): dos interruptores y un botón
//     para imprimir una prueba.
//
// POR QUÉ SE GUARDA EN EL NAVEGADOR Y NO EN LA BASE
//   La impresora es de cada equipo: el mostrador puede imprimir y una tablet, no. Con
//   "localStorage" (una memoria chica del navegador) cada equipo guarda lo suyo.
//   Si el navegador no deja guardar (modo privado, por ejemplo), se usan los valores por
//   defecto: todo apagado, es decir, el POS se comporta como siempre.
//
// QUIÉN LO USA: pos.js (leerPreferenciasImpresion), main.js (inicializarPreferencias).
// =============================================================================

import { mostrarNotificacion } from './utils.js';
import { imprimirPrueba } from './impresion.js';

const CLAVE = 'cruditas_preferencias_impresion';

// Por defecto todo apagado: nada cambia hasta que alguien lo active en esta pantalla.
const POR_DEFECTO = { comandaAlPreparar: false, imprimirAlCobrar: false };

// Relaciona cada interruptor de la pantalla con su preferencia.
const INTERRUPTORES = [
  { id: 'pref-comanda-preparar', clave: 'comandaAlPreparar' },
  { id: 'pref-imprimir-cobrar',  clave: 'imprimirAlCobrar' }
];

let eventosListos = false;


// Devuelve las preferencias guardadas (o las de por defecto). Nunca tira error.
export function leerPreferenciasImpresion() {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const guardado = crudo ? JSON.parse(crudo) : {};
    return {
      comandaAlPreparar: guardado.comandaAlPreparar === true,
      imprimirAlCobrar: guardado.imprimirAlCobrar === true
    };
  } catch (err) {
    return { ...POR_DEFECTO };
  }
}


// Guarda una preferencia. Devuelve true si pudo guardarla.
function guardarPreferencia(clave, valor) {
  try {
    const actuales = leerPreferenciasImpresion();
    actuales[clave] = valor === true;
    localStorage.setItem(CLAVE, JSON.stringify(actuales));
    return true;
  } catch (err) {
    console.error('No se pudo guardar la preferencia de impresión:', err);
    return false;
  }
}


// Se ejecuta cada vez que se entra a la pantalla "Impresión" (main.js, navegarA).
export function inicializarPreferencias() {
  const prefs = leerPreferenciasImpresion();
  INTERRUPTORES.forEach(({ id, clave }) => {
    const casilla = document.getElementById(id);
    if (casilla) casilla.checked = prefs[clave];
  });

  // Los escuchadores se registran una sola vez (la pantalla se abre muchas veces).
  if (eventosListos) return;
  eventosListos = true;

  INTERRUPTORES.forEach(({ id, clave }) => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const ok = guardarPreferencia(clave, e.target.checked);
      if (ok) {
        mostrarNotificacion('Guardado en este equipo.');
      } else {
        // No se pudo guardar: se vuelve a mostrar lo que realmente hay.
        e.target.checked = leerPreferenciasImpresion()[clave];
        mostrarNotificacion('No se pudo guardar la preferencia en este navegador.', 'warning');
      }
    });
  });

  document.getElementById('btn-imprimir-prueba')?.addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    boton.disabled = true;   // evita imprimir dos pruebas con un doble toque
    try {
      await imprimirPrueba();
    } catch (err) {
      console.error('Error en la prueba de impresión:', err);
      mostrarNotificacion('No se pudo imprimir la prueba.', 'danger');
    } finally {
      boton.disabled = false;
    }
  });
}
