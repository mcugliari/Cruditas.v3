// =============================================================================
// AVISO DE PEDIDOS NUEVOS (pedidos web) + CONTADOR DE PENDIENTES
//
// Qué hace:
//  - Escucha la base en tiempo real (Supabase Realtime sobre TB_TPEDIDOS). Cuando algo cambia
//    vuelve a consultar los pedidos pendientes. Cada 45 s consulta igual (red de seguridad
//    por si el canal en tiempo real se cae) y al volver a la pestaña.
//  - Si aparece un pedido WEB en PREPARACION que esta persona no vio todavía: suena un
//    aviso, sale un cartel arriba a la derecha, la campana de la barra superior se pone
//    a latir y, con la pestaña en segundo plano, el título parpadea (y, si se dio permiso,
//    sale una notificación del sistema).
//  - "Visto" se guarda en ESTE equipo (localStorage). No toca la base.
//
// No importa pedidos.js ni main.js (evita dependencias circulares): avisa con el evento
// 'pedidos:cambio' y recibe desde main.js la función para ir al listado.
// Solo LEE TB_TPEDIDOS (no hay ninguna escritura).
// =============================================================================
import { supabaseAdmin } from './config.js';

const ESTADOS_PENDIENTES = ['PREPARACION', 'PREPARADO', 'ENTREGADO_IMPAGO'];
const INTERVALO_CONSULTA_MS = 45000;      // red de seguridad si falla el tiempo real
const ESPERA_ENTRE_CAMBIOS_MS = 600;      // junta varios cambios seguidos en una sola consulta
const MAX_VISTOS_GUARDADOS = 300;
const MANTENER_PANTALLA_ENCENDIDA = true; // false = no pedir que la pantalla quede encendida

const CLAVE_VISTOS = 'cruditas_pedidos_web_vistos';
const CLAVE_SONIDO = 'cruditas_aviso_sonido';

let irAPedidos = () => {};
let pendientes = [];              // última lista de pendientes (solo columnas livianas)
let vistos = new Set();
let alertados = new Set();        // ids ya avisados en esta sesión (evita avisar dos veces)
let primeraCarga = true;
let temporizadorConsulta = null;
let consultando = false;
let volverAConsultar = false;
let audioCtx = null;
let sonidoActivo = true;
const tituloOriginal = document.title;
let temporizadorTitulo = null;
let wakeLock = null;

// ---------------------------------------------------------------------------
// "Visto" (por equipo)
// ---------------------------------------------------------------------------
function leerVistos() {
  try {
    const crudo = localStorage.getItem(CLAVE_VISTOS);
    if (crudo === null) return null;            // primera vez en este equipo
    const lista = JSON.parse(crudo);
    return new Set(Array.isArray(lista) ? lista.map(Number) : []);
  } catch (e) {
    return null;
  }
}

function guardarVistos() {
  try {
    // Se conservan solo los ids más altos (los más nuevos).
    const lista = [...vistos].sort((a, b) => a - b).slice(-MAX_VISTOS_GUARDADOS);
    localStorage.setItem(CLAVE_VISTOS, JSON.stringify(lista));
  } catch (e) { /* sin almacenamiento: el aviso funciona igual, solo no recuerda */ }
}

const esWebEnPreparacion = (p) => p.canal === 'WEB' && p.estado === 'PREPARACION';

// ¿Es un pedido web que todavía no se marcó como visto en este equipo?
export function esPedidoNuevoSinVer(p) {
  return !!p && esWebEnPreparacion(p) && !vistos.has(Number(p.id));
}

export function marcarVistos(ids) {
  let cambio = false;
  (ids || []).forEach(id => {
    const n = Number(id);
    if (!vistos.has(n)) { vistos.add(n); cambio = true; }
  });
  if (!cambio) return;
  guardarVistos();
  actualizarIndicadores();
}

export function marcarTodosVistos() {
  marcarVistos(pendientes.filter(esWebEnPreparacion).map(p => p.id));
}

export function cantidadSinVer() {
  return pendientes.filter(esPedidoNuevoSinVer).length;
}

// ---------------------------------------------------------------------------
// Consulta de pendientes (una sola fuente de verdad para contador y avisos)
// ---------------------------------------------------------------------------
async function consultarPendientes() {
  if (consultando) { volverAConsultar = true; return; }
  consultando = true;
  try {
    const { data, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('id, estado, canal, importe_total, nombre_referencia, TB_BCLIENTES(nombre)')
      .in('estado', ESTADOS_PENDIENTES)
      .order('id', { ascending: true })
      .limit(500);
    if (error) throw error;
    pendientes = data || [];
    procesarNovedades();
    actualizarIndicadores();
  } catch (e) {
    console.warn('Aviso de pedidos: no se pudo consultar los pendientes.', e);
  } finally {
    consultando = false;
    if (volverAConsultar) { volverAConsultar = false; programarConsulta(); }
  }
}

function programarConsulta() {
  clearTimeout(temporizadorConsulta);
  temporizadorConsulta = setTimeout(consultarPendientes, ESPERA_ENTRE_CAMBIOS_MS);
}

function procesarNovedades() {
  const web = pendientes.filter(esWebEnPreparacion);

  if (primeraCarga) {
    primeraCarga = false;
    // Primera vez en este equipo: lo que ya hay se toma como visto (no es "nuevo").
    if (leerVistos() === null) {
      vistos = new Set(web.map(p => Number(p.id)));
      guardarVistos();
    }
    web.forEach(p => alertados.add(Number(p.id)));
    const sinVer = web.filter(esPedidoNuevoSinVer);
    if (sinVer.length > 0) {
      mostrarCartel(sinVer, `Hay ${sinVer.length} pedido${sinVer.length > 1 ? 's' : ''} web sin ver`);
    }
    return;
  }

  const nuevos = web.filter(p => !alertados.has(Number(p.id)) && !vistos.has(Number(p.id)));
  web.forEach(p => alertados.add(Number(p.id)));
  if (nuevos.length === 0) return;

  const titulo = nuevos.length === 1 ? 'Nuevo pedido web' : `${nuevos.length} pedidos web nuevos`;
  mostrarCartel(nuevos, titulo);
  sonarAviso();
  notificarSistema(titulo, textoDePedido(nuevos[0]));
}

// ---------------------------------------------------------------------------
// Indicadores: campana de la barra, globito del menú y título de la pestaña
// ---------------------------------------------------------------------------
function actualizarIndicadores() {
  const total = pendientes.length;
  const sinVer = cantidadSinVer();

  const campana = document.getElementById('aviso-pedidos');
  const numero = document.getElementById('aviso-pedidos-numero');
  if (campana && numero) {
    numero.textContent = total;
    campana.classList.toggle('hay-pendientes', total > 0);
    campana.classList.toggle('hay-nuevos', sinVer > 0);
    campana.title = sinVer > 0
      ? `${sinVer} pedido${sinVer > 1 ? 's' : ''} web sin ver · ${total} pendiente${total !== 1 ? 's' : ''}`
      : `${total} pedido${total !== 1 ? 's' : ''} pendiente${total !== 1 ? 's' : ''}`;
  }

  const globito = document.getElementById('menu-badge-pendientes');
  if (globito) {
    globito.textContent = total;
    globito.classList.toggle('d-none', total === 0);
    globito.classList.toggle('badge-danger', sinVer > 0);
    globito.classList.toggle('badge-info', sinVer === 0);
  }

  actualizarTitulo(sinVer);
}

function actualizarTitulo(sinVer) {
  clearInterval(temporizadorTitulo);
  temporizadorTitulo = null;
  document.title = tituloOriginal;
  if (sinVer > 0 && document.hidden) {
    let alterna = false;
    temporizadorTitulo = setInterval(() => {
      alterna = !alterna;
      document.title = alterna ? `🔔 (${sinVer}) Pedido nuevo` : tituloOriginal;
    }, 1000);
  }
}

function textoDePedido(p) {
  const nombre = p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final';
  const total = Number(p.importe_total || 0).toLocaleString('es-AR');
  return `#${p.id} · ${nombre} · $${total}`;
}

// ---------------------------------------------------------------------------
// Cartel flotante (los textos se asignan con textContent: el nombre lo escribe un
// cliente anónimo desde la web)
// ---------------------------------------------------------------------------
function mostrarCartel(pedidosNuevos, titulo) {
  let cartel = document.getElementById('cartel-pedido-nuevo');
  if (!cartel) {
    cartel = document.createElement('div');
    cartel.id = 'cartel-pedido-nuevo';
    cartel.className = 'cartel-pedido-nuevo';
    cartel.setAttribute('role', 'alert');
    document.body.appendChild(cartel);
    cartel.addEventListener('click', (e) => {
      if (e.target.closest('[data-cartel="cerrar"]')) { ocultarCartel(); return; }
      if (e.target.closest('[data-cartel="ver"]')) { ocultarCartel(); irAPedidos(); }
    });
  }

  const visibles = pedidosNuevos.slice(0, 3);
  cartel.innerHTML = `
    <div class="cartel-cabecera">
      <strong><i class="fas fa-bell mr-1"></i> <span data-cartel="titulo"></span></strong>
      <button type="button" class="cartel-cerrar" data-cartel="cerrar" aria-label="Cerrar">&times;</button>
    </div>
    <div class="cartel-cuerpo">${visibles.map(() => '<div class="cartel-linea"></div>').join('')}</div>
    <button type="button" class="btn btn-sm btn-warning font-weight-bold btn-block mt-2" data-cartel="ver">Ver pedidos</button>
  `;
  cartel.querySelector('[data-cartel="titulo"]').textContent = titulo;
  cartel.querySelectorAll('.cartel-linea').forEach((el, i) => { el.textContent = textoDePedido(visibles[i]); });
  if (pedidosNuevos.length > visibles.length) {
    const mas = document.createElement('div');
    mas.className = 'cartel-linea text-muted';
    mas.textContent = `y ${pedidosNuevos.length - visibles.length} más`;
    cartel.querySelector('.cartel-cuerpo').appendChild(mas);
  }
  cartel.classList.add('visible');
}

function ocultarCartel() {
  document.getElementById('cartel-pedido-nuevo')?.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Sonido (se genera con el navegador: no hace falta ningún archivo de audio)
// El navegador solo deja sonar después de que la persona tocó algo en la página.
// ---------------------------------------------------------------------------
function prepararAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* sin audio: queda el aviso visual */ }
}

function sonarAviso() {
  if (!sonidoActivo) return;
  prepararAudio();
  if (!audioCtx || audioCtx.state !== 'running') return;
  // Tres "ding" seguidos (nota alta, más alta, alta)
  const notas = [880, 1175, 880];
  const t0 = audioCtx.currentTime;
  notas.forEach((frecuencia, i) => {
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    const inicio = t0 + i * 0.22;
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    vol.gain.setValueAtTime(0.0001, inicio);
    vol.gain.exponentialRampToValueAtTime(0.35, inicio + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.2);
    osc.connect(vol).connect(audioCtx.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.22);
  });
}

function pintarBotonSonido() {
  const btn = document.getElementById('btn-aviso-sonido');
  if (!btn) return;
  btn.innerHTML = sonidoActivo ? '<i class="fas fa-volume-up"></i>' : '<i class="fas fa-volume-mute"></i>';
  btn.title = sonidoActivo
    ? 'Aviso con sonido: activado (tocar para silenciar)'
    : 'Aviso con sonido: silenciado (tocar para activar)';
  btn.classList.toggle('silenciado', !sonidoActivo);
}

function alternarSonido() {
  sonidoActivo = !sonidoActivo;
  try { localStorage.setItem(CLAVE_SONIDO, sonidoActivo ? '1' : '0'); } catch (e) { /* ignorar */ }
  pintarBotonSonido();
  if (sonidoActivo) {
    prepararAudio();
    sonarAviso();   // muestra cómo suena
    // Al activar el sonido se pide, una sola vez, permiso para notificaciones del sistema.
    if ('Notification' in window && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { /* ignorar */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Notificación del sistema (solo si la persona dio permiso y la pestaña está en segundo plano)
// ---------------------------------------------------------------------------
function notificarSistema(titulo, texto) {
  try {
    if (!sonidoActivo || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;   // con la pestaña a la vista alcanzan el cartel y el sonido
    const n = new Notification(titulo, { body: texto, tag: 'pedido-web' });
    n.onclick = () => { window.focus(); n.close(); irAPedidos(); };
  } catch (e) { /* algunos celulares no permiten new Notification(): se ignora */ }
}

// ---------------------------------------------------------------------------
// Pantalla encendida (Wake Lock). Se vuelve a pedir al volver a la pestaña.
// ---------------------------------------------------------------------------
async function pedirPantallaEncendida() {
  if (!MANTENER_PANTALLA_ENCENDIDA || !('wakeLock' in navigator) || document.hidden || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { /* sin permiso o sin soporte: se ignora */ }
}

// ---------------------------------------------------------------------------
// Arranque (main.js lo llama una vez, con la sesión y el rol ya listos)
// ---------------------------------------------------------------------------
export function iniciarAvisoPedidos({ alIrAPedidos } = {}) {
  if (typeof alIrAPedidos === 'function') irAPedidos = alIrAPedidos;

  let guardado = null;
  try { guardado = localStorage.getItem(CLAVE_SONIDO); } catch (e) { /* ignorar */ }
  sonidoActivo = guardado !== '0';
  pintarBotonSonido();

  vistos = leerVistos() || new Set();

  // El audio y la pantalla encendida necesitan un toque previo de la persona.
  const alPrimerToque = () => {
    prepararAudio();
    pedirPantallaEncendida();
    document.removeEventListener('pointerdown', alPrimerToque);
    document.removeEventListener('keydown', alPrimerToque);
  };
  document.addEventListener('pointerdown', alPrimerToque);
  document.addEventListener('keydown', alPrimerToque);

  document.getElementById('aviso-pedidos')?.addEventListener('click', () => { ocultarCartel(); irAPedidos(); });
  document.getElementById('btn-aviso-sonido')?.addEventListener('click', alternarSonido);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { consultarPendientes(); pedirPantallaEncendida(); }
    actualizarTitulo(cantidadSinVer());
  });

  // Tiempo real: cualquier cambio en pedidos (nuevo, cambio de estado, anulación) dispara
  // una consulta y avisa a la pantalla de pedidos para que se refresque.
  try {
    supabaseAdmin
      .channel('aviso-pedidos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'TB_TPEDIDOS' }, () => {
        programarConsulta();
        document.dispatchEvent(new CustomEvent('pedidos:cambio'));
      })
      .subscribe((estado) => {
        if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
          console.warn('Aviso de pedidos: tiempo real no disponible, se usa la consulta periódica.');
        }
      });
  } catch (e) {
    console.warn('Aviso de pedidos: no se pudo abrir el canal en tiempo real.', e);
  }

  // Red de seguridad: consulta periódica (también en segundo plano, para que el título parpadee)
  setInterval(consultarPendientes, INTERVALO_CONSULTA_MS);

  consultarPendientes();
}
