// =============================================================================
// reporteCompras.js  ·  REPORTES DE COMPRAS (Chat C, script 28)
// =============================================================================
//
// QUÉ HACE
//   Pantalla con dos solapas:
//     1) GASTO: cuánto se gastó en un período, agrupado por insumo, rubro
//        (categoría del insumo) o proveedor, con porcentaje y barra.
//     2) EVOLUCIÓN DE PRECIOS: historial de precios de compra de UN insumo, con
//        un gráfico de línea, precio mínimo / máximo / último y variación.
//
// DE DÓNDE SALEN LOS DATOS
//   De dos funciones de la base (script 28) que agrupan y ordenan en el servidor:
//     - reporte_compras_gasto(p_desde, p_hasta, p_agrupar)
//     - reporte_compras_precios(p_id_insumo, p_desde, p_hasta)
//   Solo cuentan las compras ACTIVAS (las anuladas no suman) y el gasto se mide
//   por FECHA DE LA COMPRA, no por fecha de pago. Esta pantalla solo LEE.
//
// CÓMO SE CONECTA
//   - index.html: sección "sec-reportes-compras" (ids que empiezan con "rc-").
//   - main.js: importa inicializarReporteCompras y la llama desde navegarA.
//   - Los clics (solapas, botón Generar) los atiende ESTE archivo con delegación
//     sobre "document", igual que categorias.js: main.js no necesita listeners.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorFuncion,
  formatearMoneda, formatearFechaAR, obtenerFechaActualISO, sumarDiasISO
} from './utils.js';


// Nombres legibles de cada forma de agrupar (la clave es lo que entiende la base).
const AGRUPACIONES = {
  insumo:    'Insumo',
  rubro:     'Rubro',
  proveedor: 'Proveedor'
};

// Solapa que se está viendo: 'gasto' o 'precios'.
let pestanaActiva = 'gasto';

// "Número de pedido": cada vez que se pide un reporte se sube. Si una respuesta
// vieja llega tarde (el usuario ya pidió otra cosa), se descarta comparando números.
let numeroPedido = 0;


// -----------------------------------------------------------------------------
// Ayudantes de formato (internos)
// -----------------------------------------------------------------------------

// Porcentaje con 1 decimal, formato argentino. Ejemplo: 12.5 -> '12,5 %'
function formatearPorcentaje(n) {
  return Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }) + ' %';
}

// Variación con signo. Ejemplo: 12.34 -> '+12,3 %'  |  -5 -> '-5,0 %'
// En compras, que el precio SUBA es malo (rojo) y que BAje es bueno (verde).
function htmlVariacion(porcentaje) {
  if (porcentaje === null || !isFinite(porcentaje)) return '<span class="text-muted">-</span>';
  const signo = porcentaje > 0 ? '+' : '';
  const clase = porcentaje > 0 ? 'text-danger' : (porcentaje < 0 ? 'text-success' : 'text-muted');
  return `<span class="${clase} font-weight-bold">${signo}${formatearPorcentaje(porcentaje)}</span>`;
}

// Una "tarjetita" de indicador (título arriba, valor grande, texto chico abajo).
// "valorHtml" ya viene armado y escapado por quien llama.
function tarjetaKpi(titulo, valorHtml, subtexto) {
  return `
    <div class="col-6 col-md-4 col-lg-2 mb-2">
      <div class="border rounded p-2 text-center bg-white h-100">
        <div class="small text-muted">${esc(titulo)}</div>
        <div class="h5 mb-0 font-weight-bold">${valorHtml}</div>
        <div class="small text-muted">${subtexto || '&nbsp;'}</div>
      </div>
    </div>`;
}


// -----------------------------------------------------------------------------
// leerFiltroFechas  (interna)
//   Devuelve { desde, hasta } o null si algo está mal (y avisa al usuario).
// -----------------------------------------------------------------------------
function leerFiltroFechas() {
  const desde = document.getElementById('rc-desde')?.value;
  const hasta = document.getElementById('rc-hasta')?.value;

  if (!desde || !hasta) {
    mostrarNotificacion('Elegí las fechas Desde y Hasta.', 'warning');
    return null;
  }
  // Las fechas en formato AAAA-MM-DD se pueden comparar como texto.
  if (desde > hasta) {
    mostrarNotificacion('La fecha Desde no puede ser posterior a la fecha Hasta.', 'warning');
    return null;
  }
  return { desde, hasta };
}


// -----------------------------------------------------------------------------
// cargarSelectInsumos  (interna)
//   Llena el desplegable de la solapa Precios con TODOS los insumos (también los
//   inactivos: pueden tener compras históricas). Conserva el insumo elegido.
// -----------------------------------------------------------------------------
async function cargarSelectInsumos() {
  const select = document.getElementById('rc-insumo');
  if (!select) return;

  const { data, error } = await supabaseAdmin
    .from('TB_BINSUMOS')
    .select('id, nombre, unidad_medida, activo')
    .order('nombre', { ascending: true });

  if (error) return; // si falla, el desplegable queda como estaba

  const elegido = select.value;
  select.innerHTML = '<option value="">-- Elegí un insumo --</option>' +
    (data || []).map(i =>
      `<option value="${i.id}">${esc(i.nombre)} (${esc(i.unidad_medida)})${i.activo ? '' : ' - inactivo'}</option>`
    ).join('');
  select.value = elegido;
}


// -----------------------------------------------------------------------------
// inicializarReporteCompras  (EXPORTADA: la llama main.js al entrar a la pantalla)
//   Propone las fechas la primera vez (últimos 90 días), carga los insumos y
//   genera el reporte de la solapa activa.
// -----------------------------------------------------------------------------
export async function inicializarReporteCompras() {
  const inputDesde = document.getElementById('rc-desde');
  const inputHasta = document.getElementById('rc-hasta');

  if (inputDesde && !inputDesde.value) {
    const hoy = obtenerFechaActualISO();
    inputDesde.value = sumarDiasISO(hoy, -90);
    inputHasta.value = hoy;
  }

  await cargarSelectInsumos();
  await generarReporte(false);
}


// -----------------------------------------------------------------------------
// cambiarPestana  (interna)
//   Cambia entre Gasto y Precios: marca la solapa, muestra su panel y los filtros
//   que le corresponden (Agrupar por / Insumo), y regenera el reporte.
// -----------------------------------------------------------------------------
function cambiarPestana(nombre) {
  pestanaActiva = nombre;

  // La solapa elegida queda "active"; las otras no.
  document.querySelectorAll('[data-rc-tab]').forEach(a => {
    a.classList.toggle('active', a.dataset.rcTab === nombre);
  });

  // classList.toggle('d-none', condición): oculta cuando la condición es verdadera.
  document.getElementById('rc-panel-gasto')?.classList.toggle('d-none', nombre !== 'gasto');
  document.getElementById('rc-panel-precios')?.classList.toggle('d-none', nombre !== 'precios');
  document.getElementById('rc-grupo-agrupar')?.classList.toggle('d-none', nombre !== 'gasto');
  document.getElementById('rc-grupo-insumo')?.classList.toggle('d-none', nombre !== 'precios');

  generarReporte(false);
}


// -----------------------------------------------------------------------------
// generarReporte  (interna)
//   Genera el reporte de la solapa activa.
//   Recibe: avisar -> true si lo pidió el usuario con el botón (se muestran los
//   avisos); false si es automático (al entrar o cambiar de solapa).
// -----------------------------------------------------------------------------
async function generarReporte(avisar) {
  if (pestanaActiva === 'gasto') {
    await generarGasto();
  } else {
    await generarPrecios(avisar);
  }
}


// =============================================================================
// SOLAPA 1: GASTO
// =============================================================================
async function generarGasto() {
  const cuerpo = document.getElementById('rc-gasto-body');
  const pie = document.getElementById('rc-gasto-pie');
  const resumen = document.getElementById('rc-gasto-resumen');
  if (!cuerpo) return;

  const fechas = leerFiltroFechas();
  if (!fechas) return;

  const agrupar = document.getElementById('rc-agrupar')?.value || 'insumo';

  // El encabezado de la primera columna cambia según cómo se agrupe.
  const th = document.getElementById('rc-gasto-th-nombre');
  if (th) th.textContent = AGRUPACIONES[agrupar] || 'Grupo';

  cuerpo.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Cargando...</td></tr>';
  if (pie) pie.innerHTML = '';
  if (resumen) resumen.innerHTML = '';

  const miPedido = ++numeroPedido;
  const { data, error } = await supabaseAdmin.rpc('reporte_compras_gasto', {
    p_desde: fechas.desde,
    p_hasta: fechas.hasta,
    p_agrupar: agrupar
  });
  if (miPedido !== numeroPedido) return; // llegó tarde: el usuario ya pidió otra cosa

  if (error) {
    cuerpo.innerHTML = `<tr><td colspan="5" class="text-danger text-center">${esc(mensajeErrorFuncion(error, 'reporte'))}</td></tr>`;
    return;
  }

  const filas = data || [];
  if (filas.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No hay compras en ese período.</td></tr>';
    return;
  }

  // Total del período = suma de los grupos (cada línea de compra cae en un solo grupo).
  const total = filas.reduce((acc, f) => acc + Number(f.r_total || 0), 0);

  cuerpo.innerHTML = filas.map((f, i) => {
    // Ancho de la barra: el porcentaje, acotado entre 0 y 100 por seguridad.
    const ancho = Math.min(100, Math.max(0, Number(f.r_pct || 0)));
    return `
      <tr>
        <td class="text-muted">${i + 1}</td>
        <td class="font-weight-bold">${esc(f.r_etiqueta)}</td>
        <td class="text-center">${Number(f.r_compras)}</td>
        <td class="text-right font-weight-bold">$${formatearMoneda(f.r_total)}</td>
        <td style="min-width: 170px">
          <div class="d-flex align-items-center">
            <div class="progress progress-sm flex-grow-1 mr-2">
              <div class="progress-bar bg-warning" style="width: ${ancho}%"></div>
            </div>
            <span class="small text-muted text-right" style="width: 60px">${formatearPorcentaje(f.r_pct)}</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Pie con el total. OJO: no se suma la columna "Compras" porque una misma compra
  // puede aparecer en varios grupos (ej.: una compra con 3 insumos distintos).
  if (pie) {
    pie.innerHTML = `
      <tr class="bg-light font-weight-bold">
        <td colspan="3" class="text-right">TOTAL DEL PERÍODO:</td>
        <td class="text-right text-success">$${formatearMoneda(total)}</td>
        <td></td>
      </tr>`;
  }
  if (resumen) {
    resumen.innerHTML = `${filas.length} ${esc((AGRUPACIONES[agrupar] || 'grupo').toLowerCase())}(s) · ` +
      `del ${formatearFechaAR(fechas.desde)} al ${formatearFechaAR(fechas.hasta)}`;
  }
}


// =============================================================================
// SOLAPA 2: EVOLUCIÓN DE PRECIOS
// =============================================================================

// -----------------------------------------------------------------------------
// armarGraficoPrecios  (interna)
//   Devuelve el HTML de un gráfico de línea hecho con SVG (sin librerías).
//   Recibe: filas -> lista de la base, de la compra más vieja a la más nueva.
//   El eje horizontal es PROPORCIONAL AL TIEMPO (dos compras muy separadas se ven
//   lejos) y el vertical va del precio mínimo al máximo, con un margen.
// -----------------------------------------------------------------------------
function armarGraficoPrecios(filas) {
  const ANCHO = 720, ALTO = 280;
  const MARGEN = { izq: 80, der: 20, arriba: 20, abajo: 40 };
  const w = ANCHO - MARGEN.izq - MARGEN.der;   // ancho útil del dibujo
  const h = ALTO - MARGEN.arriba - MARGEN.abajo; // alto útil del dibujo

  const xs = filas.map(f => new Date(`${f.r_fecha}T00:00:00`).getTime());
  const ys = filas.map(f => Number(f.r_precio));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);

  // Rango vertical: con margen del 10% para que los puntos no toquen los bordes.
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) {
    yMin = yMin * 0.9;
    yMax = (yMax * 1.1) || 1; // si el precio fuera 0, evita un rango de 0
  } else {
    const margen = (yMax - yMin) * 0.1;
    yMin -= margen;
    yMax += margen;
  }
  if (yMin < 0) yMin = 0;

  // Pasan un valor a una posición (en píxeles del dibujo).
  const posX = (x) => xMax === xMin ? MARGEN.izq + w / 2 : MARGEN.izq + ((x - xMin) / (xMax - xMin)) * w;
  const posY = (y) => MARGEN.arriba + h - ((y - yMin) / (yMax - yMin)) * h;

  // Líneas guía horizontales con su valor (4 niveles).
  let guias = '';
  for (let k = 0; k <= 3; k++) {
    const valor = yMin + ((yMax - yMin) * k) / 3;
    const y = posY(valor);
    guias += `
      <line x1="${MARGEN.izq}" y1="${y}" x2="${ANCHO - MARGEN.der}" y2="${y}" stroke="#dee2e6" stroke-width="1"/>
      <text x="${MARGEN.izq - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6c757d">$${formatearMoneda(valor)}</text>`;
  }

  // Línea que une los puntos (solo si hay al menos 2).
  const puntosLinea = filas.map((f, i) => `${posX(xs[i])},${posY(ys[i])}`).join(' ');
  const linea = filas.length >= 2
    ? `<polyline points="${puntosLinea}" fill="none" stroke="#d39e00" stroke-width="2.5" stroke-linejoin="round"/>`
    : '';

  // Un círculo por compra. El <title> es el "tooltip": aparece al pasar el mouse.
  const puntos = filas.map((f, i) => `
    <circle cx="${posX(xs[i])}" cy="${posY(ys[i])}" r="4.5" fill="#d39e00" stroke="#fff" stroke-width="1.5">
      <title>${esc(formatearFechaAR(f.r_fecha))} · ${esc(f.r_proveedor)} · $${formatearMoneda(f.r_precio)} / ${esc(f.r_unidad)}</title>
    </circle>`).join('');

  // Fechas de los extremos del eje horizontal.
  const yEtiqueta = ALTO - 12;
  const etiquetasX = filas.length === 1
    ? `<text x="${posX(xs[0])}" y="${yEtiqueta}" text-anchor="middle" font-size="11" fill="#6c757d">${esc(formatearFechaAR(filas[0].r_fecha))}</text>`
    : `<text x="${MARGEN.izq}" y="${yEtiqueta}" text-anchor="start" font-size="11" fill="#6c757d">${esc(formatearFechaAR(filas[0].r_fecha))}</text>
       <text x="${ANCHO - MARGEN.der}" y="${yEtiqueta}" text-anchor="end" font-size="11" fill="#6c757d">${esc(formatearFechaAR(filas[filas.length - 1].r_fecha))}</text>`;

  return `
    <svg viewBox="0 0 ${ANCHO} ${ALTO}" style="width: 100%; height: auto; max-height: 320px"
         role="img" aria-label="Evolución del precio de compra">
      ${guias}
      ${linea}
      ${puntos}
      ${etiquetasX}
    </svg>`;
}


async function generarPrecios(avisar) {
  const kpis = document.getElementById('rc-precios-kpis');
  const grafico = document.getElementById('rc-precios-grafico');
  const nota = document.getElementById('rc-precios-nota');
  const cuerpo = document.getElementById('rc-precios-body');
  if (!cuerpo) return;

  const idInsumo = document.getElementById('rc-insumo')?.value;

  // Sin insumo elegido: se muestra una guía (y un aviso solo si lo pidió el usuario).
  if (!idInsumo) {
    if (kpis) kpis.innerHTML = '';
    if (grafico) grafico.innerHTML = '';
    if (nota) nota.innerHTML = '';
    cuerpo.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Elegí un insumo para ver cómo cambió su precio de compra.</td></tr>';
    if (avisar) mostrarNotificacion('Elegí un insumo.', 'warning');
    return;
  }

  const fechas = leerFiltroFechas();
  if (!fechas) return;

  cuerpo.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Cargando...</td></tr>';
  if (kpis) kpis.innerHTML = '';
  if (grafico) grafico.innerHTML = '';
  if (nota) nota.innerHTML = '';

  const miPedido = ++numeroPedido;
  const { data, error } = await supabaseAdmin.rpc('reporte_compras_precios', {
    p_id_insumo: Number(idInsumo),
    p_desde: fechas.desde,
    p_hasta: fechas.hasta
  });
  if (miPedido !== numeroPedido) return;

  if (error) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${esc(mensajeErrorFuncion(error, 'reporte'))}</td></tr>`;
    return;
  }

  // La base devuelve de la más vieja a la más nueva.
  const filas = data || [];
  if (filas.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Ese insumo no tuvo compras en el período.</td></tr>';
    return;
  }

  // ---- Indicadores ----
  const precios = filas.map(f => Number(f.r_precio));
  const minimo = Math.min(...precios);
  const maximo = Math.max(...precios);
  const primera = filas[0];
  const ultima = filas[filas.length - 1];
  const unidad = ultima.r_unidad;

  // Variación entre la primera y la última compra del período (null si el primer precio es 0).
  const variacion = Number(primera.r_precio) > 0
    ? ((Number(ultima.r_precio) - Number(primera.r_precio)) / Number(primera.r_precio)) * 100
    : null;

  // Precio promedio PONDERADO por cantidad: total gastado / total comprado.
  // (Una compra de 100 kg pesa más que una de 2 kg.)
  const cantidadTotal = filas.reduce((acc, f) => acc + Number(f.r_cantidad), 0);
  const montoTotal = filas.reduce((acc, f) => acc + Number(f.r_cantidad) * Number(f.r_precio), 0);
  const promedio = cantidadTotal > 0 ? montoTotal / cantidadTotal : 0;

  if (kpis) {
    kpis.innerHTML =
      tarjetaKpi('Último precio', `$${formatearMoneda(ultima.r_precio)}`, `${esc(formatearFechaAR(ultima.r_fecha))} · por ${esc(unidad)}`) +
      tarjetaKpi('Mínimo', `<span class="text-success">$${formatearMoneda(minimo)}</span>`, `por ${esc(unidad)}`) +
      tarjetaKpi('Máximo', `<span class="text-danger">$${formatearMoneda(maximo)}</span>`, `por ${esc(unidad)}`) +
      tarjetaKpi('Promedio ponderado', `$${formatearMoneda(promedio)}`, `por ${esc(unidad)}`) +
      tarjetaKpi('Variación', htmlVariacion(variacion), 'primera vs última') +
      tarjetaKpi('Compras', `${filas.length}`, `${Number(cantidadTotal.toFixed(3))} ${esc(unidad)} en total`);
  }

  // ---- Gráfico ----
  if (grafico) grafico.innerHTML = armarGraficoPrecios(filas);
  if (nota) {
    nota.innerHTML = filas.length === 1
      ? 'Hay una sola compra en el período: con una compra no se puede dibujar una línea. Ampliá las fechas.'
      : 'Pasá el mouse (o tocá) un punto para ver la fecha, el proveedor y el precio.';
  }

  // ---- Tabla: de la más nueva a la más vieja, con el cambio contra la compra anterior ----
  const conCambio = filas.map((f, i) => {
    const anterior = i > 0 ? Number(filas[i - 1].r_precio) : 0;
    const cambio = i > 0 && anterior > 0 ? ((Number(f.r_precio) - anterior) / anterior) * 100 : null;
    return { ...f, cambio };
  }).reverse();

  cuerpo.innerHTML = conCambio.map(f => `
    <tr>
      <td>${formatearFechaAR(f.r_fecha)}</td>
      <td><span class="badge badge-secondary">#${f.r_id_compra}</span></td>
      <td>${esc(f.r_proveedor)}</td>
      <td class="text-center">${Number(f.r_cantidad)} ${esc(f.r_unidad)}</td>
      <td class="text-right font-weight-bold">$${formatearMoneda(f.r_precio)}</td>
      <td class="text-right">${htmlVariacion(f.cambio)}</td>
    </tr>`).join('');
}


// =============================================================================
// EVENTOS (delegación sobre document: el módulo se engancha solo al importarse)
// =============================================================================
document.addEventListener('click', (e) => {
  // Solapas Gasto / Precios.
  const solapa = e.target.closest('[data-rc-tab]');
  if (solapa) {
    e.preventDefault(); // los links son href="#": evitamos que la página salte
    cambiarPestana(solapa.dataset.rcTab);
    return;
  }
  // Botón "Generar".
  if (e.target.closest('#btn-rc-generar')) {
    generarReporte(true);
  }
});

// Cambiar el "Agrupar por" o el insumo regenera solo, sin apretar el botón.
document.addEventListener('change', (e) => {
  if (e.target.id === 'rc-agrupar' || e.target.id === 'rc-insumo') {
    generarReporte(false);
  }
});
