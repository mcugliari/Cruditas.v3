import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, obtenerFechaActualISO, esc, mensajeErrorFuncion } from './utils.js';

// =============================================================================
// Ventas por Período (pantalla #sec-ventas-periodo)
//   Etapa 1: solapa "Por medio de pago" -> función ventas_por_medio_pago (script 66).
//   Etapa 2: solapa "Por día, semana y mes", vista Cobrado (plata) -> función ventas_por_periodo (script 67).
//   Etapa 3: la misma solapa suma la vista Entregado (cantidades, sin importes) -> función entregas_por_periodo (script 68).
//            Cobrado y Entregado no se mezclan: la plata va por fecha de pago y las unidades por fecha de entrega (D29/D30).
//   Etapa 4: selector "Grupo" (cómo se suman las ventas; ej.: EMPANADAS incluye las canastitas) en las dos vistas -> parámetro p_grupo (script 69).
//            Vocabulario en pantalla (desde el 26/11/2026): "Sección" = dónde se muestra la categoría al tomar el pedido (columna grupo);
//            "Grupo" = cómo se suman las ventas (grupo_caja / grupo_recuento). Los nombres técnicos de la base no cambian.
//            Con "Todos los grupos" se suma una tabla con una fila por grupo (resumen_grupos_cobrado / _entregado).
//   Etapa 5: "Comparativo por grupo y período": una columna por grupo para comparar, por ejemplo, las unidades de
//            empanadas de una semana contra otra. No usa funciones nuevas: pide el mismo reporte filtrado por cada grupo.
//   Las próximas solapas (día/semana/mes, canal, día de semana y hora) se suman acá, cada una con su función.
//
// Criterio de fecha: la del PAGO (igual que la solapa "Cobrado" de Ventas por Producto).
//   Los cobros suman, las devoluciones restan el día en que ocurren y los traspasos no se cuentan
//   (su efecto neto sobre un medio de pago es cero).
// =============================================================================

// Formato propio de este reporte (mismo criterio que reporteVentas.js): siempre 2 decimales, coma decimal.
// Es solo de pantalla; los valores que llegan de la base no se modifican.
// El signo va antes del $ (-$30.500,00), no en el medio ($-30.500,00).
const formatearPesos = (n) => {
  // Se redondea primero: un -0,0000001 de la base no debe verse como "-$0,00".
  const valor = Math.round(Number(n || 0) * 100) / 100;
  const texto = Math.abs(valor).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (valor < 0 ? '-$' : '$') + texto;
};
const formatearPorcentaje = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';

let eventosEnlazados = false;

// Entrada desde el menú (main.js, navegarA). Deja las fechas en "hoy" la primera vez y consulta.
export async function inicializarVentasPeriodo() {
  enlazarEventos();

  const hoy = obtenerFechaActualISO(); // fecha de Argentina, no UTC
  const inputDesde = document.getElementById('filtro-per-fecha-desde');
  const inputHasta = document.getElementById('filtro-per-fecha-hasta');
  if (inputDesde && !inputDesde.value) inputDesde.value = hoy;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  if (vistaActual === 'PERIODO') cargarGruposRecuento();
  await consultarVistaActiva();
}

// El botón "Filtrar" se enlaza una sola vez (la pantalla se inicializa cada vez que se entra).
function enlazarEventos() {
  if (eventosEnlazados) return;
  eventosEnlazados = true;
  document.getElementById('btn-filtrar-ventas-periodo')?.addEventListener('click', consultarVistaActiva);

  // Solapas: cada una tiene su panel y su función SQL (atributo data-vista).
  document.querySelectorAll('#tabs-ventas-periodo a[data-vista]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      cambiarVista(a.dataset.vista);
    });
  });

  // Vistas internas de la solapa "Por día, semana y mes": Cobrado / Entregado.
  document.querySelectorAll('#subtabs-ventas-periodo a[data-subvista]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      cambiarSubVista(a.dataset.subvista);
    });
  });
}

// Vista (solapa) activa. Arranca en "Por medio de pago", como antes.
let vistaActual = 'MEDIO_PAGO';
// Vista interna de la solapa por período: 'COBRADO' (por defecto) o 'ENTREGADO'.
let subVistaActual = 'COBRADO';

function cambiarVista(vista) {
  if (vista === vistaActual) return;
  vistaActual = vista;

  document.querySelectorAll('#tabs-ventas-periodo a[data-vista]').forEach(a => {
    const activa = a.dataset.vista === vista;
    a.classList.toggle('active', activa);
    a.setAttribute('aria-selected', String(activa));
  });
  document.getElementById('panel-per-medio')?.classList.toggle('d-none', vista !== 'MEDIO_PAGO');
  document.getElementById('panel-per-periodo')?.classList.toggle('d-none', vista !== 'PERIODO');
  // El selector "Agrupar por" solo tiene sentido en la solapa por período.
  document.getElementById('grupo-per-agrupar')?.classList.toggle('d-none', vista !== 'PERIODO');
  // El selector "Grupo" tampoco aplica a "Por medio de pago".
  document.getElementById('grupo-per-grupo')?.classList.toggle('d-none', vista !== 'PERIODO');
  if (vista === 'PERIODO') cargarGruposRecuento();
  // Las tarjetas de arriba son de la vista anterior: se limpian hasta que llegue la consulta nueva.
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (cont) cont.innerHTML = '';

  consultarVistaActiva();
}

// Consulta la solapa que está a la vista (comparten el rango de fechas).
async function consultarVistaActiva() {
  if (vistaActual === 'PERIODO') {
    if (subVistaActual === 'ENTREGADO') await generarEntregasPorPeriodo();
    else await generarVentasPorPeriodo();
  }
  else await generarVentasPorMedioPago();
}

export async function generarVentasPorMedioPago() {
  const fDesde = document.getElementById('filtro-per-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-per-fecha-hasta')?.value;

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }

  const { data: filas, error } = await supabaseAdmin.rpc('ventas_por_medio_pago', {
    p_desde: fDesde,
    p_hasta: fHasta
  });

  if (error) {
    mostrarNotificacion('Error al consultar las ventas por medio de pago: ' + mensajeErrorFuncion(error, 'reporte'), 'danger');
    return;
  }

  dibujarTabla(filas || []);
}

// Agrupa las filas (medio + cuenta) por medio, con subtotal, y dibuja tarjetas, tabla y total.
function dibujarTabla(filas) {
  const tbody = document.getElementById('tbody-ventas-medio');
  const tfoot = document.getElementById('tfoot-ventas-medio');
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (!tbody) return;

  if (filas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No hay cobros ni devoluciones en el rango seleccionado.</td></tr>';
    if (tfoot) tfoot.style.display = 'none';
    if (cont) cont.innerHTML = '';
    return;
  }

  // Un bloque por medio de pago, en el orden que manda la base (alfabético).
  const medios = new Map();
  filas.forEach(f => {
    const m = medios.get(f.id_medio_pago) ?? { nombre: f.medio, cobros: 0, devoluciones: 0, neto: 0, pagos: 0, cuentas: [] };
    m.cobros += Number(f.cobros);
    m.devoluciones += Number(f.devoluciones);
    m.neto += Number(f.neto);
    m.pagos += Number(f.cantidad_pagos);
    m.cuentas.push(f);
    medios.set(f.id_medio_pago, m);
  });

  const total = { cobros: 0, devoluciones: 0, neto: 0, pagos: 0 };
  medios.forEach(m => {
    total.cobros += m.cobros;
    total.devoluciones += m.devoluciones;
    total.neto += m.neto;
    total.pagos += m.pagos;
  });

  // Porcentaje sobre el neto total. Si el total es 0 no hay porcentaje que mostrar.
  const pct = (neto) => (total.neto !== 0 ? formatearPorcentaje(neto * 100 / total.neto) : '-');

  let html = '';
  medios.forEach(m => {
    // Fila del medio (subtotal)
    html += `
      <tr class="font-weight-bold">
        <td>${esc(m.nombre)}</td>
        <td class="text-right">${formatearPesos(m.cobros)}</td>
        <td class="text-right">${formatearPesos(m.devoluciones)}</td>
        <td class="text-right text-success">${formatearPesos(m.neto)}</td>
        <td class="text-right">${pct(m.neto)}</td>
        <td class="text-center">${m.pagos}</td>
      </tr>`;
    // Una fila por cuenta, con sangría. Un medio con una sola cuenta (ej. Efectivo) no repite el subtotal.
    if (m.cuentas.length > 1 || m.cuentas[0].cuenta !== m.nombre) {
      m.cuentas.forEach(c => {
        html += `
      <tr class="text-muted">
        <td class="pl-4"><i class="fas fa-wallet mr-1"></i>${esc(c.cuenta)}</td>
        <td class="text-right">${formatearPesos(c.cobros)}</td>
        <td class="text-right">${formatearPesos(c.devoluciones)}</td>
        <td class="text-right">${formatearPesos(c.neto)}</td>
        <td class="text-right">${pct(Number(c.neto))}</td>
        <td class="text-center">${c.cantidad_pagos}</td>
      </tr>`;
      });
    }
  });
  tbody.innerHTML = html;

  document.getElementById('total-per-cobros').textContent = formatearPesos(total.cobros);
  document.getElementById('total-per-devoluciones').textContent = formatearPesos(total.devoluciones);
  document.getElementById('total-per-neto').textContent = formatearPesos(total.neto);
  document.getElementById('total-per-pagos').textContent = String(total.pagos);
  if (tfoot) tfoot.style.display = '';

  // Tarjetas de arriba: total neto y una por medio de pago.
  if (cont) {
    const tarjeta = (titulo, monto, icono, color) => `
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon ${color} text-white"><i class="fas ${icono}"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">${esc(titulo)}</span>
            <span class="info-box-number text-dark">${formatearPesos(monto)}</span>
          </div>
        </div>
      </div>`;
    const tarjetasMedios = [...medios.values()].map(m =>
      tarjeta(m.nombre, m.neto, 'fa-money-check-dollar', 'bg-info')).join('');
    cont.innerHTML = `<div class="row mb-3">${tarjeta('Total cobrado (neto)', total.neto, 'fa-cash-register', 'bg-success')}${tarjetasMedios}</div>`;
  }
}

// =============================================================================
// Solapa "Por día, semana y mes" · vista Cobrado (script 67, función ventas_por_periodo)
//   Se hacen 3 consultas en paralelo:
//     1) filas del rango agrupadas (día / semana / mes),
//     2) total del rango ('total'): da los pedidos DISTINTOS (no se pueden sumar las filas,
//        porque un pedido con seña y saldo en semanas distintas cuenta en ambas filas),
//     3) total del período anterior (igual duración, termina el día antes de "Desde").
// =============================================================================

const MS_DIA = 86400000;
// Las fechas ISO (AAAA-MM-DD) se manejan como UTC a medianoche: así el huso horario del
// equipo no corre un día al sumar o restar días.
const isoAMs = (iso) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); };
const msAIso = (ms) => new Date(ms).toISOString().slice(0, 10);
const fechaLarga = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fechaCorta = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const formatearEntero = (n) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });

// Período anterior de igual duración: si el rango es 18 al 24, el anterior es 11 al 17.
function rangoAnterior(desde, hasta) {
  const dias = (isoAMs(hasta) - isoAMs(desde)) / MS_DIA + 1;
  const prevHasta = isoAMs(desde) - MS_DIA;
  const prevDesde = prevHasta - (dias - 1) * MS_DIA;
  return { desde: msAIso(prevDesde), hasta: msAIso(prevHasta) };
}

// Rótulo de la fila según la agrupación. Los períodos recortados por el rango muestran sus fechas reales.
function etiquetaPeriodo(f, agrupar) {
  const d = f.r_periodo_desde, h = f.r_periodo_hasta;
  if (agrupar === 'dia') {
    const dia = new Date(isoAMs(d)).toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' });
    return `${dia.charAt(0).toUpperCase() + dia.slice(1).replace('.', '')} ${fechaLarga(d)}`;
  }
  if (agrupar === 'semana') {
    return d === h ? `Semana del ${fechaCorta(d)}` : `Semana del ${fechaCorta(d)} al ${fechaCorta(h)}`;
  }
  // Mes: nombre y año; si el rango cortó el mes, se aclaran las fechas incluidas.
  const nombre = new Date(isoAMs(d)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const finMes = msAIso(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0));
  const completo = d.slice(8, 10) === '01' && h === finMes;
  return nombre.charAt(0).toUpperCase() + nombre.slice(1) + (completo ? '' : ` (${fechaCorta(d)} al ${fechaCorta(h)})`);
}

// Variación contra el período anterior: texto con signo y flecha (no depende solo del color).
// formato = cómo mostrar la diferencia absoluta ($ o unidades).
function variacion(actual, anterior, formato) {
  if (anterior === null || anterior === undefined || Number.isNaN(Number(anterior))) {
    return { texto: 'Sin datos del período anterior', clase: 'text-muted', icono: 'fa-minus' };
  }
  const act = Number(actual), ant = Number(anterior);
  const dif = act - ant;
  if (Math.abs(dif) < 0.005) return { texto: 'Igual al período anterior', clase: 'text-muted', icono: 'fa-equals' };
  const signo = dif > 0 ? '+' : '';
  const pct = ant !== 0 ? ` (${signo}${(dif * 100 / Math.abs(ant)).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)` : '';
  return {
    texto: `${signo}${formato(dif)}${pct}`,
    clase: dif > 0 ? 'text-success' : 'text-danger',
    icono: dif > 0 ? 'fa-arrow-up' : 'fa-arrow-down'
  };
}

// Grupo elegido en el selector ('' = todos los grupos).
const grupoElegido = () => (document.getElementById('filtro-per-grupo')?.value || '').trim();
const sufijoGrupo = (grupo) => (grupo ? ` · ${grupo}` : '');

// Llena el selector "Grupo" con los grupos que salen de las categorías (función grupos_recuento, script 69).
// Conserva la opción elegida si sigue existiendo. Si falla, el reporte sigue andando con "Todos".
async function cargarGruposRecuento() {
  const sel = document.getElementById('filtro-per-grupo');
  if (!sel) return;
  const { data, error } = await supabaseAdmin.rpc('grupos_recuento');
  if (error) {
    mostrarNotificacion('No se pudo cargar la lista de grupos: ' + mensajeErrorFuncion(error, 'reporte'), 'warning');
    return;
  }
  const actual = sel.value;
  sel.innerHTML = '<option value="">Todos los grupos</option>' +
    (data || []).map(g => `<option value="${esc(g.r_grupo)}">${esc(g.r_grupo)}</option>`).join('');
  sel.value = actual;   // si ya no existe, el navegador vuelve a "Todos los grupos"
}

export async function generarVentasPorPeriodo() {
  const fDesde = document.getElementById('filtro-per-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-per-fecha-hasta')?.value;
  const agrupar = document.getElementById('filtro-per-agrupar')?.value || 'dia';
  const grupo = grupoElegido();

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }
  if (fDesde > fHasta) {
    mostrarNotificacion('La fecha "Desde" no puede ser posterior a "Hasta".', 'warning');
    return;
  }

  const ant = rangoAnterior(fDesde, fHasta);
  const args = (d, h, agr) => ({ p_desde: d, p_hasta: h, p_agrupar: agr, p_grupo: grupo || null });
  const [rFilas, rTotal, rPrev, rGrupos] = await Promise.all([
    supabaseAdmin.rpc('ventas_por_periodo', args(fDesde, fHasta, agrupar)),
    supabaseAdmin.rpc('ventas_por_periodo', args(fDesde, fHasta, 'total')),
    supabaseAdmin.rpc('ventas_por_periodo', args(ant.desde, ant.hasta, 'total')),
    // El resumen por grupo solo se pide con "Todos los grupos" (con un grupo elegido sobra).
    grupo
      ? Promise.resolve({ data: null, error: null })
      : supabaseAdmin.rpc('resumen_grupos_cobrado', { p_desde: fDesde, p_hasta: fHasta })
  ]);

  const error = rFilas.error || rTotal.error || rPrev.error || rGrupos.error;
  if (error) {
    mostrarNotificacion('Error al consultar las ventas por período: ' + mensajeErrorFuncion(error, 'reporte'), 'danger');
    return;
  }

  // 'total' devuelve una sola fila, o ninguna si no hubo pagos en el rango.
  const total = rTotal.data?.[0] ?? null;
  dibujarPeriodo(rFilas.data || [], total, rPrev.data?.[0] ?? null, agrupar, ant, grupo);
  dibujarResumenGruposCobrado(grupo ? null : (rGruposDatos(rGrupos)), total);
  if (grupo || !total) limpiarComparativo('cobrado');
  else await dibujarComparativo('cobrado', rGruposDatos(rGrupos), rFilas.data || [], fDesde, fHasta, agrupar);
}

function dibujarPeriodo(filas, total, prev, agrupar, ant, grupo = '') {
  const tbody = document.getElementById('tbody-ventas-periodo');
  const tfoot = document.getElementById('tfoot-ventas-periodo');
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (!tbody) return;

  document.getElementById('nota-pp-grupo')?.classList.toggle('d-none', !grupo);
  // La columna "Traspasos" solo aparece con un grupo elegido y si algún período tiene traspasos
  // (sin grupo los traspasos no se cuentan: su efecto neto es cero).
  const hayTrasp = Boolean(grupo) && filas.some(f => Math.abs(Number(f.r_traspasos || 0)) >= 0.005);
  document.getElementById('th-pp-traspasos')?.classList.toggle('d-none', !hayTrasp);
  document.getElementById('td-pp-traspasos')?.classList.toggle('d-none', !hayTrasp);

  // Sin pagos en el rango: no hay nada que comparar.
  if (filas.length === 0 || !total) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">No hay cobros ni devoluciones en el rango seleccionado' +
      (grupo ? ' para el grupo ' + esc(grupo) : '') + '.</td></tr>';
    if (tfoot) tfoot.style.display = 'none';
    if (cont) cont.innerHTML = '';
    return;
  }

  const ticket = (v) => (v === null || v === undefined ? '-' : formatearPesos(v));

  tbody.innerHTML = filas.map(f => `
      <tr>
        <td>${esc(etiquetaPeriodo(f, agrupar))}</td>
        <td class="text-right">${formatearPesos(f.r_cobros)}</td>
        <td class="text-right">${formatearPesos(f.r_devoluciones)}</td>
        ${hayTrasp ? `<td class="text-right">${formatearPesos(f.r_traspasos)}</td>` : ''}
        <td class="text-right text-success font-weight-bold">${formatearPesos(f.r_neto)}</td>
        <td class="text-center">${formatearEntero(f.r_cantidad_pedidos)}</td>
        <td class="text-right">${ticket(f.r_ticket_promedio)}</td>
        <td class="text-center">${formatearEntero(f.r_cantidad_pagos)}</td>
      </tr>`).join('');

  document.getElementById('total-pp-cobros').textContent = formatearPesos(total.r_cobros);
  document.getElementById('total-pp-devoluciones').textContent = formatearPesos(total.r_devoluciones);
  const tdTrasp = document.getElementById('td-pp-traspasos');
  if (tdTrasp) tdTrasp.textContent = formatearPesos(total.r_traspasos);
  document.getElementById('total-pp-neto').textContent = formatearPesos(total.r_neto);
  document.getElementById('total-pp-pedidos').textContent = formatearEntero(total.r_cantidad_pedidos);
  document.getElementById('total-pp-ticket').textContent = ticket(total.r_ticket_promedio);
  document.getElementById('total-pp-pagos').textContent = formatearEntero(total.r_cantidad_pagos);
  if (tfoot) tfoot.style.display = '';

  // Tarjetas: total cobrado neto, pedidos y ticket promedio, cada una contra el período anterior.
  // Si el período anterior no tuvo pagos, 'prev' es null y se avisa en lugar de inventar una comparación.
  if (cont) {
    const comp = (actual, anterior, formato) => variacion(actual, prev ? anterior : null, formato);
    const sufijo = sufijoGrupo(grupo);
    const tarjeta = (titulo, valor, icono, color, v) => `
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon ${color} text-white"><i class="fas ${icono}"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">${esc(titulo)}</span>
            <span class="info-box-number text-dark">${valor}</span>
            <span class="${v.clase} font-weight-bold"><i class="fas ${v.icono} mr-1"></i>${esc(v.texto)}</span>
          </div>
        </div>
      </div>`;
    cont.innerHTML = `
      <p class="small text-muted mb-1">${grupo ? 'Grupo ' + esc(grupo) + '. ' : ''}Comparado con el período anterior (${fechaLarga(ant.desde)} al ${fechaLarga(ant.hasta)}).</p>
      <div class="row mb-3">
        ${tarjeta('Total cobrado (neto)' + sufijo, formatearPesos(total.r_neto), 'fa-cash-register', 'bg-success',
                  comp(total.r_neto, prev?.r_neto, formatearPesos))}
        ${tarjeta('Pedidos con cobro' + sufijo, formatearEntero(total.r_cantidad_pedidos), 'fa-receipt', 'bg-info',
                  comp(total.r_cantidad_pedidos, prev?.r_cantidad_pedidos, formatearEntero))}
        ${tarjeta('Ticket promedio' + sufijo, ticket(total.r_ticket_promedio), 'fa-tags', 'bg-warning',
                  comp(total.r_ticket_promedio, prev?.r_ticket_promedio, formatearPesos))}
      </div>`;
  }
}

// Tabla "Por grupo" (solo con "Todos los grupos"): una fila por grupo del rango completo.
// filas = null cuando hay un grupo elegido: la tabla se oculta. El % es sobre el neto total.
function dibujarResumenGruposCobrado(filas, total) {
  const cont = document.getElementById('resumen-grupos-cobrado');
  if (!cont) return;
  if (!filas || filas.length === 0 || !total) { cont.innerHTML = ''; return; }

  const suma = (k) => filas.reduce((s, f) => s + Number(f[k] || 0), 0);
  const netoTot = suma('r_neto');
  const hayTrasp = filas.some(f => Math.abs(Number(f.r_traspasos || 0)) >= 0.005);
  const pct = (n) => (netoTot !== 0 ? formatearPorcentaje(Number(n) * 100 / netoTot) : '-');
  const ordenadas = [...filas].sort((a, b) => Number(b.r_neto) - Number(a.r_neto));

  cont.innerHTML = `
      <h5 class="font-weight-bold mb-2"><i class="fas fa-layer-group mr-1"></i> Por grupo</h5>
      <div class="table-responsive">
        <table class="table table-bordered table-hover table-sm text-sm mb-0">
          <thead class="thead-dark">
            <tr>
              <th>Grupo</th>
              <th class="text-right">Cobros</th>
              <th class="text-right">Devoluciones</th>
              ${hayTrasp ? '<th class="text-right">Traspasos</th>' : ''}
              <th class="text-right">Neto</th>
              <th class="text-right">% del total</th>
              <th class="text-center">Pedidos</th>
            </tr>
          </thead>
          <tbody>
            ${ordenadas.map(f => `
            <tr>
              <td class="font-weight-bold">${esc(f.r_grupo)}</td>
              <td class="text-right">${formatearPesos(f.r_cobros)}</td>
              <td class="text-right">${formatearPesos(f.r_devoluciones)}</td>
              ${hayTrasp ? `<td class="text-right">${formatearPesos(f.r_traspasos)}</td>` : ''}
              <td class="text-right text-success font-weight-bold">${formatearPesos(f.r_neto)}</td>
              <td class="text-right">${pct(f.r_neto)}</td>
              <td class="text-center">${formatearEntero(f.r_cantidad_pedidos)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot class="bg-light font-weight-bold">
            <tr>
              <td class="text-right">TOTAL DEL RANGO:</td>
              <td class="text-right">${formatearPesos(suma('r_cobros'))}</td>
              <td class="text-right">${formatearPesos(suma('r_devoluciones'))}</td>
              ${hayTrasp ? `<td class="text-right">${formatearPesos(suma('r_traspasos'))}</td>` : ''}
              <td class="text-right text-success">${formatearPesos(netoTot)}</td>
              <td></td>
              <td class="text-center">${formatearEntero(total.r_cantidad_pedidos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="small text-muted mt-2 mb-0">Cada pago se reparte entre las líneas del pedido en proporción a lo cobrado; el descuento por docena va al grupo de los productos con docena del pedido. Un pedido con productos de más de un grupo cuenta como pedido en cada grupo, por eso los pedidos por grupo pueden sumar más que el total (el total de la fila final cuenta cada pedido una sola vez). La plata sí suma exacto.</p>`;
}

// =============================================================================
// Solapa "Por día, semana y mes" · vista Entregado (script 68, función entregas_por_periodo)
//   Solo cantidades (sin importes). Un pedido cuenta el día en que pasó a ENTREGADO (D30),
//   aunque no se haya cobrado. Como cada pedido tiene una sola fecha de entrega, las filas
//   suman exactamente el total. Misma mecánica que Cobrado: 3 consultas en paralelo.
// =============================================================================

// Docenas = unidades de productos que permiten docena / 12 (misma regla del resumen de ventas).
const formatearDocenas = (n) =>
  Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

function cambiarSubVista(sub) {
  if (sub === subVistaActual) return;
  subVistaActual = sub;

  document.querySelectorAll('#subtabs-ventas-periodo a[data-subvista]').forEach(a => {
    const activa = a.dataset.subvista === sub;
    a.classList.toggle('active', activa);
    a.setAttribute('aria-selected', String(activa));
  });
  document.getElementById('sub-per-cobrado')?.classList.toggle('d-none', sub !== 'COBRADO');
  document.getElementById('sub-per-entregado')?.classList.toggle('d-none', sub !== 'ENTREGADO');
  // Las tarjetas son de la vista anterior: se limpian hasta que llegue la consulta nueva.
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (cont) cont.innerHTML = '';

  consultarVistaActiva();
}

export async function generarEntregasPorPeriodo() {
  const fDesde = document.getElementById('filtro-per-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-per-fecha-hasta')?.value;
  const agrupar = document.getElementById('filtro-per-agrupar')?.value || 'dia';
  const grupo = grupoElegido();

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }
  if (fDesde > fHasta) {
    mostrarNotificacion('La fecha "Desde" no puede ser posterior a "Hasta".', 'warning');
    return;
  }

  const ant = rangoAnterior(fDesde, fHasta);
  const args = (d, h, agr) => ({ p_desde: d, p_hasta: h, p_agrupar: agr, p_grupo: grupo || null });
  const [rFilas, rTotal, rPrev, rGrupos] = await Promise.all([
    supabaseAdmin.rpc('entregas_por_periodo', args(fDesde, fHasta, agrupar)),
    supabaseAdmin.rpc('entregas_por_periodo', args(fDesde, fHasta, 'total')),
    supabaseAdmin.rpc('entregas_por_periodo', args(ant.desde, ant.hasta, 'total')),
    // El resumen por grupo solo se pide con "Todos los grupos" (con un grupo elegido sobra).
    grupo
      ? Promise.resolve({ data: null, error: null })
      : supabaseAdmin.rpc('resumen_grupos_entregado', { p_desde: fDesde, p_hasta: fHasta })
  ]);

  const error = rFilas.error || rTotal.error || rPrev.error || rGrupos.error;
  if (error) {
    mostrarNotificacion('Error al consultar las entregas por período: ' + mensajeErrorFuncion(error, 'reporte'), 'danger');
    return;
  }

  // 'total' devuelve una sola fila, o ninguna si no hubo entregas en el rango.
  const total = rTotal.data?.[0] ?? null;
  dibujarEntregas(rFilas.data || [], total, rPrev.data?.[0] ?? null, agrupar, ant, grupo);
  dibujarResumenGruposEntregado(grupo ? null : rGruposDatos(rGrupos), total);
  if (grupo || !total) limpiarComparativo('entregado');
  else await dibujarComparativo('entregado', rGruposDatos(rGrupos), rFilas.data || [], fDesde, fHasta, agrupar);
}

function dibujarEntregas(filas, total, prev, agrupar, ant, grupo = '') {
  const tbody = document.getElementById('tbody-entregas-periodo');
  const tfoot = document.getElementById('tfoot-entregas-periodo');
  const cont = document.getElementById('contenedor-kpis-periodo');
  if (!tbody) return;

  document.getElementById('nota-ee-grupo')?.classList.toggle('d-none', !grupo);

  // Sin entregas en el rango: no hay nada que comparar.
  if (filas.length === 0 || !total) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No hay pedidos entregados en el rango seleccionado' +
      (grupo ? ' para el grupo ' + esc(grupo) : '') + '.</td></tr>';
    if (tfoot) tfoot.style.display = 'none';
    if (cont) cont.innerHTML = '';
    return;
  }

  tbody.innerHTML = filas.map(f => `
      <tr>
        <td>${esc(etiquetaPeriodo(f, agrupar))}</td>
        <td class="text-center">${formatearEntero(f.r_pedidos)}</td>
        <td class="text-center">${formatearEntero(f.r_unidades)}</td>
        <td class="text-center">${formatearDocenas(Number(f.r_unidades_docena) / 12)}</td>
      </tr>`).join('');

  document.getElementById('total-ee-pedidos').textContent = formatearEntero(total.r_pedidos);
  document.getElementById('total-ee-unidades').textContent = formatearEntero(total.r_unidades);
  document.getElementById('total-ee-docenas').textContent = formatearDocenas(Number(total.r_unidades_docena) / 12);
  if (tfoot) tfoot.style.display = '';

  // Tarjetas: pedidos entregados, unidades y docenas, cada una contra el período anterior.
  // Si el período anterior no tuvo entregas, 'prev' es null y se avisa en lugar de inventar una comparación.
  if (cont) {
    const comp = (actual, anterior, formato) => variacion(actual, prev ? anterior : null, formato);
    const docAct = Number(total.r_unidades_docena) / 12;
    const docAnt = prev ? Number(prev.r_unidades_docena) / 12 : null;
    const sufijo = sufijoGrupo(grupo);
    const tarjeta = (titulo, valor, icono, color, v) => `
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon ${color} text-white"><i class="fas ${icono}"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">${esc(titulo)}</span>
            <span class="info-box-number text-dark">${valor}</span>
            <span class="${v.clase} font-weight-bold"><i class="fas ${v.icono} mr-1"></i>${esc(v.texto)}</span>
          </div>
        </div>
      </div>`;
    cont.innerHTML = `
      <p class="small text-muted mb-1">${grupo ? 'Grupo ' + esc(grupo) + '. ' : ''}Comparado con el período anterior (${fechaLarga(ant.desde)} al ${fechaLarga(ant.hasta)}).</p>
      <div class="row mb-3">
        ${tarjeta('Pedidos entregados' + sufijo, formatearEntero(total.r_pedidos), 'fa-truck', 'bg-success',
                  comp(total.r_pedidos, prev?.r_pedidos, formatearEntero))}
        ${tarjeta('Unidades entregadas' + sufijo, formatearEntero(total.r_unidades), 'fa-boxes-stacked', 'bg-info',
                  comp(total.r_unidades, prev?.r_unidades, formatearEntero))}
        ${tarjeta('Docenas' + sufijo, formatearDocenas(docAct), 'fa-layer-group', 'bg-warning',
                  comp(docAct, docAnt, formatearDocenas))}
      </div>`;
  }
}

// Tabla "Por grupo" de la vista Entregado (solo con "Todos los grupos").
// filas = null cuando hay un grupo elegido: la tabla se oculta. Sin importes.
function dibujarResumenGruposEntregado(filas, total) {
  const cont = document.getElementById('resumen-grupos-entregado');
  if (!cont) return;
  if (!filas || filas.length === 0 || !total) { cont.innerHTML = ''; return; }

  const suma = (k) => filas.reduce((s, f) => s + Number(f[k] || 0), 0);
  const ordenadas = [...filas].sort((a, b) => Number(b.r_unidades) - Number(a.r_unidades));

  cont.innerHTML = `
      <h5 class="font-weight-bold mb-2"><i class="fas fa-layer-group mr-1"></i> Por grupo</h5>
      <div class="table-responsive">
        <table class="table table-bordered table-hover table-sm text-sm mb-0">
          <thead class="thead-dark">
            <tr>
              <th>Grupo</th>
              <th class="text-center">Pedidos entregados</th>
              <th class="text-center">Unidades</th>
              <th class="text-center">Docenas</th>
            </tr>
          </thead>
          <tbody>
            ${ordenadas.map(f => `
            <tr>
              <td class="font-weight-bold">${esc(f.r_grupo)}</td>
              <td class="text-center">${formatearEntero(f.r_pedidos)}</td>
              <td class="text-center">${formatearEntero(f.r_unidades)}</td>
              <td class="text-center">${formatearDocenas(Number(f.r_unidades_docena) / 12)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot class="bg-light font-weight-bold">
            <tr>
              <td class="text-right">TOTAL DEL RANGO:</td>
              <td class="text-center">${formatearEntero(total.r_pedidos)}</td>
              <td class="text-center">${formatearEntero(suma('r_unidades'))}</td>
              <td class="text-center">${formatearDocenas(suma('r_unidades_docena') / 12)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="small text-muted mt-2 mb-0">Un pedido con productos de más de un grupo cuenta como pedido entregado en cada grupo, por eso los pedidos por grupo pueden sumar más que el total (el total de la fila final cuenta cada pedido una sola vez). Las unidades y las docenas sí suman exacto.</p>`;
}

// =============================================================================
// Comparativo por grupo y período (solo con "Todos los grupos")
//   Una fila por período (las mismas del reporte de arriba) y una columna por grupo,
//   para comparar cuánto vendió cada subnegocio en una semana contra otra.
//   Cobrado -> neto cobrado por grupo. Entregado -> unidades entregadas por grupo.
//   No usa funciones nuevas: pide el MISMO reporte filtrado por cada grupo (ventas_por_periodo /
//   entregas_por_periodo con p_grupo, ya probadas en la 69b) y lo cruza por período.
//   Debajo de cada valor va la variación contra la fila anterior de la tabla.
// =============================================================================

const rGruposDatos = (r) => r?.data || [];

// Cada consulta nueva invalida las anteriores: si una respuesta llega tarde, no pisa la pantalla actual.
let secuenciaComparativo = 0;

function limpiarComparativo(tipo) {
  secuenciaComparativo++;
  const cont = document.getElementById('comparativo-grupos-' + tipo);
  if (cont) cont.innerHTML = '';
}

// Variación porcentual con signo y flecha (no depende solo del color). null si no hay base de comparación.
function variacionCorta(actual, anterior) {
  if (anterior === undefined || anterior === null || Number(anterior) === 0) return null;
  const dif = Number(actual) - Number(anterior);
  if (Math.abs(dif) < 0.005) return { texto: 'igual', clase: 'text-muted', icono: 'fa-equals' };
  const signo = dif > 0 ? '+' : '';
  const pct = (dif * 100 / Math.abs(Number(anterior))).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { texto: `${signo}${pct} %`, clase: dif > 0 ? 'text-success' : 'text-danger', icono: dif > 0 ? 'fa-arrow-up' : 'fa-arrow-down' };
}

async function dibujarComparativo(tipo, gruposResumen, filasGenerales, fDesde, fHasta, agrupar) {
  const cont = document.getElementById('comparativo-grupos-' + tipo);
  if (!cont) return;
  limpiarComparativo(tipo);
  const seq = secuenciaComparativo;

  const nombres = (gruposResumen || []).map(g => g.r_grupo);
  // Con un solo grupo o un solo período no hay nada que comparar (ya está en las otras tablas).
  if (nombres.length < 2 || filasGenerales.length < 2) return;

  const esCobrado = tipo === 'cobrado';
  const funcion = esCobrado ? 'ventas_por_periodo' : 'entregas_por_periodo';
  const valorDe = esCobrado ? (f) => Number(f.r_neto) : (f) => Number(f.r_unidades);
  const formato = esCobrado ? formatearPesos : formatearEntero;

  const resp = await Promise.all(nombres.map(g =>
    supabaseAdmin.rpc(funcion, { p_desde: fDesde, p_hasta: fHasta, p_agrupar: agrupar, p_grupo: g })));
  if (seq !== secuenciaComparativo) return;   // llegó una consulta más nueva: se descarta esta

  const falla = resp.find(r => r.error);
  if (falla) {
    // No es grave: el resto del reporte ya está dibujado.
    mostrarNotificacion('No se pudo armar el comparativo por grupo: ' + mensajeErrorFuncion(falla.error, 'reporte'), 'warning');
    return;
  }

  // Valor de cada grupo por período (clave = primer día del período). Un grupo sin ventas en ese período vale 0.
  const porGrupo = resp.map(r => new Map((r.data || []).map(f => [f.r_periodo_desde, valorDe(f)])));
  const filas = filasGenerales.map(f => ({
    etiqueta: etiquetaPeriodo(f, agrupar),
    celdas: nombres.map((_, i) => porGrupo[i].get(f.r_periodo_desde) ?? 0),
    total: valorDe(f)
  }));

  const celda = (v, ant) => {
    const d = variacionCorta(v, ant);
    return `<td class="text-right">${formato(v)}${d ? `<div class="small ${d.clase}"><i class="fas ${d.icono} mr-1"></i>${esc(d.texto)}</div>` : ''}</td>`;
  };
  const sumaCol = (i) => filas.reduce((s, f) => s + f.celdas[i], 0);
  const sumaTotal = filas.reduce((s, f) => s + f.total, 0);

  cont.innerHTML = `
      <h5 class="font-weight-bold mb-1"><i class="fas fa-chart-column mr-1"></i> Comparativo por grupo y período</h5>
      <p class="small text-muted mb-2">${esCobrado ? 'Neto cobrado' : 'Unidades entregadas'} de cada grupo en cada período. Debajo de cada valor, la variación contra la fila anterior de la tabla (solo se listan períodos con movimiento).</p>
      <div class="table-responsive">
        <table class="table table-bordered table-hover table-sm text-sm mb-0">
          <thead class="thead-dark">
            <tr>
              <th>Período</th>
              ${nombres.map(n => `<th class="text-right">${esc(n)}</th>`).join('')}
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${filas.map((f, k) => `
            <tr>
              <td>${esc(f.etiqueta)}</td>
              ${f.celdas.map((v, i) => celda(v, k > 0 ? filas[k - 1].celdas[i] : undefined)).join('')}
              ${celda(f.total, k > 0 ? filas[k - 1].total : undefined).replace('<td class="text-right">', '<td class="text-right font-weight-bold">')}
            </tr>`).join('')}
          </tbody>
          <tfoot class="bg-light font-weight-bold">
            <tr>
              <td class="text-right">TOTAL DEL RANGO:</td>
              ${nombres.map((_, i) => `<td class="text-right">${formato(sumaCol(i))}</td>`).join('')}
              <td class="text-right">${formato(sumaTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
}
