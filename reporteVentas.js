import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, obtenerFechaActualISO, esc, mensajeErrorFuncion } from './utils.js';

// -----------------------------------------------------------------------------
// Formato de números para este reporte.
//   toLocaleString('es-AR') sin tope de decimales puede mostrar hasta 3 (ej. 34.941,176) cuando el valor
//   viene de un reparto proporcional (cobros parciales). Por eso se fija el máximo explícito.
//   Es solo de pantalla: los valores que llegan de la base no se modifican.
// -----------------------------------------------------------------------------
const formatearPesos = (n) =>
  '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Unidades: entero si es entero, hasta 2 decimales si hubo cobros parciales (23,29).
const formatearUnidades = (n) =>
  Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
// Docenas: siempre 1 decimal, con coma (7,1).
const formatearDocenas = (unidades) =>
  (Number(unidades || 0) / 12).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// -----------------------------------------------------------------------------
// Tarjetas de arriba: una por GRUPO (columna grupo_recuento; sale de grupo_caja), igual que "Ventas por grupo" del cierre.
//   * Total de la tarjeta = suma de todas las categorías que comparten ese grupo
//     (ej.: Empanada + Canastita, si las dos tienen el grupo EMPANADAS).
//   * Título = nombres de las SECCIONES que hay adentro (ej.: "Empanadas + Canastitas").
//   * Nada depende de nombres escritos en el código: un grupo nuevo tiene su tarjeta automáticamente.
// La base manda la columna grupo_recuento (script 65). Si todavía no llega, se usa la sección (columna grupo).
// Vocabulario en pantalla (desde el 26/11/2026): "Sección" = dónde se muestra la categoría al tomar el pedido
// (columna grupo); "Grupo" = cómo se suman las ventas (grupo_caja / grupo_recuento). Los nombres técnicos no cambian.
// -----------------------------------------------------------------------------
const normalizarGrupo = (g) => String(g ?? '').toUpperCase().trim();
const grupoRecuentoDe = (item) => normalizarGrupo(item.grupo_recuento) || normalizarGrupo(item.grupo) || 'OTROS';
const grupoPestanasDe = (item) => normalizarGrupo(item.grupo) || 'OTROS';

// Suma una fila del resultado en la tarjeta de su grupo.
//   unidadesDocena = unidades de productos que permiten docena (para mostrar las docenas de la tarjeta).
function sumarATarjeta(tarjetas, item, unidades, monto) {
  const clave = grupoRecuentoDe(item);
  const t = (tarjetas[clave] ??= { unidades: 0, unidadesDocena: 0, monto: 0, pestanas: new Set() });
  t.unidades += unidades;
  t.monto += monto;
  if (item.permite_docena) t.unidadesDocena += unidades;
  t.pestanas.add(grupoPestanasDe(item));
}

// El descuento por docena (producto 999, monto negativo) no es de un grupo: se reparte entre las tarjetas
// que tienen productos con docena, en proporción a sus unidades. Con un solo grupo con docena, va entero ahí.
function repartirDescuento(tarjetas, descuento) {
  if (!descuento) return;
  const lista = Object.values(tarjetas);
  if (lista.length === 0) return;
  const totalDocena = lista.reduce((suma, t) => suma + t.unidadesDocena, 0);
  if (totalDocena > 0) {
    lista.forEach(t => { t.monto += descuento * t.unidadesDocena / totalDocena; });
  } else {
    // Caso raro (sin productos con docena en el rango): va a la tarjeta con más unidades.
    lista.sort((a, b) => b.unidades - a.unidades)[0].monto += descuento;
  }
}

// Título: la sección que se llama igual que el grupo va primero; las demás, alfabéticas. "Empanadas + Canastitas".
const capitalizar = (s) => s.charAt(0) + s.slice(1).toLowerCase();
function tituloTarjeta(clave, pestanas) {
  if (clave === 'OTROS') return 'Otros / Varios';
  const nombres = [...pestanas].filter(Boolean).sort((a, b) =>
    a === clave ? -1 : b === clave ? 1 : a.localeCompare(b));
  return (nombres.length ? nombres : [clave]).map(capitalizar).join(' + ');
}

// Ícono y color: SOLO decoración (ningún cálculo depende de esto).
function decoracionTarjeta(clave) {
  if (clave === 'EMPANADAS') return '<span class="info-box-icon bg-warning text-white" style="font-size: 1.8rem;">🥟</span>';
  if (clave === 'PIZZAS') return '<span class="info-box-icon bg-danger text-white"><i class="fas fa-pizza-slice"></i></span>';
  return '<span class="info-box-icon bg-info text-white"><i class="fas fa-box"></i></span>';
}

// -----------------------------------------------------------------------------
// Solapas del reporte
//   COBRADO   : ventas por fecha de PAGO (ventas_por_producto). Es el reporte de siempre.
//   ENTREGADO : unidades por fecha de ENTREGA (unidades_entregadas_por_producto), sin importes.
// Las dos comparten el rango de fechas y el cliente. Los criterios no se mezclan en una misma fila.
// -----------------------------------------------------------------------------
let vistaActiva = 'COBRADO';
let solapasEnlazadas = false;

// Orden de la tabla de detalle (selector "Ordenar por"). Cambiarlo NO vuelve a consultar la base: se guardan
// las últimas filas de cada solapa y solo se redibuja el cuerpo de la tabla. Las tarjetas y los totales
// no dependen del orden.
//   VENDIDO    : lo que más se vendió primero (Cobrado: mayor importe; Entregado: más unidades)
//   CATEGORIA  : agrupado por grupo y categoría (el orden de antes)
//   ALFABETICO : por nombre de producto
let ordenResumen = 'VENDIDO';
let filasCobrado = [];    // filas de la tabla de la solapa "Cobrado"
let filasEntregado = [];  // filas de la tabla de la solapa "Entregado"

// clavePrincipal: campo por el que se ordena en "VENDIDO" ('montoTotal' o 'unidades').
// El nombre del producto desempata, así el orden no cambia entre consultas.
function comparadorResumen(clavePrincipal) {
  const porNombre = (a, b) => a.producto.localeCompare(b.producto);
  if (ordenResumen === 'CATEGORIA') {
    return (a, b) => a.grupo.localeCompare(b.grupo) || a.categoria.localeCompare(b.categoria) || porNombre(a, b);
  }
  if (ordenResumen === 'ALFABETICO') return porNombre;
  return (a, b) => (b[clavePrincipal] - a[clavePrincipal]) || porNombre(a, b);
}

// La primera opción del selector dice qué significa "lo más vendido" en la solapa activa.
function actualizarEtiquetaOrden() {
  const op = document.querySelector('#filtro-prod-orden option[value="VENDIDO"]');
  if (op) op.textContent = vistaActiva === 'COBRADO' ? 'Mayor importe' : 'Más unidades';
}

// Redibuja solo las filas de la tabla activa (sin tocar totales, tarjetas ni notas).
function redibujarFilasSegunOrden() {
  if (vistaActiva === 'COBRADO') dibujarFilasCobrado();
  else dibujarFilasEntregado();
}

function dibujarFilasCobrado() {
  const tbody = document.getElementById('tbody-resumen-productos');
  if (!tbody || filasCobrado.length === 0) return;   // sin datos se conserva el aviso "No hay ventas…"
  tbody.innerHTML = [...filasCobrado].sort(comparadorResumen('montoTotal')).map(row => {
    const textoDocenas = row.permiteDocena
      ? `${formatearDocenas(row.unidades)} doc.`
      : '-';
    return `
      <tr>
        <td>${esc(row.categoria)}</td>
        <td class="font-weight-bold">${esc(row.producto)}</td>
        <td class="text-center">${formatearUnidades(row.unidades)} u.</td>
        <td class="text-center text-muted">${textoDocenas}</td>
        <td class="text-right font-weight-bold">${formatearPesos(row.montoTotal)}</td>
      </tr>
    `;
  }).join('');
}

function dibujarFilasEntregado() {
  const tbody = document.getElementById('tbody-entregado-productos');
  if (!tbody || filasEntregado.length === 0) return;
  tbody.innerHTML = [...filasEntregado].sort(comparadorResumen('unidades')).map(row => {
    const textoDocenas = row.permiteDocena ? `${formatearDocenas(row.unidades)} doc.` : '-';
    return `
      <tr>
        <td>${esc(row.categoria)}</td>
        <td class="font-weight-bold">${esc(row.producto)}</td>
        <td class="text-center">${formatearUnidades(row.unidades)} u.</td>
        <td class="text-center text-muted">${textoDocenas}</td>
      </tr>
    `;
  }).join('');
}

// El clic se engancha una sola vez (inicializarReporteVentas puede ejecutarse varias veces).
function enlazarSolapas() {
  if (solapasEnlazadas) return;
  const cont = document.getElementById('tabs-resumen-ventas');
  if (!cont) return;
  solapasEnlazadas = true;
  actualizarEtiquetaOrden();
  document.getElementById('filtro-prod-orden')?.addEventListener('change', (e) => {
    ordenResumen = e.target.value;
    redibujarFilasSegunOrden();
  });
  cont.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-vista]');
    if (!tab) return;
    e.preventDefault();
    cambiarVista(tab.dataset.vista);
  });
}

function cambiarVista(vista) {
  if (vista === vistaActiva) return;
  vistaActiva = vista;
  document.querySelectorAll('#tabs-resumen-ventas [data-vista]').forEach(a => {
    const activa = a.dataset.vista === vista;
    a.classList.toggle('active', activa);
    a.setAttribute('aria-selected', activa ? 'true' : 'false');
  });
  document.getElementById('panel-vista-cobrado')?.classList.toggle('d-none', vista !== 'COBRADO');
  document.getElementById('panel-vista-entregado')?.classList.toggle('d-none', vista !== 'ENTREGADO');
  actualizarEtiquetaOrden();
  // Al cambiar de solapa se consulta de nuevo con los filtros que ya están cargados.
  generarResumenVentasProductos();
}

export async function inicializarReporteVentas() {
  enlazarSolapas();
  await cargarSelectClientesFiltro();

  const hoy = obtenerFechaActualISO(); // fecha local (Argentina), no UTC
  const inputDesde = document.getElementById('filtro-prod-fecha-desde');
  const inputHasta = document.getElementById('filtro-prod-fecha-hasta');

  if (inputDesde && !inputDesde.value) inputDesde.value = hoy;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  await generarResumenVentasProductos();
}

export async function cargarSelectClientesFiltro() {
  const select = document.getElementById('filtro-prod-cliente');
  if (!select) return;

  const { data: clientes } = await supabaseAdmin
    .from('TB_BCLIENTES')
    .select('id, nombre')
    .order('nombre');

  if (clientes) {
    select.innerHTML = '<option value="">-- Todos los Clientes --</option>' + 
      clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  }
}

export async function generarResumenVentasProductos() {
  const fDesde = document.getElementById('filtro-prod-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-prod-fecha-hasta')?.value;
  const idCliente = document.getElementById('filtro-prod-cliente')?.value;

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }

  // Solapa "Entregado": otra consulta y otra tabla. La solapa "Cobrado" sigue desde acá sin cambios.
  enlazarSolapas();
  if (vistaActiva === 'ENTREGADO') {
    await generarResumenEntregado(fDesde, fHasta, idCliente);
    return;
  }

  // Aviso aparte de los pedidos entregados y todavía sin cobrar (no suman a los totales).
  // No se espera: se completa solo cuando llega la respuesta.
  mostrarNotaImpagos(fDesde, fHasta, idCliente);

  // 1. Ventas por producto según los PAGOS del rango (script 50): la venta cuenta el día en que se cobra
  //    (aunque el pedido se retire después) y cada pago se reparte entre las líneas de su pedido en proporción a lo
  //    cobrado. Una devolución resta el día en que ocurre. La base devuelve una fila por producto; el renglón de
  //    descuento por docena (producto 999) viene con monto negativo.
  const { data: filas, error: errVentas } = await supabaseAdmin.rpc('ventas_por_producto', {
    p_desde: fDesde,
    p_hasta: fHasta,
    p_id_cliente: idCliente ? Number(idCliente) : null
  });

  const tbody = document.getElementById('tbody-resumen-productos');
  const tfoot = document.getElementById('tfoot-resumen-productos');

  if (errVentas) {
    mostrarNotificacion('Error al consultar las ventas: ' + mensajeErrorFuncion(errVentas, 'reporte'), 'danger');
    return;
  }

  if (!filas || filas.length === 0) {
    filasCobrado = [];
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay ventas cobradas para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    renderizarTarjetasGrupos({});
    mostrarNotaDescuento(0);
    return;
  }

  // 2. Agrupar por producto (tabla) y por grupo (tarjetas)
  const tarjetas = {};
  const productosAgrupados = {};
  // Suma (negativa) de los descuentos por docena: no se muestra como fila, pero se resta de los totales.
  let descuentoTotal = 0;

  filas.forEach(item => {
    // El renglón de descuento (producto 999) guarda "docenas" en cantidad:
    // suma el monto (negativo) pero no cuenta como unidades vendidas.
    const esDescuento = Number(item.id_producto) === 999;
    const cant = esDescuento ? 0 : Number(item.unidades || 0);
    const monto = Number(item.monto || 0);

    const grupoNombre = grupoPestanasDe(item);
    const catNombre = item.categoria || 'Sin Categoría';

    // La bonificación (producto 999) no se muestra como producto ni es de un grupo: solo se acumula su
    // monto, que después se reparte entre las tarjetas con productos de docena (repartirDescuento).
    if (esDescuento) {
      descuentoTotal += monto;
      return;
    }

    // Acumulador de las tarjetas, por grupo
    sumarATarjeta(tarjetas, item, cant, monto);

    productosAgrupados[item.id_producto] = {
      grupo: grupoNombre,
      categoria: catNombre,
      producto: item.producto,
      permiteDocena: Boolean(item.permite_docena),
      unidades: cant,
      montoTotal: monto
    };
  });

  // Las unidades pueden quedar con decimales si hubo cobros parciales o devoluciones: se redondean a 2.
  const redondearUnidades = (n) => Math.round(n * 100) / 100;
  Object.values(productosAgrupados).forEach(r => { r.unidades = redondearUnidades(r.unidades); });

  // 3. Renderizar KPIs visuales superiores (el descuento por docena ya viene repartido entre las tarjetas)
  repartirDescuento(tarjetas, descuentoTotal);
  renderizarTarjetasGrupos(tarjetas);

  // 4. Renderizar Tabla de Detalle
  // El orden lo define el selector "Ordenar por" y se aplica al dibujar las filas (dibujarFilasCobrado).
  const listaConsolidada = Object.values(productosAgrupados);

  // Sin filas que mostrar (por ejemplo, solo había un descuento): mismo aviso que sin ventas.
  if (listaConsolidada.length === 0) {
    filasCobrado = [];
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay ventas cobradas para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    mostrarNotaDescuento(0);
    return;
  }

  let totalUnidadesGral = 0;
  // El total arranca en el descuento (negativo): así sigue siendo lo realmente vendido
  // aunque la fila del descuento ya no se vea.
  let totalMontoGral = descuentoTotal;

  listaConsolidada.forEach(row => {
    totalUnidadesGral += row.unidades;
    totalMontoGral += row.montoTotal;
  });

  filasCobrado = listaConsolidada;
  dibujarFilasCobrado();

  if (tfoot) {
   tfoot.style.display = 'table-footer-group';
    document.getElementById('total-resumen-unidades').innerText = `${formatearUnidades(redondearUnidades(totalUnidadesGral))} u.`;

    // Docenas del total: unidades de los productos que permiten docena (de todos los grupos).
    const unidadesDocena = Object.values(tarjetas).reduce((suma, g) => suma + g.unidadesDocena, 0);
    document.getElementById('total-resumen-docenas').innerText = `${formatearDocenas(unidadesDocena)} doc.`;

    document.getElementById('total-resumen-monto').innerText = formatearPesos(totalMontoGral);
  }

  mostrarNotaDescuento(descuentoTotal);
}

// -----------------------------------------------------------------------------
// generarResumenEntregado  (interna)
//   Solapa "Entregado": unidades entregadas por producto en el rango (por fecha de entrega, tomada del
//   historial del pedido en la base), sin importes. Cuenta aunque el pedido todavía no se haya cobrado.
//   Las unidades son enteras (las del pedido), sin reparto proporcional. Pedidos anulados y el
//   descuento por docena (producto 999) ya vienen excluidos desde la base.
// -----------------------------------------------------------------------------
async function generarResumenEntregado(fDesde, fHasta, idCliente) {
  const tbody = document.getElementById('tbody-entregado-productos');
  const tfoot = document.getElementById('tfoot-entregado-productos');
  if (!tbody) return;

  const { data: filas, error } = await supabaseAdmin.rpc('unidades_entregadas_por_producto', {
    p_desde: fDesde,
    p_hasta: fHasta,
    p_id_cliente: idCliente ? Number(idCliente) : null
  });

  // Si mientras esperaba la respuesta se cambió de solapa, esta respuesta ya no corresponde.
  if (vistaActiva !== 'ENTREGADO') return;

  if (error) {
    mostrarNotificacion('Error al consultar las entregas: ' + mensajeErrorFuncion(error, 'reporte'), 'danger');
    return;
  }

  if (!filas || filas.length === 0) {
    filasEntregado = [];
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No hay pedidos entregados para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    renderizarTarjetasGrupos({}, false);
    return;
  }

  // Mismas tarjetas que la solapa "Cobrado" (por grupo), pero sin importes.
  const tarjetas = {};
  const lista = filas.map(item => {
    const unidades = Number(item.unidades || 0);
    sumarATarjeta(tarjetas, item, unidades, 0);
    return {
      grupo: grupoPestanasDe(item),
      categoria: item.categoria || 'Sin Categoría',
      producto: item.producto,
      permiteDocena: Boolean(item.permite_docena),
      unidades
    };
  });

  renderizarTarjetasGrupos(tarjetas, false);

  // El orden lo define el selector "Ordenar por" y se aplica al dibujar las filas (dibujarFilasEntregado).
  const totalUnidades = lista.reduce((suma, row) => suma + row.unidades, 0);
  filasEntregado = lista;
  dibujarFilasEntregado();

  if (tfoot) {
    tfoot.style.display = 'table-footer-group';
    document.getElementById('total-entregado-unidades').innerText = `${formatearUnidades(totalUnidades)} u.`;
    // Igual que en "Cobrado": docenas = unidades de los productos que permiten docena.
    const unidadesDocena = Object.values(tarjetas).reduce((suma, g) => suma + g.unidadesDocena, 0);
    document.getElementById('total-entregado-docenas').innerText = `${formatearDocenas(unidadesDocena)} doc.`;
  }
}

// -----------------------------------------------------------------------------
// mostrarNotaImpagos  (interna)
//   Avisa cuántos pedidos están entregados pero con saldo sin cobrar y por cuánto. Se buscan por su
//   FECHA DE PEDIDO dentro del rango (y del cliente, si hay uno elegido). Esa plata NO está en los totales:
//   entra al reporte el día que se cobra. Si no hay ninguno, la nota se oculta.
//   (Antes eran los pedidos ENTREGADO_IMPAGO; ahora es ENTREGADO con saldo mayor a cero, de VW_PEDIDO_SALDO.)
// -----------------------------------------------------------------------------
async function mostrarNotaImpagos(fDesde, fHasta, idCliente) {
  const nota = document.getElementById('nota-resumen-impagos');
  if (!nota) return;

  let query = supabaseAdmin
    .from('VW_PEDIDO_SALDO')
    .select('id_pedido, saldo')
    .eq('estado', 'ENTREGADO')
    .gt('saldo', 0)
    .gte('fecha', fDesde)
    .lte('fecha', fHasta);
  if (idCliente) query = query.eq('id_cliente', idCliente);

  const { data, error } = await query;

  // Si la consulta falla, no se muestra nada: es solo un aviso extra, el reporte sigue igual.
  if (error || !data || data.length === 0) {
    nota.classList.add('d-none');
    return;
  }

  const cantidad = data.length;
  const monto = formatearPesos(data.reduce((suma, p) => suma + Number(p.saldo || 0), 0));
  nota.innerText = `Hay ${cantidad} ${cantidad === 1 ? 'pedido entregado' : 'pedidos entregados'} con saldo sin cobrar en este período, por ${monto}. No están incluidos en los totales: aparecen cuando se cobran.`;
  nota.classList.remove('d-none');
}


// -----------------------------------------------------------------------------
// mostrarNotaDescuento  (interna)
//   Como la bonificación no es una fila, los totales ya la traen restada. Esta nota lo
//   aclara debajo de la tabla. Con 0 se oculta.
// -----------------------------------------------------------------------------
function mostrarNotaDescuento(descuento) {
  const nota = document.getElementById('nota-resumen-descuento');
  if (!nota) return;
  const hay = Number(descuento) !== 0;
  nota.classList.toggle('d-none', !hay);
  if (hay) {
    const monto = formatearPesos(Math.abs(descuento));
    nota.innerText = `Los totales incluyen descuentos por docena por -${monto}.`;
  }
}

// Dibuja una tarjeta por grupo, con ventas en el rango. Orden alfabético y "Otros" al final.
// conMonto = false (solapa "Entregado"): las tarjetas muestran solo unidades, sin importes.
function renderizarTarjetasGrupos(tarjetas, conMonto = true) {
  const cont = document.getElementById('contenedor-kpis-grupos');
  if (!cont) return;

  const claves = Object.keys(tarjetas).sort((a, b) =>
    (a === 'OTROS') - (b === 'OTROS') || a.localeCompare(b));

  // Sin ventas en el rango no hay tarjetas (la tabla de abajo ya avisa que no hay datos).
  if (claves.length === 0) {
    cont.innerHTML = '';
    return;
  }

  const html = claves.map(clave => {
    const g = tarjetas[clave];
    // Las docenas se muestran solo si el grupo tiene productos que permiten docena.
    const docenas = g.unidadesDocena > 0
      ? ` <small class="text-muted">(${formatearDocenas(g.unidadesDocena)} doc.)</small>`
      : '';
    const lineaMonto = conMonto
      ? `<span class="progress-description text-success font-weight-bold">${formatearPesos(g.monto)}</span>`
      : '';
    return `
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          ${decoracionTarjeta(clave)}
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">${esc(tituloTarjeta(clave, g.pestanas))}</span>
            <span class="info-box-number text-dark">${formatearUnidades(g.unidades)} u.${docenas}</span>
            ${lineaMonto}
          </div>
        </div>
      </div>`;
  }).join('');

  // Con más de 3 grupos, las tarjetas pasan a una segunda fila.
  cont.innerHTML = `<div class="row mb-3">${html}</div>`;
}
