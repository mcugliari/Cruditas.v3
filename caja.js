// =============================================================================
// caja.js  ·  CIERRE DE CAJA DIARIO E HISTORIAL DE CIERRES
// =============================================================================
//
// QUÉ HACE
//   1) Cierre del día: muestra qué se cobró hoy y qué salió de la caja (gastos,
//      pagos a proveedores y retiros), calcula el efectivo que debería haber, y
//      permite cerrar comparándolo con el efectivo realmente contado.
//   2) Anular el cierre de hoy (reabre la caja).
//   3) Historial: lista de cierres por fechas y su detalle.
//   4) Arqueo de turno (script 43): contar el efectivo del cajón y registrarlo SIN
//      cerrar la caja ni mover plata (cambio de turno). Es una solapa de la ventana de
//      cierre, con el historial de arqueos del día. El detalle de cada cierre del
//      historial también muestra los arqueos de ese día (solo lectura).
//   La ventana muestra arriba el efectivo esperado (una sola vez), el detalle del día
//   plegado y dos solapas: "Cerrar caja" y "Arqueo de turno".
//
// QUÉ CAMBIÓ RESPECTO DE LA VERSIÓN ANTERIOR
//   - Los números ya NO se calculan en el navegador: los calcula la base de datos
//     (funciones resumen_caja, cerrar_caja y anular_cierre, script 07). Lo que se
//     ve antes de cerrar es exactamente lo que se guarda.
//   - Las ventas se cuentan por la FECHA DE COBRO (el día en que el pedido pasó a
//     COMPLETADO), no por la fecha del pedido.
//   - El cierre resta los egresos del día.
//   - Se puede cerrar un día que solo tuvo egresos.
//   - El cierre se guarda completo o no se guarda (antes eran dos pasos separados).
//
// CÓMO SE CONECTA
//   index.html (modalCierreCaja, modalDetalleCierre, sección del historial), main.js
//   (conecta el historial), utils.js y config.js. Los nombres de las funciones
//   exportadas y los id del HTML son los mismos de siempre.
// =============================================================================

import { supabaseAdmin } from './config.js';
import { puedeAlMenos } from './roles.js';   // el rol decide si se ve "Anular cierre"
import {
  mostrarNotificacion, esc, mensajeErrorFuncion, mensajeErrorBD,
  formatearMoneda, formatearFechaAR, obtenerFechaActualISO, confirmarAccion
} from './utils.js';


// El cálculo del día que se está viendo en la ventana de cierre (lo devuelve la
// función de la base "resumen_caja"). Lo guardamos acá para poder calcular la
// diferencia mientras el usuario escribe el efectivo contado.
// null significa "no hay nada para cerrar" (día vacío o ya cerrado).
let resumenCierreActual = null;

// Copia de los cierres que muestra el historial, para abrir el detalle sin volver
// a consultar (antes se guardaba en "window", una variable global; es más
// prolijo que sea una variable de este módulo).
let cierresCache = [];

// Arqueos de turno del rango consultado en el historial, agrupados por fecha ('AAAA-MM-DD' -> lista).
// null = no se pudieron cargar: en ese caso el detalle de un cierre simplemente no muestra la sección.
let arqueosPorFecha = null;

// Arqueo de turno: efectivo que el sistema espera en el cajón según el último resumen
// cargado (null = no se puede arquear: caja cerrada o error) y los arqueos de hoy.
let esperadoArqueo = null;
let contadorCargaArqueos = 0;   // evita que una carga lenta pise a una más nueva

// -----------------------------------------------------------------------------
// htmlMovimientoCuentas  (interna)
//   Arma las filas de la tabla "Movimiento por cuenta": dónde quedó la plata del día.
//   Se usa en dos lugares: el cierre del día y el detalle de un cierre del historial.
//   Recibe: filas -> lista de { nombre, sinCuenta, entra, sale, traspasos, neto } (importes como número).
//   Devuelve: el HTML ('' si no hay filas). Son "items" de un list-group: quien la llama
//   los pone dentro de uno.
//     entra = ventas cobradas · sale = gastos, pagos a proveedores y retiros
//     traspasos = transferencias y ajustes (+ entra a la cuenta, - sale) · neto = entra - sale + traspasos
// -----------------------------------------------------------------------------
function htmlMovimientoCuentas(filas) {
  if (filas.length === 0) return '';

  // Las columnas se definen en styles.css (.mov-cuenta-fila), la misma grilla para el encabezado y
  // para cada fila. En pantallas angostas cada cuenta se muestra apilada: el nombre arriba y cada
  // importe con su rótulo (data-label), así nada se corta.

  const encabezado = `
    <div class="list-group-item bg-light py-1 small font-weight-bold text-uppercase">Movimiento por cuenta</div>
    <div class="list-group-item py-1 small text-muted mov-cuenta-fila mov-cuenta-cab">
      <span></span><span class="text-right">Entra</span><span class="text-right">Sale</span><span class="text-right">Traspasos y ajustes</span><span class="text-right">Neto</span>
    </div>`;

  const cuerpo = filas.map(f => {
    const neto = Number(f.neto);
    const traspasos = Number(f.traspasos || 0);
    return `
    <div class="list-group-item py-2 mov-cuenta-fila">
      <span class="mov-cuenta-nombre">${esc(f.nombre)}${f.sinCuenta ? '<br><small class="text-muted">cobros o pagos sin cuenta cargada</small>' : ''}</span>
      <span class="text-right" data-label="Entra">$${formatearMoneda(f.entra)}</span>
      <span class="text-right ${Number(f.sale) > 0 ? 'text-danger' : 'text-muted'}" data-label="Sale">${Number(f.sale) > 0 ? '-$' + formatearMoneda(f.sale) : '-'}</span>
      <span class="text-right ${traspasos < 0 ? 'text-danger' : (traspasos > 0 ? 'text-success' : 'text-muted')}" data-label="Traspasos y ajustes">${traspasos === 0 ? '-' : (traspasos > 0 ? '+' : '-') + '$' + formatearMoneda(Math.abs(traspasos))}</span>
      <span class="text-right font-weight-bold" data-label="Neto">${neto < 0 ? '-' : ''}$${formatearMoneda(Math.abs(neto))}</span>
    </div>`;
  }).join('');

  return encabezado + cuerpo;
}


// -----------------------------------------------------------------------------
// htmlBannerEsperado  (interna)
//   El efectivo que el sistema espera en el cajón. Se muestra UNA sola vez, arriba de las
//   solapas "Cerrar caja" y "Arqueo de turno", porque las dos lo usan para comparar.
// -----------------------------------------------------------------------------
function htmlBannerEsperado(efectivoEsperado) {
  return `
    <div class="d-flex justify-content-between align-items-center p-3 mb-2 rounded border border-warning" style="background:#fff8e1;">
      <span><strong>EFECTIVO ESPERADO EN CAJA</strong><br>
        <small class="text-muted">lo que debería haber en el cajón según el sistema</small></span>
      <strong class="h4 mb-0">$${formatearMoneda(efectivoEsperado)}</strong>
    </div>`;
}


// =============================================================================
// 1. CIERRE DEL DÍA
// =============================================================================

// -----------------------------------------------------------------------------
// cargarResumenVentasDia
//   Se ejecuta cada vez que se abre la ventana de cierre. Le pide a la base el
//   resumen de hoy y dibuja uno de tres casos:
//     A) la caja de hoy ya está cerrada  -> aviso + botón para anular el cierre
//     B) no hay nada para cerrar         -> aviso
//     C) hay movimientos                 -> detalle y formulario para cerrar
// -----------------------------------------------------------------------------
export async function cargarResumenVentasDia() {
  const contenedor = document.getElementById('contenedor-resumen-cierre');
  if (!contenedor) return;

  contenedor.innerHTML = `
    <div class="text-center py-3">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Cargando totales del día...
    </div>
  `;

  const fechaISO = obtenerFechaActualISO();
  const fechaTextoAR = formatearFechaAR(fechaISO);
  resumenCierreActual = null;
  esperadoArqueo = null;

  try {
    // .rpc('nombre', { parámetros }) ejecuta una función de la base y devuelve lo
    // que ella devuelve. Acá, "resumen" es un OBJETO con muchos datos, por ejemplo
    // resumen.total_ventas o resumen.efectivo_esperado (ver script 07).
    const { data: resumen, error } = await supabaseAdmin.rpc('resumen_caja', { p_fecha: fechaISO });
    if (error) throw error;

    // Panel de arqueo: con la caja abierta se puede arquear contra el esperado; con la caja
    // cerrada solo se ve el historial. Se prepara antes de los casos A/B/C (que pueden salir temprano).
    esperadoArqueo = resumen.cerrada ? null : (Number(resumen.efectivo_esperado) || 0);
    prepararPanelArqueo(!!resumen.cerrada);
    cargarArqueosDia();   // sin await: no frena el dibujo del resumen

    // ---- CASO A: la caja de hoy ya está cerrada ----
    if (resumen.cerrada) {
      contenedor.innerHTML = `
        <div class="alert alert-warning text-center my-2 p-3">
          <h6 class="font-weight-bold mb-1">🔒 La caja de hoy (${fechaTextoAR}) ya se encuentra CERRADA.</h6>
          <p class="small mb-2">
            Total rendido: <strong>$${formatearMoneda(resumen.total_general)}</strong> |
            Dif. Efectivo: <strong>$${formatearMoneda(resumen.diferencia_efectivo)}</strong>
          </p>
          ${puedeAlMenos('DUENO') ? `<button type="button" class="btn btn-accion btn-accion-peligro mt-1" id="btn-anular-cierre">
            <i class="fas fa-lock-open"></i> Anular cierre y reabrir caja
          </button>` : ''}
        </div>
      `;
      alternarCamposFormulario(true);

      // El botón se acaba de crear, así que el evento se conecta acá, en el momento.
      document.getElementById('btn-anular-cierre')
        ?.addEventListener('click', () => anularCierreCaja(resumen.id_cierre));
      return;
    }

    // ---- CASO B: no hay nada para cerrar ----
    if (Number(resumen.cantidad_pedidos) === 0 && Number(resumen.cantidad_egresos) === 0
        && Number(resumen.cantidad_traspasos || 0) === 0) {
      contenedor.innerHTML = `
        <div class="alert alert-info text-center my-2">
          No hay ventas cobradas, egresos ni traspasos registrados hoy (${fechaTextoAR}).<br>
          <small>Las ventas se cuentan el día en que se cobran (pedidos completados).</small>
        </div>
      ` + htmlBannerEsperado(esperadoArqueo);   // el arqueo se puede hacer igual, aun sin movimientos
      alternarCamposFormulario(true);
      return;
    }

    // ---- CASO C: hay movimientos para cerrar ----
    resumenCierreActual = resumen;
    alternarCamposFormulario(false);

    // Armamos el HTML sumando trozos de texto con "+=" (agrega al final del texto).
    // "html" es el DETALLE DEL DÍA (ventas, egresos, movimiento por cuenta): va plegado, porque quien
    // cierra solo necesita el efectivo esperado (banner de arriba) y contar el cajón.
    let html = '<div class="list-group mb-2">';

    // VENTAS COBRADAS, una línea por medio de pago.
    // .filter() se queda con los medios que tuvieron ventas (los que solo tuvieron
    // egresos no van en esta sección) y .forEach() ejecuta algo por cada uno
    // (parecido a .map(), pero sin devolver una lista nueva).
    html += `<div class="list-group-item bg-light py-1 small font-weight-bold text-uppercase">Ventas cobradas hoy</div>`;
    resumen.medios.filter(m => Number(m.cantidad) > 0).forEach(m => {
      html += `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
          <span><strong>${esc(m.nombre)}</strong> <small class="text-muted">(${m.cantidad} ped.)</small></span>
          <span class="font-weight-bold">$${formatearMoneda(m.ventas)}</span>
        </div>`;
    });
    html += `
      <div class="list-group-item d-flex justify-content-between align-items-center bg-light py-2">
        <span><strong>TOTAL VENTAS:</strong></span>
        <strong class="text-success">$${formatearMoneda(resumen.total_ventas)}</strong>
      </div>`;

    // EGRESOS: solo se muestra la sección si hubo alguno.
    if (Number(resumen.cantidad_egresos) > 0) {
      html += `<div class="list-group-item bg-light py-1 small font-weight-bold text-uppercase">
                 Egresos del día <span class="text-muted font-weight-normal">(${resumen.cantidad_egresos} mov.)</span></div>`;

      // Función ayudante: agrega una línea de egreso solo si el monto es mayor a cero.
      const lineaEgreso = (texto, monto) => Number(monto) > 0 ? `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
          <span>${texto}</span>
          <span class="font-weight-bold text-danger">-$${formatearMoneda(monto)}</span>
        </div>` : '';

      html += lineaEgreso('Gastos y pagos en efectivo', resumen.gastos_efectivo);
      html += lineaEgreso('Gastos y pagos por banco / otros medios <small class="text-muted">(no salen de la caja)</small>', resumen.gastos_banco);
      html += lineaEgreso('Retiros de efectivo', resumen.retiros_efectivo);
    }

    // MOVIMIENTO POR CUENTA: dónde quedó la plata del día.
    // La clave "cuentas" la calcula la base (script 12); si todavía no existe, no se muestra nada.
    html += htmlMovimientoCuentas((resumen.cuentas || []).map(c => ({
      nombre: c.nombre, sinCuenta: c.id_cuenta === null, entra: c.entra, sale: c.sale, traspasos: c.traspasos, neto: c.neto
    })));

    // TRASPASOS DE EFECTIVO: depósitos al banco, extracciones y ajustes en la cuenta Efectivo.
    // Cambian el efectivo esperado (la plata ya no está en la caja, o volvió), por eso se muestran
    // en una línea aparte. Se ve solo si hubo alguno (la clave la calcula la base, script 15).
    const traspasosEfectivo = Number(resumen.traspasos_efectivo || 0);
    if (traspasosEfectivo !== 0) {
      html += `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
          <span>Traspasos y ajustes de efectivo <small class="text-muted">(depósitos, extracciones)</small></span>
          <span class="font-weight-bold ${traspasosEfectivo < 0 ? 'text-danger' : 'text-success'}">${traspasosEfectivo < 0 ? '-' : '+'}$${formatearMoneda(Math.abs(traspasosEfectivo))}</span>
        </div>`;
    }

    // Cómo se llega al efectivo esperado (el importe está en el banner de arriba).
    html += `
      <div class="list-group-item py-2 small text-muted">
        <strong>Efectivo esperado</strong> = ventas en efectivo − gastos en efectivo − retiros ± traspasos de efectivo
      </div>
    </div>`;

    // Banner con el efectivo esperado (siempre visible) + botón que despliega el detalle.
    contenedor.innerHTML = htmlBannerEsperado(resumen.efectivo_esperado) + `
      <button type="button" class="btn btn-link btn-sm p-0 mb-2" data-toggle="collapse"
              data-target="#detalle-dia-cierre" aria-expanded="false" aria-controls="detalle-dia-cierre">
        <i class="fas fa-chevron-down"></i> Ver detalle del día
      </button>
      <div class="collapse" id="detalle-dia-cierre">${html}</div>`;

    // Reinicia el formulario y muestra el efectivo esperado como pista.
    const inputEf = document.getElementById('input-efectivo-real');
    if (inputEf) inputEf.value = '';
    actualizarDiferenciaEfectivo();

  } catch (err) {
    console.error('Error al cargar el resumen de caja:', err);
    contenedor.innerHTML = `<div class="alert alert-danger">Error: ${esc(mensajeErrorFuncion(err, 'cierre'))}</div>`;
    alternarCamposFormulario(true);
    prepararPanelArqueo(true);
  }
}


// -----------------------------------------------------------------------------
// alternarCamposFormulario  (interna)
//   Habilita o deshabilita los campos del formulario de cierre.
//   Recibe: deshabilitar -> true para bloquearlos, false para habilitarlos.
// -----------------------------------------------------------------------------
function alternarCamposFormulario(deshabilitar) {
  const inputEf = document.getElementById('input-efectivo-real');
  const inputObs = document.getElementById('cierre-observaciones');
  const btnConf = document.getElementById('btn-confirmar-cierre');

  if (inputEf) inputEf.disabled = deshabilitar;
  if (inputObs) inputObs.disabled = deshabilitar;
  if (btnConf) btnConf.disabled = deshabilitar;

  const contDif = document.getElementById('contenedor-diferencia-efectivo');
  if (contDif && deshabilitar) contDif.innerHTML = '';
}


// -----------------------------------------------------------------------------
// actualizarDiferenciaEfectivo  (interna)
//   Compara el efectivo contado que se está escribiendo con el esperado y muestra
//   si hay sobrante, faltante o ninguna diferencia. Es solo informativo: la
//   diferencia que se guarda la calcula la base al cerrar.
// -----------------------------------------------------------------------------
function actualizarDiferenciaEfectivo() {
  const inputEf = document.getElementById('input-efectivo-real');
  const contDif = document.getElementById('contenedor-diferencia-efectivo');
  // Si no hay un cálculo cargado (nada para cerrar), no hay con qué comparar.
  if (!inputEf || !contDif || inputEf.disabled || !resumenCierreActual) return;

  const esperado = Number(resumenCierreActual.efectivo_esperado);
  const textoContado = inputEf.value.trim();

  if (textoContado === '') {
    contDif.innerHTML = '';   // el esperado ya se ve arriba: no se repite acá
    return;
  }

  // Math.round(x * 100) / 100 redondea a centavos: evita diferencias como
  // 0.30000000000000004 que aparecen al restar números con decimales en JavaScript.
  const dif = Math.round((Number(textoContado) - esperado) * 100) / 100;

  if (dif === 0) {
    contDif.innerHTML = `<span class="text-success">✔ Caja conforme (sin diferencia).</span>`;
  } else if (dif > 0) {
    contDif.innerHTML = `<span class="text-info">ℹ Sobrante de efectivo: +$${formatearMoneda(dif)}</span>`;
  } else {
    contDif.innerHTML = `<span class="text-danger">⚠️ Faltante de efectivo: -$${formatearMoneda(Math.abs(dif))}</span>`;
  }
}


// -----------------------------------------------------------------------------
// anularCierreCaja
//   Anula el cierre indicado y reabre la caja. Pide confirmación y un motivo.
//   Recibe: idCierre -> número del cierre.
//   La base se ocupa de liberar los egresos y de reabrir los cobros del día.
// -----------------------------------------------------------------------------
export async function anularCierreCaja(idCierre) {
  // Una sola ventana: avisa qué pasa al anular y pide el motivo (obligatorio).
  // confirmarAccion (utils.js) devuelve el texto escrito, o null si se cancela.
  const motivo = await confirmarAccion({
    titulo: 'Anular cierre de caja',
    mensaje: '¿Estás seguro de anular el cierre actual? Quedará registrado en el historial como ANULADO y podrás efectuar un nuevo cierre.',
    pedirMotivo: true,
    textoConfirmar: 'Anular cierre',
    peligro: true
  });
  if (!motivo) return;   // canceló: no se anula nada

  const { error } = await supabaseAdmin.rpc('anular_cierre', { p_id: idCierre, p_motivo: motivo });

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'cierre'), 'danger');
    return;
  }

  mostrarNotificacion('Cierre anulado. Ya podés realizar el nuevo arqueo.');
  actualizarIndicadorCaja();   // el encabezado vuelve a "Caja abierta"
  refrescarHistorialCierres();   // el historial (si ya estaba consultado) refleja la anulación
  await cargarResumenVentasDia();   // vuelve a calcular y mostrar el día
}


// =============================================================================
// 1b. ARQUEO DE TURNO  (script 43)
// =============================================================================
// Sirve para el cambio de turno: se cuenta el efectivo del cajón y se registra cuánto
// había contra cuánto esperaba el sistema. NO cierra la caja, NO mueve plata y NO bloquea
// nada: se puede seguir cobrando y cargando gastos. Los arqueos no se borran: el Dueño
// puede anular uno (con motivo). La diferencia que importa para el cierre es la del cierre.
//
// Funciones de la base: registrar_arqueo (Encargado y Dueño) y anular_arqueo (solo Dueño).
// La lista se lee directo de TB_TARQUEOS_CAJA (solo lectura para Encargado y Dueño).

const ZONA_HORARIA_AR = 'America/Argentina/Buenos_Aires';

// Hora (HH:MM) de un momento guardado en la base, siempre en hora de Argentina.
function horaDeArqueo(momentoISO) {
  const d = new Date(momentoISO);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA_HORARIA_AR });
}

// Importe con signo: +$1.500,00 / -$500,00 / $0,00 (redondeado a centavos).
function importeConSigno(n) {
  const v = Math.round(Number(n) * 100) / 100;
  if (v === 0) return '$' + formatearMoneda(0);
  return (v > 0 ? '+$' : '-$') + formatearMoneda(Math.abs(v));
}

// Texto con color para una diferencia (contado - esperado).
function htmlDiferenciaArqueo(dif) {
  const v = Math.round(Number(dif) * 100) / 100;
  if (v === 0) return '<span class="text-success">✔ sin diferencia</span>';
  if (v > 0) return `<span class="text-info">sobrante ${importeConSigno(v)}</span>`;
  return `<span class="text-danger">faltante ${importeConSigno(v)}</span>`;
}

// Habilita o bloquea el formulario del arqueo. Con la caja cerrada no hay nada que verificar.
function prepararPanelArqueo(cajaCerrada) {
  const input = document.getElementById('input-arqueo-efectivo');
  const obs = document.getElementById('arqueo-observaciones');
  const btn = document.getElementById('btn-registrar-arqueo');
  const aviso = document.getElementById('arqueo-aviso');
  const contDif = document.getElementById('contenedor-diferencia-arqueo');

  if (input) input.disabled = cajaCerrada;
  if (obs) obs.disabled = cajaCerrada;
  if (btn) btn.disabled = cajaCerrada;
  if (aviso) {
    aviso.innerHTML = cajaCerrada
      ? '<div class="alert alert-warning small py-2 mb-2">La caja de hoy está cerrada: ya no se pueden registrar arqueos. Abajo queda el historial del día.</div>'
      : '';
  }
  if (contDif && cajaCerrada) contDif.innerHTML = '';
  if (!cajaCerrada) actualizarDiferenciaArqueo();
}

// Mientras se escribe el efectivo contado, muestra la diferencia contra lo esperado.
function actualizarDiferenciaArqueo() {
  const input = document.getElementById('input-arqueo-efectivo');
  const contDif = document.getElementById('contenedor-diferencia-arqueo');
  if (!input || !contDif || input.disabled || esperadoArqueo === null) return;

  const texto = input.value.trim();
  if (texto === '') {
    contDif.innerHTML = '';   // el esperado ya se ve arriba: no se repite acá
    return;
  }
  const dif = Math.round((Number(texto) - esperadoArqueo) * 100) / 100;
  contDif.innerHTML = htmlDiferenciaArqueo(dif);
}

// Dibuja la lista de arqueos (la usan la solapa "Arqueo de turno" y el detalle de un cierre del historial).
//   arqueos        -> filas de TB_TARQUEOS_CAJA ya ordenadas de más viejo a más nuevo (activos y anulados)
//   permitirAnular -> true muestra el botón "Anular" en los activos (solo en la solapa y solo para el Dueño)
// La "variación" compara la diferencia de cada arqueo con la del arqueo ACTIVO anterior: muestra
// cuánto cambió entre un turno y otro.
function htmlListaArqueos(arqueos, { permitirAnular = false } = {}) {
  let difAnterior = null;       // diferencia del último arqueo activo ya dibujado
  let horaAnterior = '';

  return '<div class="list-group">' + arqueos.map(a => {
    const anulado = a.estado !== 'ACTIVO';
    const hora = horaDeArqueo(a.created_at);
    const dif = Number(a.diferencia);

    // Variación contra el arqueo activo anterior (solo para los activos).
    let lineaVariacion = '';
    if (!anulado) {
      if (difAnterior !== null) {
        const v = Math.round((dif - difAnterior) * 100) / 100;
        const clase = v === 0 ? 'text-muted' : (v > 0 ? 'text-success' : 'text-danger');
        lineaVariacion = `<div class="small ${clase}" title="Cuánto cambió la diferencia respecto del arqueo anterior">Variación desde el arqueo de las ${esc(horaAnterior)}: <strong>${importeConSigno(v)}</strong></div>`;
      }
      difAnterior = dif;
      horaAnterior = hora;
    }

    return `
      <div class="list-group-item py-2 ${anulado ? 'text-muted' : ''}">
        <div class="d-flex justify-content-between align-items-center">
          <span><strong>${esc(hora)}</strong>
            <small class="text-muted">${a.usuario ? '· ' + esc(a.usuario) : ''}</small>
            ${anulado ? '<span class="badge badge-danger ml-1">ANULADO</span>' : ''}</span>
          ${!anulado && permitirAnular ? `<button type="button" class="btn btn-sm btn-outline-danger py-0" data-arqueo-anular="${a.id}" title="Anular este arqueo"><i class="fas fa-ban"></i> Anular</button>` : ''}
        </div>
        <div class="small" style="${anulado ? 'text-decoration: line-through;' : ''}">
          Esperado <strong>$${formatearMoneda(a.efectivo_sistema)}</strong> ·
          Contado <strong>$${formatearMoneda(a.efectivo_real)}</strong> ·
          ${htmlDiferenciaArqueo(dif)}
        </div>
        ${lineaVariacion}
        ${a.observaciones ? `<div class="small text-muted" style="white-space: pre-line;">${esc(a.observaciones)}</div>` : ''}
        ${anulado && a.motivo_anulacion ? `<div class="small text-danger">Motivo de anulación: ${esc(a.motivo_anulacion)}</div>` : ''}
      </div>`;
  }).join('') + '</div>';
}


// Trae los arqueos de hoy y los dibuja (del más viejo al más nuevo: orden de turnos).
async function cargarArqueosDia() {
  const lista = document.getElementById('lista-arqueos');
  const contador = document.getElementById('arqueo-contador');
  if (!lista) return;

  const miCarga = ++contadorCargaArqueos;
  lista.innerHTML = '<div class="text-center text-muted small py-2"><span class="spinner-border spinner-border-sm"></span> Cargando arqueos...</div>';

  const { data, error } = await supabaseAdmin
    .from('TB_TARQUEOS_CAJA')
    .select('id, efectivo_sistema, efectivo_real, diferencia, observaciones, estado, motivo_anulacion, usuario, created_at')
    .eq('fecha', obtenerFechaActualISO())
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (miCarga !== contadorCargaArqueos) return;   // llegó una carga más nueva

  if (error) {
    lista.innerHTML = `<div class="text-danger small py-2">No se pudieron cargar los arqueos: ${esc(mensajeErrorBD(error))}</div>`;
    return;
  }

  const arqueos = data || [];
  const activos = arqueos.filter(a => a.estado === 'ACTIVO');
  if (contador) contador.innerText = String(activos.length);

  if (arqueos.length === 0) {
    lista.innerHTML = '<div class="text-muted small py-2">Todavía no se registró ningún arqueo hoy.</div>';
    return;
  }

  lista.innerHTML = htmlListaArqueos(arqueos, { permitirAnular: puedeAlMenos('DUENO') });
}

// Botón "Registrar arqueo".
async function registrarArqueo() {
  const input = document.getElementById('input-arqueo-efectivo');
  const obsInput = document.getElementById('arqueo-observaciones');
  const btn = document.getElementById('btn-registrar-arqueo');
  if (!input || !btn || input.disabled) return;

  const texto = input.value.trim();
  const contado = Number(texto);
  if (texto === '' || !isFinite(contado) || contado < 0) {
    mostrarNotificacion('Ingresá el efectivo contado en el cajón (un importe válido, sin negativos).', 'warning');
    input.focus();
    return;
  }

  // El esperado que se muestra es el de cuando se abrió la ventana; la base lo recalcula al registrar.
  const detalleDif = esperadoArqueo === null ? '' :
    ` El sistema esperaba $${formatearMoneda(esperadoArqueo)}.`;
  const ok = await confirmarAccion({
    titulo: 'Registrar arqueo',
    mensaje: `Vas a registrar un arqueo con $${formatearMoneda(contado)} contados.${detalleDif} No cierra la caja ni mueve plata.`,
    textoConfirmar: 'Registrar arqueo'
  });
  if (!ok) return;

  btn.disabled = true;
  btn.innerText = 'Registrando...';
  try {
    const { data, error } = await supabaseAdmin.rpc('registrar_arqueo', {
      p_efectivo_real: contado,
      p_observaciones: obsInput?.value.trim() || null
    });
    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'arqueo'), 'danger');
      // Si la caja se cerró mientras tanto, se refresca para que el panel quede bloqueado.
      if ((error.message || '').includes('caja_ya_cerrada')) await cargarResumenVentasDia();
      return;
    }

    // Lo que cuenta es lo que calculó la base.
    const dif = Number(data.diferencia);
    let mensaje = 'Arqueo registrado: ' + (dif === 0 ? 'sin diferencia'
      : (dif > 0 ? `sobrante de $${formatearMoneda(dif)}` : `faltante de $${formatearMoneda(Math.abs(dif))}`));
    const variacion = data.variacion === null || data.variacion === undefined ? null : Number(data.variacion);
    if (variacion !== null && variacion !== 0) {
      mensaje += `. Cambió ${importeConSigno(variacion)} desde el arqueo anterior`;
    }
    mostrarNotificacion(mensaje);

    input.value = '';
    if (obsInput) obsInput.value = '';
    await cargarResumenVentasDia();   // refresca el esperado y la lista de arqueos
  } catch (err) {
    console.error('Error al registrar el arqueo:', err);
    mostrarNotificacion('No se pudo registrar el arqueo. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    btn.innerText = 'Registrar arqueo';
    // Si la caja se cerró mientras tanto, cargarResumenVentasDia ya lo dejó bloqueado.
    if (esperadoArqueo !== null) btn.disabled = false;
  }
}

// Anular un arqueo (solo Dueño): pide motivo. No se borra, queda marcado como ANULADO.
async function anularArqueo(idArqueo) {
  const motivo = await confirmarAccion({
    titulo: 'Anular arqueo',
    mensaje: '¿Anular este arqueo? Queda en el historial como ANULADO y deja de contar para la variación entre turnos.',
    pedirMotivo: true,
    textoConfirmar: 'Anular arqueo',
    peligro: true
  });
  if (!motivo) return;

  const { error } = await supabaseAdmin.rpc('anular_arqueo', { p_id: idArqueo, p_motivo: motivo });
  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'arqueo'), 'danger');
    return;
  }
  mostrarNotificacion('Arqueo anulado.');
  await cargarArqueosDia();
}


// -----------------------------------------------------------------------------
// inicializarCierreCaja
//   Conecta los eventos de la ventana de cierre. main.js la ejecuta una sola vez
//   al cargar la página.
// -----------------------------------------------------------------------------
export function inicializarCierreCaja() {
  // Cada vez que la ventana empieza a abrirse, se recalcula el resumen del día.
  $('#modalCierreCaja').on('show.bs.modal', function () {
    // El formulario del arqueo arranca limpio (el panel queda cerrado, como en el HTML).
    const inputArq = document.getElementById('input-arqueo-efectivo');
    const obsArq = document.getElementById('arqueo-observaciones');
    if (inputArq) inputArq.value = '';
    if (obsArq) obsArq.value = '';
    $('#tab-link-cierre').tab('show');   // la ventana siempre abre en "Cerrar caja"
    cargarResumenVentasDia();
  });

  // Arqueo de turno: diferencia en vivo, botón registrar y botón anular (uno por fila de la lista).
  document.getElementById('input-arqueo-efectivo')?.addEventListener('input', actualizarDiferenciaArqueo);
  document.getElementById('btn-registrar-arqueo')?.addEventListener('click', registrarArqueo);
  document.getElementById('lista-arqueos')?.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-arqueo-anular]');
    if (boton) anularArqueo(Number(boton.dataset.arqueoAnular));
  });

  // Mientras se escribe el efectivo contado, se muestra la diferencia.
  document.getElementById('input-efectivo-real')?.addEventListener('input', actualizarDiferenciaEfectivo);

  // Botón "Confirmar y cerrar caja".
  document.getElementById('btn-confirmar-cierre')?.addEventListener('click', async () => {
    const inputEf = document.getElementById('input-efectivo-real');

    if (!resumenCierreActual) {
      mostrarNotificacion('No hay nada para cerrar.', 'warning');
      return;
    }
    if (!inputEf || inputEf.value.trim() === '') {
      mostrarNotificacion('Por favor ingresá la cantidad de efectivo real contado en caja.', 'warning');
      inputEf?.focus();
      return;
    }
    // Ventana propia de confirmación (se abre encima de la ventana de cierre).
    const ok = await confirmarAccion({
      titulo: 'Cerrar caja',
      mensaje: '¿Estás seguro de confirmar y cerrar la caja diaria?',
      textoConfirmar: 'Sí, cerrar caja'
    });
    if (!ok) return;

    const btn = document.getElementById('btn-confirmar-cierre');
    btn.disabled = true;
    btn.innerText = 'Guardando cierre...';

    const efectivoReal = Number(inputEf.value);
    const obs = document.getElementById('cierre-observaciones')?.value.trim() || null;

    try {
      // UNA sola llamada: la función cerrar_caja guarda la cabecera, el detalle por
      // medio de pago y la vinculación de los egresos, todo junto. Si algo falla,
      // no se guarda nada. Los nombres p_... son los parámetros de la función (script 07).
      const { data, error } = await supabaseAdmin.rpc('cerrar_caja', {
        p_fecha: obtenerFechaActualISO(),
        p_efectivo_real: efectivoReal,
        p_observaciones: obs
      });

      if (error) {
        mostrarNotificacion(mensajeErrorFuncion(error, 'cierre'), 'danger');
        return;
      }

      // "data" trae lo que calculó la base: la diferencia que cuenta es la del servidor.
      const dif = Number(data.diferencia);
      const textoDif = dif === 0 ? 'sin diferencia'
        : (dif > 0 ? `sobrante de $${formatearMoneda(dif)}` : `faltante de $${formatearMoneda(Math.abs(dif))}`);

      mostrarNotificacion(`¡Cierre de caja guardado con éxito! (${textoDif})`);
      actualizarIndicadorCaja();   // el encabezado pasa a "Caja cerrada"
      refrescarHistorialCierres();   // el historial (si ya estaba consultado) muestra el cierre nuevo
      $('#modalCierreCaja').modal('hide');

    } catch (err) {
      console.error('Error al guardar el cierre de caja:', err);
      mostrarNotificacion('No se pudo guardar el cierre. Revisá tu conexión e intentá de nuevo.', 'danger');
    } finally {
      // Se ejecuta siempre: el botón vuelve a quedar como estaba.
      btn.disabled = false;
      btn.innerText = 'CONFIRMAR Y CERRAR CAJA';
    }
  });
}


// =============================================================================
// 2. HISTORIAL DE CIERRES
// =============================================================================

// -----------------------------------------------------------------------------
// inicializarHistorialCierres
//   Prepara el filtro (por defecto, el mes actual) y carga la tabla.
// -----------------------------------------------------------------------------
export async function inicializarHistorialCierres() {
  const inputDesde = document.getElementById('filtro-cierre-desde');
  const inputHasta = document.getElementById('filtro-cierre-hasta');

  const hoy = obtenerFechaActualISO();
  // hoy.slice(0, 8) toma los primeros 8 caracteres de 'AAAA-MM-DD' ('AAAA-MM-')
  // y le agregamos '01': el primer día del mes actual.
  const primerDiaMes = hoy.slice(0, 8) + '01';

  if (inputDesde && !inputDesde.value) inputDesde.value = primerDiaMes;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  await cargarTablaHistorialCierres();
}


// -----------------------------------------------------------------------------
// refrescarHistorialCierres  (interna)
//   Vuelve a cargar la tabla del historial después de cerrar o anular un cierre.
//   Solo si el historial ya se consultó (tiene las dos fechas puestas); si todavía no se
//   abrió, no hace falta: se carga solo al entrar a la sección. Sin "await": no frena nada.
// -----------------------------------------------------------------------------
function refrescarHistorialCierres() {
  const desde = document.getElementById('filtro-cierre-desde')?.value;
  const hasta = document.getElementById('filtro-cierre-hasta')?.value;
  if (desde && hasta) cargarTablaHistorialCierres();
}


// -----------------------------------------------------------------------------
// cargarTablaHistorialCierres
//   Trae los cierres del rango de fechas elegido y dibuja la tabla.
// -----------------------------------------------------------------------------
export async function cargarTablaHistorialCierres() {
  const contenedor = document.getElementById('tabla-historial-cierres-body');
  if (!contenedor) return;

  const desde = document.getElementById('filtro-cierre-desde')?.value;
  const hasta = document.getElementById('filtro-cierre-hasta')?.value;

  if (!desde || !hasta) {
    mostrarNotificacion('Ingresá ambas fechas para consultar.', 'warning');
    return;
  }

  contenedor.innerHTML = `<tr><td colspan="7" class="text-center py-3"><span class="spinner-border spinner-border-sm"></span> Buscando cierres...</td></tr>`;

  try {
    // Además de la cabecera, se traen los datos de egresos y, para cada medio de
    // pago del cierre, sus montos (TB_DCIERRE_CAJA) con el nombre del medio.
    const { data: cierres, error } = await supabaseAdmin
      .from('TB_TCIERRE_CAJA')
      .select(`
        id, fecha, total_general, efectivo_sistema, efectivo_real, diferencia_efectivo,
        gastos_efectivo, gastos_banco, total_gastos, retiros_efectivo, observaciones, estado,
        TB_DCIERRE_CAJA (
          monto, egresos, saldo_neto, cantidad_transacciones, TB_BMEDIO_PAGO ( nombre )
        ),
        TB_DCIERRE_CUENTA (
          entra, sale, traspasos, neto, TB_BCUENTAS ( nombre, tipo )
        )
      `)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('id', { ascending: false });

    if (error) throw error;

    cierresCache = cierres || [];
    arqueosPorFecha = null;

    if (cierresCache.length === 0) {
      contenedor.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No se encontraron cierres entre ${esc(formatearFechaAR(desde))} y ${esc(formatearFechaAR(hasta))}.</td></tr>`;
      return;
    }

    contenedor.innerHTML = cierresCache.map(c => {
      const esCerrado = c.estado === 'CERRADO';
      const badgeClass = esCerrado ? 'badge-success' : 'badge-danger';
      const dif = Number(c.diferencia_efectivo || 0);
      // Operador ternario anidado: 0 -> neutro, positivo (sobrante) -> celeste, negativo -> rojo.
      const difClass = dif === 0 ? 'text-dark' : (dif > 0 ? 'text-info' : 'text-danger');

      return `
        <tr class="${esCerrado ? '' : 'text-muted'}">
          <td><span class="badge badge-secondary">#${c.id}</span></td>
          <td>${formatearFechaAR(c.fecha)}</td>
          <td><span class="badge ${badgeClass}">${esc(c.estado)}</span></td>
          <td class="text-right">$${formatearMoneda(c.total_general)}</td>
          <td class="text-right">$${formatearMoneda(c.efectivo_real)}</td>
          <td class="text-right ${difClass} font-weight-bold">$${formatearMoneda(dif)}</td>
          <td class="text-right">
            <button class="btn btn-accion btn-accion-ver" data-action="ver-detalle-cierre" data-id="${c.id}">
              <i class="fas fa-eye"></i> Ver detalle
            </button>
          </td>
        </tr>`;
    }).join('');

    // Arqueos del mismo rango, para mostrarlos en el detalle de cada cierre. Va aparte y sin frenar la
    // tabla: si falla, el historial se ve igual (solo sin esa sección).
    cargarArqueosDelRango(desde, hasta);

  } catch (err) {
    console.error('Error al cargar historial:', err);
    contenedor.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Error al obtener historial: ${esc(mensajeErrorBD(err))}</td></tr>`;
  }
}


// -----------------------------------------------------------------------------
// cargarArqueosDelRango  (interna)
//   Trae los arqueos de turno entre dos fechas y los guarda agrupados por fecha en "arqueosPorFecha".
//   Si falla (por ejemplo, sin permiso o sin conexión), deja null y el detalle no muestra la sección.
// -----------------------------------------------------------------------------
async function cargarArqueosDelRango(desde, hasta) {
  try {
    const { data, error } = await supabaseAdmin
      .from('TB_TARQUEOS_CAJA')
      .select('id, fecha, efectivo_sistema, efectivo_real, diferencia, observaciones, estado, motivo_anulacion, usuario, created_at')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;

    const porFecha = {};
    (data || []).forEach(a => { (porFecha[a.fecha] = porFecha[a.fecha] || []).push(a); });
    arqueosPorFecha = porFecha;
  } catch (err) {
    console.error('No se pudieron cargar los arqueos del historial:', err);
    arqueosPorFecha = null;
  }
}


// -----------------------------------------------------------------------------
// verDetalleCierre
//   Abre la ventana con el detalle de un cierre del historial.
//   Recibe: idCierre -> número del cierre.
// -----------------------------------------------------------------------------
export function verDetalleCierre(idCierre) {
  const cierre = cierresCache.find(c => Number(c.id) === Number(idCierre));
  if (!cierre) return;

  document.getElementById('titulo-modal-detalle-cierre').innerText =
    `Detalle Cierre #${cierre.id} (${formatearFechaAR(cierre.fecha)})`;

  const dif = Number(cierre.diferencia_efectivo || 0);

  // MOVIMIENTO POR CUENTA del cierre (lo guarda cerrar_caja, script 13). Los cierres hechos antes
  // no tienen estas filas: en ese caso la sección no se muestra.
  // Orden: Efectivo primero, "Sin cuenta" al final y el resto por nombre. Los "true/false" se
  // pueden restar (true = 1, false = 0): sirve para que el sort ponga primero a los que cumplen.
  const filasCuenta = [...(cierre.TB_DCIERRE_CUENTA || [])]
    .sort((a, b) =>
      (b.TB_BCUENTAS?.tipo === 'EFECTIVO') - (a.TB_BCUENTAS?.tipo === 'EFECTIVO')
      || (!a.TB_BCUENTAS) - (!b.TB_BCUENTAS)
      || String(a.TB_BCUENTAS?.nombre).localeCompare(String(b.TB_BCUENTAS?.nombre)))
    .map(d => ({
      nombre: d.TB_BCUENTAS?.nombre || 'Sin cuenta', sinCuenta: !d.TB_BCUENTAS,
      entra: d.entra, sale: d.sale, traspasos: d.traspasos, neto: d.neto
    }));
  const bloqueCuentas = filasCuenta.length > 0
    ? `<div class="list-group mb-3">${htmlMovimientoCuentas(filasCuenta)}</div>` : '';

  // ARQUEOS DE TURNO del día (script 43). Solo en el cierre vigente (CERRADO): si el cierre se anuló,
  // el día se reabrió y los arqueos se ven en el cierre nuevo. Solo lectura: acá no se anula nada.
  const arqueosDelDia = (cierre.estado === 'CERRADO' && arqueosPorFecha) ? (arqueosPorFecha[cierre.fecha] || []) : [];
  const bloqueArqueos = arqueosDelDia.length > 0
    ? `<div class="small font-weight-bold text-uppercase text-muted mb-1">Arqueos de turno del día</div>
       <div class="mb-3">${htmlListaArqueos(arqueosDelDia, { permitirAnular: false })}</div>` : '';

  // Una línea por medio de pago: ventas, y si hubo egresos, cuánto salió y el neto.
  let html = '<div class="list-group mb-3">';
  (cierre.TB_DCIERRE_CAJA || []).forEach(d => {
    const egresos = Number(d.egresos || 0);
    html += `
      <div class="list-group-item py-2">
        <div class="d-flex justify-content-between align-items-center">
          <span><strong>${esc(d.TB_BMEDIO_PAGO?.nombre || 'Medio Pago')}</strong> (${d.cantidad_transacciones} op.)</span>
          <span class="font-weight-bold">$${formatearMoneda(d.monto)}</span>
        </div>
        ${egresos > 0 ? `
          <div class="d-flex justify-content-between small text-muted">
            <span>Egresos: <span class="text-danger">-$${formatearMoneda(egresos)}</span></span>
            <span>Neto: <strong>$${formatearMoneda(d.saldo_neto)}</strong></span>
          </div>` : ''}
      </div>`;
  });

  html += `
      <div class="list-group-item d-flex justify-content-between align-items-center bg-light py-2">
        <span><strong>TOTAL VENTAS:</strong></span>
        <strong class="text-success">$${formatearMoneda(cierre.total_general)}</strong>
      </div>
    </div>

    ${bloqueCuentas}

    <div class="p-2 bg-light rounded mb-2 border">
      <small class="d-block"><strong>Gastos y pagos en efectivo:</strong> $${formatearMoneda(cierre.gastos_efectivo)}</small>
      <small class="d-block"><strong>Gastos y pagos por banco / otros:</strong> $${formatearMoneda(cierre.gastos_banco)}</small>
      <small class="d-block"><strong>Retiros de efectivo:</strong> $${formatearMoneda(cierre.retiros_efectivo)}</small>
      <small class="d-block"><strong>Efectivo esperado:</strong> $${formatearMoneda(cierre.efectivo_sistema)}</small>
      <small class="d-block"><strong>Efectivo contado:</strong> $${formatearMoneda(cierre.efectivo_real)}</small>
      <small class="d-block"><strong>Diferencia caja:</strong>
        <span class="${dif < 0 ? 'text-danger' : 'text-success'} font-weight-bold">$${formatearMoneda(dif)}</span></small>
      <small class="d-block text-muted" style="white-space: pre-line;"><strong>Observaciones:</strong> ${esc(cierre.observaciones) || 'Sin observaciones'}</small>
    </div>

    ${bloqueArqueos}
  `;

  document.getElementById('body-modal-detalle-cierre').innerHTML = html;
  $('#modalDetalleCierre').modal('show');
}

// =============================================================================
// 3. INDICADOR "CAJA ABIERTA / CERRADA" DEL ENCABEZADO
// =============================================================================

// -----------------------------------------------------------------------------
// actualizarIndicadorCaja
//   Le pregunta a la base si la caja de HOY está cerrada (usa la misma función
//   resumen_caja que la ventana de cierre) y pinta el indicador del encabezado.
//   Si la consulta falla (sin conexión, sesión vencida), muestra "Caja…" en gris
//   en vez de afirmar algo que no sabemos.
// -----------------------------------------------------------------------------
export async function actualizarIndicadorCaja() {
  const indicador = document.getElementById('nav-estado-caja');
  const texto = document.getElementById('nav-estado-caja-texto');
  if (!indicador || !texto) return;

  let estado = 'desconocida';
  try {
    // caja_cerrada devuelve solo true/false: sirve para cualquier rol (resumen_caja trae importes y es de Encargado).
    const { data, error } = await supabaseAdmin.rpc('caja_cerrada', { p_fecha: obtenerFechaActualISO() });
    if (error) throw error;
    estado = data ? 'cerrada' : 'abierta';
  } catch (err) {
    console.error('No se pudo consultar el estado de la caja:', err);
  }

  // classList.remove / add cambian las clases CSS del elemento sin tocar el resto.
  indicador.classList.remove('is-abierta', 'is-cerrada', 'is-desconocida');
  indicador.classList.add('is-' + estado);
  texto.innerText = estado === 'abierta' ? 'Caja abierta'
                  : estado === 'cerrada' ? 'Caja cerrada'
                  : 'Caja…';
}
