// =============================================================================
// avisoAccion.js  ·  AVISO FLOTANTE CON UN BOTÓN (Deshacer / Entendido)
// =============================================================================
//
// QUÉ HACE
//   Muestra un cartel abajo en el centro de la pantalla con un mensaje y UN botón.
//   Lo usa el POS para dos cosas:
//     - "Se quitó Pollo (12). [Deshacer]"   -> desaparece solo a los pocos segundos.
//     - "No se pudo confirmar si el pedido se guardó... [Entendido]" -> se queda en
//       pantalla hasta que se toca el botón (duracionMs = 0), porque es importante.
//   Los avisos comunes (mostrarNotificacion, en utils.js) no sirven para esto: no tienen
//   botón y duran fijo. Por eso es un módulo aparte: así no se toca utils.js, que usa
//   todo el sistema.
//
// REGLAS
//   - Hay UN solo aviso a la vez: mostrar otro cierra el anterior (motivo "reemplazado").
//   - El mensaje se escribe con textContent (texto plano), nunca con innerHTML.
//   - Con duracionMs > 0 se ve una barrita que se va vaciando (cuenta regresiva visual).
//
// CÓMO SE CONECTA: lo importa pos.js. Estilos: styles.css (bloque "POS · avisos").
// =============================================================================

// Aviso que está en pantalla ahora: { el, temporizador, alCerrar, tipo } (o null).
let actual = null;

// -----------------------------------------------------------------------------
// cerrarActual  (interna)
//   Saca el aviso de la pantalla y avisa a quien lo mostró (alCerrar) POR QUÉ se cerró:
//   'accion' (tocó el botón) | 'expiro' (se acabó el tiempo) | 'cerrado' (lo cerró el
//   código) | 'reemplazado' (se mostró otro aviso).
// -----------------------------------------------------------------------------
function cerrarActual(motivo) {
  if (!actual) return;
  const { el, temporizador, alCerrar } = actual;
  clearTimeout(temporizador);
  el.remove();
  actual = null;
  if (alCerrar) alCerrar(motivo);
}

// -----------------------------------------------------------------------------
// mostrarAvisoConAccion
//   mensaje      texto a mostrar
//   textoAccion  texto del botón ("Deshacer", "Entendido")
//   alAccionar   función que se ejecuta al tocar el botón (opcional)
//   alCerrar     función(motivo) que se ejecuta cuando el aviso se cierra (opcional)
//   duracionMs   cuánto dura en pantalla; 0 = hasta que se toque el botón
//   tipo         'deshacer' (azul) | 'peligro' (rojo oscuro, para errores importantes)
// -----------------------------------------------------------------------------
export function mostrarAvisoConAccion({
  mensaje, textoAccion = 'Entendido', alAccionar = null, alCerrar = null,
  duracionMs = 8000, tipo = 'deshacer'
}) {
  cerrarActual('reemplazado');

  const el = document.createElement('div');
  el.className = `aviso-accion aviso-accion--${tipo}`;
  // "alert" avisa de inmediato a los lectores de pantalla; "status" espera su turno.
  el.setAttribute('role', tipo === 'peligro' ? 'alert' : 'status');

  const texto = document.createElement('span');
  texto.className = 'aviso-accion-texto';
  texto.textContent = mensaje;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'aviso-accion-btn';
  boton.textContent = textoAccion;
  boton.addEventListener('click', () => {
    // Primero se cierra y recién después se ejecuta la acción (la acción puede mostrar otro aviso).
    cerrarActual('accion');
    if (alAccionar) alAccionar();
  });

  el.append(texto, boton);

  if (duracionMs > 0) {
    const barra = document.createElement('span');
    barra.className = 'aviso-accion-barra';
    barra.style.animationDuration = `${duracionMs}ms`;
    el.appendChild(barra);
  }

  document.body.appendChild(el);

  actual = {
    el, alCerrar, tipo,
    temporizador: duracionMs > 0 ? setTimeout(() => cerrarActual('expiro'), duracionMs) : null
  };
}

// -----------------------------------------------------------------------------
// cerrarAvisoAccion
//   Cierra el aviso actual desde afuera. Si se pasa "tipo", solo lo cierra si es de ese
//   tipo (así cerrar el aviso de "Deshacer" no se lleva por delante un error importante).
// -----------------------------------------------------------------------------
export function cerrarAvisoAccion(tipo = null) {
  if (!actual) return;
  if (tipo && actual.tipo !== tipo) return;
  cerrarActual('cerrado');
}
