import { supabaseAdmin } from './config.js';
import { carrito, setPedidoEditandoId, setPedidoEditandoEstado, setPedidoPagoOrigen, setCarrito } from './state.js';
import { mostrarNotificacion, obtenerFechaActualISO, mensajeErrorFuncion, confirmarAccion, confirmarEntregaConSaldo, esErrorDeConexion, nuevaClaveOperacion } from './utils.js';
import { mostrarAvisoConAccion } from './avisoAccion.js';   // aviso fijo cuando se corta la conexión y no se sabe si el cobro quedó registrado
import { abrirModalCobro } from './cobro.js';
import { cargarPOS, renderizarGrillaPOS, alCambiarCliente, esperarPOSListo, actualizarModoEdicionPOS, guardarFotoPedidoEditando } from './pos.js';
import { navegarA } from './main.js';
import { obtenerPedidoParaImprimir, imprimirComprobante } from './impresion.js';
import { btnFila, itemMenuMas } from './menuMas.js';   // botones de la fila y menú "Más"
import { puedeAlMenos } from './roles.js';   // el rol decide si se ve "Anular pedido"
import { telefonoParaWhatsApp } from './telefono.js';   // teléfono del cliente -> formato de WhatsApp
import { esPedidoNuevoSinVer, marcarVistos, marcarTodosVistos } from './avisoPedidos.js';   // "NUEVO" / visto de los pedidos web
import { pedirMotivoAnulacion } from './motivoAnulacion.js';   // ventana que pide el motivo al anular
import { verHistorialPedido } from './historialPedido.js';   // ventana "Ver historial" de un pedido
import { elegirPedidoDestino, elegirQueHacerConElPago } from './traspasoPago.js';   // ventana para elegir el pedido que recibe un pago traspasado

// Escapa texto antes de insertarlo con innerHTML (evita inyección de HTML/JS).
// nombre_referencia y observaciones los escribe un cliente anónimo desde la web.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// -----------------------------------------------------------------------------
// AVISO "PEDIDO LISTO" POR WHATSAPP (opcional, gratis)
// El botón abre WhatsApp (app o WhatsApp Web) con el chat del cliente y el mensaje ya escrito;
// la persona del local toca "enviar". Es un link wa.me: no usa la API de Meta ni tiene costo.
// -----------------------------------------------------------------------------

// Los pedidos web guardan el nombre como "Juan Pérez (Tel: 1122334455)". Para el saludo se saca el teléfono.
function nombreSinTelefono(texto) {
  return String(texto ?? '').replace(/\s*\(\s*tel[^)]*\)\s*$/i, '').trim();
}

// Días de diferencia entre el día del pedido y hoy (ambos 'AAAA-MM-DD'). Hoy = 0, ayer = 1.
function diasDesde(fechaISO, hoyISO) {
  const aUTC = (iso) => { const [a, m, d] = String(iso).split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((aUTC(hoyISO) - aUTC(fechaISO)) / 86400000);
}

// El teléfono que viene escrito dentro del nombre ("Juan Pérez (Tel: 1122334455)" -> "1122334455"). Sirve para pedidos
// viejos que no tienen la columna telefono cargada. Devuelve '' si no hay.
function telefonoDeNombre(texto) {
  const m = String(texto ?? '').match(/\(\s*tel[^:)]*:?\s*([^)]*)\)\s*$/i);
  return m ? m[1].trim() : '';
}

// Minúsculas y sin tildes, para buscar sin que importen.
const normalizarTexto = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// ¿El pedido coincide con lo que se escribió en el buscador? Se busca por:
//   - solo números: número de pedido (empieza con eso) o teléfono (si son 3 o más dígitos, en cualquier parte);
//     se ignoran espacios, guiones, paréntesis y "+" ("11 3646-2693" encuentra 1136462693);
//   - letras: el nombre (todas las palabras tienen que estar), sin importar mayúsculas ni tildes.
function coincideBusqueda(p, texto) {
  const q = normalizarTexto(texto).replace(/#/g, '').trim();
  if (!q) return true;
  const soloDigitos = q.replace(/[\s\-.()+]/g, '');
  const nombre = normalizarTexto(`${nombreSinTelefono(p.nombre_referencia)} ${p.TB_BCLIENTES?.nombre || ''}`);
  if (/^\d+$/.test(soloDigitos)) {
    const tel = String(p.telefono || telefonoDeNombre(p.nombre_referencia)).replace(/\D/g, '');
    return String(p.id).startsWith(soloDigitos) || (soloDigitos.length >= 3 && tel.includes(soloDigitos));
  }
  return q.split(/\s+/).every(palabra => nombre.includes(palabra));
}

// Texto del mensaje de "pedido listo". Se puede cambiar libremente.
// Si el pedido ya está pago NO se pide plata: se avisa que está pago. Si falta cobrar, se pide solo el saldo.
function mensajePedidoListo(nombre, idPedido, saldo) {
  const saludo = nombre ? `Hola ${nombre}!` : 'Hola!';
  const falta = Number(saldo || 0);
  const cierre = falta > 0
    ? `Saldo a abonar: $${falta.toLocaleString('es-AR', { maximumFractionDigits: 2 })}.`
    : 'Ya está pago.';
  return `${saludo} Tu pedido #${idPedido} de Cruditas ya está listo para retirar. ${cierre} ¡Te esperamos!`;
}

// Variable para conservar el id del pedido que se está viendo en el modal
let pedidoActualModalId = null;

// Vista del listado: 'PENDIENTES' (la de siempre al entrar: sin filtros, solo lo que falta
// hacer) o 'HISTORIAL' (la tabla con filtros de fecha, estado y búsqueda).
let modoPedidos = 'PENDIENTES';
let numeroConsultaPendientes = 0;   // descarta respuestas viejas si se cambia de vista a mitad de carga
// Pendientes = lo que hay que hacer: en preparación, listos, entregados con saldo distinto de cero (falta cobrar o hay
// que devolver) y anulados con plata todavía sin devolver ni traspasar (script 51). "Completado" ya no es un estado: es ENTREGADO con saldo cero, y no figura en Pendientes.
// El saldo sale de la vista VW_PEDIDO_SALDO (pagos del pedido, scripts 49 y 50c).
const FILTRO_PENDIENTES = 'estado.in.(EN_PREPARACION,LISTO),and(estado.eq.ENTREGADO,saldo.neq.0),and(estado.eq.ANULADO,a_devolver.gt.0)';
const COLUMNAS_PEDIDO = 'id, fecha, created_at, estado, importe_total, nombre_referencia, observaciones, canal, telefono, TB_BCLIENTES(nombre)';

const redondear = (n) => Math.round(Number(n || 0) * 100) / 100;
const pesos = (n) => `$${redondear(n).toLocaleString('es-AR')}`;

// -----------------------------------------------------------------------------
// traerSaldos  (interna)
//   Pagado, saldo y medios de varios pedidos de una vez. Devuelve { [idPedido]: {...} }.
//   La vista la pueden leer los tres roles (la tabla de pagos solo Encargado y Dueño).
// -----------------------------------------------------------------------------
async function traerSaldos(ids) {
  if (!ids || ids.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from('VW_PEDIDO_SALDO')
    .select('id_pedido, importe_total, pagado, saldo, cantidad_pagos, medios, cuentas, a_devolver')
    .in('id_pedido', ids);
  if (error) throw error;
  const mapa = {};
  (data || []).forEach(r => {
    mapa[r.id_pedido] = {
      pagado: redondear(r.pagado), saldo: redondear(r.saldo), cantidadPagos: Number(r.cantidad_pagos || 0),
      medios: r.medios || '', cuentas: r.cuentas || '', aDevolver: redondear(r.a_devolver)
    };
  });
  return mapa;
}

// Si por algún motivo no hay datos de saldo de un pedido, se lo trata como sin pagos.
// aDevolver = plata para devolver: en un pedido anulado, todo lo pagado; en uno vigente, lo pagado de más.
const saldoDe = (mapa, p) => mapa[p.id] || { pagado: 0, saldo: redondear(p.importe_total), cantidadPagos: 0, medios: '', cuentas: '', aDevolver: 0 };

// Entrar al listado desde el menú (o desde la campana): siempre arranca en Pendientes.
export function abrirListadoPedidos() {
  cambiarModoPedidos('PENDIENTES');
}

export function cambiarModoPedidos(modo) {
  modoPedidos = (modo === 'HISTORIAL') ? 'HISTORIAL' : 'PENDIENTES';
  const esPend = modoPedidos === 'PENDIENTES';

  document.getElementById('btn-modo-pendientes')?.classList.toggle('active', esPend);
  document.getElementById('btn-modo-pendientes')?.classList.toggle('btn-warning', esPend);
  document.getElementById('btn-modo-pendientes')?.classList.toggle('btn-outline-secondary', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('active', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('btn-info', !esPend);
  document.getElementById('btn-modo-historial')?.classList.toggle('btn-outline-secondary', esPend);

  document.getElementById('filtros-historial')?.classList.toggle('d-none', esPend);
  document.getElementById('kpis-historial')?.classList.toggle('d-none', esPend);
  document.getElementById('resumen-pendientes')?.classList.toggle('d-none', !esPend);
  document.getElementById('btn-actualizar-pendientes')?.classList.toggle('d-none', !esPend);
  document.getElementById('buscador-pendientes')?.classList.toggle('d-none', !esPend);
  if (!esPend) document.getElementById('btn-marcar-vistos')?.classList.add('d-none');

  return cargarTablaPedidos();
}

export async function cargarTablaPedidos() {
  // En Pendientes la tabla muestra menos columnas (sin fecha ni medio de pago): lo decide esta clase (aviso-pedidos.css).
  document.getElementById('tabla-pedidos-body')?.closest('table')?.classList.toggle('tabla-pendientes', modoPedidos === 'PENDIENTES');

  if (modoPedidos === 'PENDIENTES') {
    await cargarPendientes();
    return;
  }

  const inputDesde = document.getElementById('filtro-fecha-desde');
  const inputHasta = document.getElementById('filtro-fecha-hasta');
  const inputBuscar = document.getElementById('filtro-buscar-pedido');
  
  if (inputDesde && !inputDesde.value) {
    const hoy = obtenerFechaActualISO(); // fecha local (Argentina), no UTC
    inputDesde.value = hoy;
    inputHasta.value = hoy;
  }

  // Se filtra por la columna "fecha" (día local), igual que el cierre de caja
  const fechaDesde = inputDesde.value;
  const fechaHasta = inputHasta.value;
  const estadoFiltro = document.getElementById('filtro-estado-pedido').value;

  let query = supabaseAdmin
    .from('TB_TPEDIDOS')
    .select(COLUMNAS_PEDIDO)
    .gte('fecha', fechaDesde)
    .lte('fecha', fechaHasta)
    .order('id', { ascending: false });

  if (estadoFiltro !== 'TODOS') {
    query = query.eq('estado', estadoFiltro);
  }

  const { data: pedidos, error } = await query;
  if (error) {
    console.error('Error al cargar pedidos:', error);
    return;
  }

  let pedidosFiltrados = pedidos || [];
  if (inputBuscar && inputBuscar.value.trim() !== '') {
    pedidosFiltrados = pedidosFiltrados.filter(p => coincideBusqueda(p, inputBuscar.value));
  }

  // Saldos de lo que se está mostrando (una sola consulta).
  let saldos = {};
  try {
    saldos = await traerSaldos(pedidosFiltrados.map(p => p.id));
  } catch (errSaldos) {
    console.error('Error al cargar los saldos:', errSaldos);
    mostrarNotificacion('No se pudieron cargar los pagos de los pedidos.', 'danger');
    return;
  }

  // Total cobrado = lo pagado en los pedidos (sin los anulados). Pendiente de cobro = lo que se debe de pedidos ya entregados.
  let totalCobrado = 0;
  let totalPendienteCobro = 0;
  let cantPreparacion = 0;
  let cantPreparados = 0;
  let cantAnulados = 0;

  pedidosFiltrados.forEach(p => {
    const s = saldoDe(saldos, p);
    if (p.estado !== 'ANULADO') totalCobrado += s.pagado;
    if (p.estado === 'ENTREGADO' && s.saldo > 0) totalPendienteCobro += s.saldo;
    if (p.estado === 'EN_PREPARACION') cantPreparacion++;
    if (p.estado === 'LISTO') cantPreparados++;
    if (p.estado === 'ANULADO') cantAnulados++;
  });

  if (document.getElementById('kpi-total-cobrado')) {
    document.getElementById('kpi-total-cobrado').innerText = `$${totalCobrado.toLocaleString('es-AR')}`;
    document.getElementById('kpi-total-pendiente-cobro').innerText = `$${totalPendienteCobro.toLocaleString('es-AR')}`;
    document.getElementById('kpi-cant-preparacion').innerText = cantPreparacion;
    document.getElementById('kpi-cant-preparados').innerText = cantPreparados;
    document.getElementById('kpi-cant-anulados').innerText = cantAnulados;
  }

  const tbody = document.getElementById('tabla-pedidos-body');
  if (!tbody) return;

  if (pedidosFiltrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-3">No hay pedidos registrados para estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = pedidosFiltrados.map(p => filaPedidoHtml(p, saldoDe(saldos, p))).join('');
}

// Una fila de la tabla de pedidos. La usan las dos vistas (Pendientes e Historial).
//   opciones (solo Pendientes): { grupo: clave del grupo al que pertenece, oculta: el grupo está plegado }
function filaPedidoHtml(p, s, opciones = {}) {
  const { grupo = '', oculta = false } = opciones;
  const clienteCrudo = p.nombre_referencia || p.TB_BCLIENTES?.nombre || 'Consumidor Final';
  // Nombre arriba y teléfono debajo (los pedidos web guardan "Nombre (Tel: ...)" en el nombre).
  const clienteNombre = nombreSinTelefono(clienteCrudo) || clienteCrudo;
  const telefonoCliente = String(p.telefono || '').trim() || telefonoDeNombre(clienteCrudo);
  const htmlTelefono = telefonoCliente
    ? `<div class="cliente-tel"><i class="fas fa-phone-alt mr-1"></i>${esc(telefonoCliente)}</div>`
    : '';
  // Medios y cuentas de lo cobrado (pueden ser varios si se pagó en partes). Sin pagos: un guion.
  const medioBase = s.medios;
  const cuentaPago = s.cuentas;   // el efectivo no tiene cuenta para mostrar
  const medioPago = medioBase
    ? `<small class="badge badge-light border">${esc(medioBase)}</small>`
      + (cuentaPago ? `<div class="small text-muted">${esc(cuentaPago)}</div>` : '')
    : '<span class="text-muted">-</span>';
  // Marca del canal de venta (solo se muestra si no es MOSTRADOR, para no saturar la tabla)
  const badgeCanal = (p.canal && p.canal !== 'MOSTRADOR')
    ? ` <span class="badge badge-dark ml-1">${esc(p.canal)}</span>`
    : '';
  const nuevoSinVer = esPedidoNuevoSinVer(p);   // pedido web que este equipo todavía no vio
  const etiquetaNuevo = nuevoSinVer ? ' <span class="badge badge-danger ml-1">NUEVO</span>' : '';
  const hora = new Date(p.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' });
  
  const htmlObservaciones = p.observaciones 
  ? `<div class="mt-1"><span class="badge badge-warning text-dark border"><i class="fas fa-comment-alt mr-1"></i> ${esc(p.observaciones)}</span></div>` 
  : '';

  const fechaPedido = new Date(`${p.fecha.split('T')[0]}T00:00:00`).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // En Pendientes, un pedido de un día anterior se marca en rojo (se quedó sin cerrar)
  const esPend = modoPedidos === 'PENDIENTES';
  const fechaAtrasada = esPend && p.fecha.split('T')[0] < obtenerFechaActualISO();
  // Etiqueta discreta junto al número ("Ayer", "Hace 3 días"); los pedidos de hoy no llevan nada. La fecha y la hora siguen visibles.
  const diasAtras = fechaAtrasada ? diasDesde(p.fecha.split('T')[0], obtenerFechaActualISO()) : 0;
  const etiquetaAntiguedad = diasAtras > 0
    ? ` <span class="etiqueta-antiguedad">${diasAtras === 1 ? 'Ayer' : `Hace ${diasAtras} días`}</span>`
    : '';
  // En Pendientes alcanza con la hora (sin año); si el pedido es de otro día se agrega el día, en rojo.
  const diaCorto = new Date(`${p.fecha.split('T')[0]}T00:00:00`).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  const textoHora = fechaAtrasada ? `${diaCorto} · ${hora}` : hora;

  // Estado físico (cocina) y, aparte, el estado de pago (calculado con los pagos del pedido).
  let badgeClass = 'badge-secondary';
  let estadoTexto = p.estado;

  if (p.estado === 'EN_PREPARACION') { badgeClass = 'badge-info'; estadoTexto = '⏳ En Preparación'; }
  if (p.estado === 'LISTO') { badgeClass = 'badge-primary'; estadoTexto = '🔔 Listo'; }
  if (p.estado === 'ENTREGADO') { badgeClass = 'badge-secondary'; estadoTexto = '📦 Entregado'; }
  if (p.estado === 'ANULADO') { badgeClass = 'badge-danger'; estadoTexto = '🚫 Anulado'; }

  const saldo = s.saldo;
  const debe = p.estado !== 'ANULADO' && saldo > 0;
  const hayDevolucion = s.aDevolver > 0;   // hay plata para devolver (o traspasar si el pedido está anulado)
  const puedeDevolver = hayDevolucion && puedeAlMenos('ENCARGADO');
  const bp = (clase, texto) => `<span class="badge ${clase}${esPend ? ' p-2' : ''}">${texto}</span>`;   // en Pendientes, más grande
  let etiquetaPago = '';
  if (hayDevolucion) {
    etiquetaPago = bp('badge-danger', `Devolver ${pesos(s.aDevolver)}`);
  } else if (p.estado !== 'ANULADO') {
    if (saldo === 0 && s.pagado > 0) etiquetaPago = bp('badge-success', 'Pagado ✓');
    else if (debe && s.pagado > 0) etiquetaPago = bp('badge-warning', `Pago parcial · falta ${pesos(saldo)}`);
    else if (debe && p.estado === 'ENTREGADO') etiquetaPago = bp('badge-warning', `Debe ${pesos(saldo)}`);
    else if (debe) etiquetaPago = bp('badge-light border text-muted', 'Sin pagar');
  }

  // BOTONES DE LA FILA
  // A la vista, con texto: solo lo que hace avanzar el pedido (preparar, cobrar, entregar).
  // Todo lo demás va dentro del menú "Más". Los data-action y las clases btn-print-*
  // son los de siempre, así que main.js y el escuchador de impresión (al final de este
  // archivo) siguen funcionando sin cambios. El menú "Más" se abre con menuMas.js.
  const idPed = p.id;
  const cambiar = (estado) => `data-action="cambiar-estado" data-id="${idPed}" data-estado="${estado}"`;
  const accionVer = `data-action="ver-detalle" data-id="${idPed}"`;
  const visibles = [];
  const enMenu = [];

  const cobrar = (entregar) => `data-action="cobrar-pedido" data-id="${idPed}" data-entregar="${entregar ? 1 : 0}"`;
  let hayVerDetalleVisible = false;

  if (p.estado === 'EN_PREPARACION') {
    visibles.push(btnFila('btn-accion-pagar', 'fa-box-open', 'Marcar listo', cambiar('LISTO')));
    // Pago por adelantado: se puede cobrar mientras está en cocina, sin cambiar su estado.
    if (debe) visibles.push(btnFila('btn-accion-cobrar-sec', 'fa-dollar-sign', 'Cobrar', cobrar(false)));   // contorno: la acción principal es "Marcar listo"
  } else if (p.estado === 'LISTO') {
    if (debe) {
      visibles.push(btnFila('btn-accion-cobrar', 'fa-check', 'Cobrar y entregar', cobrar(true)));
    } else {
      visibles.push(btnFila('btn-accion-cobrar', 'fa-check', 'Entregar', cambiar('ENTREGADO')));   // ya está pago
    }
  } else if (p.estado === 'ENTREGADO' && debe) {
    visibles.push(btnFila('btn-accion-cobrar', 'fa-dollar-sign', 'Registrar cobro', cobrar(false)));
  } else {
    // ENTREGADO y saldado, ENTREGADO con devolución pendiente, o ANULADO: la consulta queda a la vista
    // (salvo que haya plata para devolver y quien mira pueda hacerlo: ahí van esos botones y "Ver detalle" en el menú).
    if (!puedeDevolver) {
      visibles.push(btnFila('btn-accion-ver', 'fa-eye', 'Ver detalle', accionVer));
      hayVerDetalleVisible = true;
    }
  }

  // Devolver la plata (efectivo del cajón o desde una cuenta). Solo Encargado y Dueño (la base también lo verifica).
  if (puedeDevolver) {
    visibles.push(btnFila('btn-accion-cobrar', 'fa-undo', 'Devolver', `data-action="devolver-pedido" data-id="${idPed}"`));
    // En un pedido anulado, además, el pago se puede pasar a un pedido nuevo.
    if (p.estado === 'ANULADO') {
      visibles.push(btnFila('btn-accion-aviso', 'fa-exchange-alt', 'Traspasar pago', `data-action="traspasar-pago" data-id="${idPed}"`));
    }
  }

  // Pedido web nuevo: botón para marcarlo como visto sin tener que abrirlo
  if (nuevoSinVer) {
    visibles.push(btnFila('btn-accion-ver btn-accion-icono', 'fa-eye', '', `data-action="marcar-visto" data-id="${idPed}" title="Marcar como visto" aria-label="Marcar como visto"`));
  }

  // Menú "Más" (el orden es el que se ve en pantalla)
  // Pedido LISTO con teléfono válido: avisar al cliente por WhatsApp (opcional).
  const telWS = telefonoParaWhatsApp(p.telefono);
  if (p.estado === 'LISTO' && telWS) {
    enMenu.push(itemMenuMas(
      'fa-comment-dots',
      'Avisar por WhatsApp',
      `data-id="${idPed}" data-tel="${telWS}" data-nombre="${esc(nombreSinTelefono(p.nombre_referencia))}" data-saldo="${Math.max(saldo, 0)}"`,
      'btn-avisar-ws'
    ));
  }
  if (!hayVerDetalleVisible) {
    enMenu.push(itemMenuMas('fa-eye', 'Ver detalle', accionVer));
  }
  // Anulado con plata: además de Devolver / Traspasar pago, armar el pedido nuevo con ese pago (opción B).
  if (puedeDevolver && p.estado === 'ANULADO') {
    enMenu.push(itemMenuMas('fa-plus-circle', 'Cargar pedido nuevo con este pago', `data-action="pedido-con-pago" data-id="${idPed}"`));
  }
  // Un pedido listo que todavía debe plata: el botón visible cobra y entrega. Las otras dos salidas (menos frecuentes)
  // van acá: cobrar sin entregar, o entregar sin cobrar (queda como "Entregado, falta cobrar"; pide confirmación).
  if (p.estado === 'LISTO' && debe) {
    enMenu.push(itemMenuMas('fa-dollar-sign', 'Cobrar (sin entregar)', cobrar(false)));
    enMenu.push(itemMenuMas('fa-truck', 'Entregar sin cobrar', cambiar('ENTREGADO')));
  }
  // Volver atrás un "Marcar listo" hecho por error (script 63): el pedido vuelve a En preparación. Pide confirmación.
  if (p.estado === 'LISTO') {
    enMenu.push(itemMenuMas('fa-undo-alt', 'Volver a En preparación', cambiar('EN_PREPARACION')));
  }
  // Un pedido con pagos no se edita: para cambiarlo se anula y se carga uno nuevo, y se traspasa el pago (botón "Traspasar pago").
  if ((p.estado === 'EN_PREPARACION' || p.estado === 'LISTO') && s.pagado === 0) {
    enMenu.push(itemMenuMas('fa-edit', 'Editar pedido', `data-action="editar-pedido" data-id="${idPed}"`));
  }
  enMenu.push(itemMenuMas('fa-receipt', 'Comanda de cocina', `data-id="${idPed}"`, 'btn-print-cocina'));
  enMenu.push(itemMenuMas('fa-print', 'Ticket del cliente', `data-id="${idPed}"`, 'btn-print-cliente'));
  
  // Historial de cambios de estado del pedido (quién y cuándo): solo Encargado y Dueño; la base también lo verifica.
  if (puedeAlMenos('ENCARGADO')) {
    enMenu.push(itemMenuMas('fa-history', 'Ver historial', `data-id="${idPed}"`, 'btn-ver-historial'));
  }

  // Anular un pedido: solo Encargado y Dueño (la base también lo verifica).
  if (p.estado !== 'ANULADO' && puedeAlMenos('ENCARGADO')) {
    enMenu.push('<div class="menu-mas-sep" role="separator"></div>');
    enMenu.push(itemMenuMas('fa-ban', 'Anular pedido', cambiar('ANULADO'), 'menu-mas-peligro'));
  }

  const botonesAccion = `
    <div class="acciones-fila">
      ${visibles.join('')}
      <div class="mas-wrap">
        <button type="button" class="btn btn-accion btn-accion-mas" aria-haspopup="true" aria-expanded="false" title="Más acciones">
          Más <i class="fas fa-chevron-down"></i>
        </button>
        <div class="menu-mas" role="menu">${enMenu.join('')}</div>
      </div>
    </div>
  `;

  // Celda de estado. Historial: estado (cocina) + etiqueta de pago. Pendientes: solo el pago (el estado ya lo dice el grupo)
  // y, si hubo cobros, con qué medio.
  const medioEnPago = (s.cantidadPagos > 0 && medioBase) ? `<div class="small text-muted mt-1">${esc(medioBase)}</div>` : '';
  const celdaEstadoPago = esPend && etiquetaPago
    ? `${etiquetaPago}${medioEnPago}`
    : `<span class="badge ${badgeClass} p-2">${esc(estadoTexto)}</span>${etiquetaPago ? `<div class="mt-1">${etiquetaPago}</div>` : ''}`;

  const clasesFila = [
    nuevoSinVer ? 'fila-pedido-nuevo' : '',
    grupo ? `fila-en-grupo g-${grupo}` : '',
    oculta ? 'd-none' : ''
  ].filter(Boolean).join(' ');

  return `
    <tr class="${clasesFila}"${grupo ? ` data-fila-grupo="${grupo}"` : ''}>
      <td class="font-weight-bold"><button type="button" class="btn-numero-pedido" data-action="ver-detalle" data-id="${p.id}" title="Ver detalle del pedido #${p.id}" aria-label="Ver detalle del pedido #${p.id}">#${p.id}</button>${etiquetaAntiguedad}${esPend ? `<div class="pedido-hora ${fechaAtrasada ? 'fecha-atrasada' : ''}">${textoHora} hs</div>` : ''}</td>
      <td class="col-fecha ${fechaAtrasada ? 'fecha-atrasada' : ''}">${fechaPedido} ${hora} hs</td>
      <td>
        <div class="font-weight-bold">${esc(clienteNombre)}${badgeCanal}${etiquetaNuevo}</div>
        ${htmlTelefono}
        ${htmlObservaciones}
      </td>
      <td class="col-medio">${medioPago}</td>
      <td class="text-right font-weight-bold">$${(p.importe_total || 0).toLocaleString('es-AR')}</td>
      <td class="text-center">${celdaEstadoPago}</td>
      <td class="text-center">${botonesAccion}</td>
    </tr>
  `;
}

// =============================================================================
// VISTA "PENDIENTES": en preparación, listos y entregados con saldo distinto de cero, sin filtros de
// fecha ni de estado. Agrupado por estado y, dentro de cada grupo, el más antiguo primero.
// =============================================================================
// Cada grupo es una tarea distinta: preparar, entregar, cobrar o devolver. "Entregados, falta cobrar" y "A devolver" van
// separados porque piden acciones opuestas. A devolver junta los anulados con plata y los entregados pagados de más.
const GRUPOS_PENDIENTES = [
  { clave: 'EN_PREPARACION', titulo: 'En preparación', chip: 'En preparación', icono: 'fa-hourglass-half', abierto: true, desc: 'Pedidos que se están armando en cocina' },
  { clave: 'LISTO', titulo: 'Listos para entregar', chip: 'Listos', icono: 'fa-bell', abierto: true, desc: 'Terminados, esperando que el cliente los retire' },
  { clave: 'POR_COBRAR', titulo: 'Entregados, falta cobrar', chip: 'Falta cobrar', icono: 'fa-dollar-sign', abierto: false, desc: 'Ya se los llevó y todavía no pagó' },
  { clave: 'A_DEVOLVER', titulo: 'A devolver', chip: 'A devolver', icono: 'fa-undo', abierto: false, desc: 'Plata para devolver: anulados o pagados de más' }
];

// A qué grupo va un pedido pendiente (s = su saldo, de saldoDe).
function claveGrupoPendiente(p, s) {
  if (p.estado === 'ANULADO') return 'A_DEVOLVER';
  if (p.estado === 'ENTREGADO') return s.aDevolver > 0 ? 'A_DEVOLVER' : 'POR_COBRAR';
  return p.estado;   // EN_PREPARACION o LISTO
}

// Apertura de los grupos de Pendientes
//  - Al entrar, cada grupo arranca como dice su campo `abierto` (En preparación y Listos abiertos; Falta cobrar y A devolver cerrados).
//  - Lo que la persona abre o cierra a mano (o con un chip) se recuerda mientras dure la sesión del navegador (sessionStorage): sobrevive
//    a recargar la página, no a cerrar el navegador, así cada día arranca con los valores por defecto. Se guarda SOLO lo que se tocó: el
//    resto sigue el valor por defecto. Las actualizaciones automáticas de la lista no lo pisan (solo redibujan con lo guardado).
//  - Con una búsqueda escrita se muestran solo los grupos con resultados y esos se abren solos, SIN cambiar lo guardado. Si la persona
//    cierra uno durante la búsqueda, vale hasta que cambie el texto. Al borrar la búsqueda vuelve lo que había antes.
const CLAVE_GRUPOS_ESTADO = 'cruditas_pedidos_grupos_estado';
try { localStorage.removeItem('cruditas_pedidos_grupos_plegados'); } catch (e) { /* versión anterior: se descarta */ }
function leerEleccionesGrupos() {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_GRUPOS_ESTADO) || '{}');
    return guardado && typeof guardado === 'object' && !Array.isArray(guardado) ? guardado : {};
  } catch (e) {
    return {};
  }
}
let eleccionesGrupos = leerEleccionesGrupos();   // { CLAVE: true (abierto) | false (cerrado) } solo de lo que se tocó
let eleccionesBusqueda = {};                      // lo mismo, pero solo mientras hay una búsqueda escrita
function guardarEleccionesGrupos() {
  try {
    sessionStorage.setItem(CLAVE_GRUPOS_ESTADO, JSON.stringify(eleccionesGrupos));
  } catch (e) { /* sin almacenamiento: la elección vale solo hasta recargar */ }
}
function hayBusquedaPendientes() {
  return (document.getElementById('buscar-pendientes')?.value || '').trim() !== '';
}

// ¿Está abierto el grupo? (búsqueda > lo que tocó la persona > valor por defecto)
function grupoAbierto(clave) {
  if (hayBusquedaPendientes()) return eleccionesBusqueda[clave] ?? true;
  if (typeof eleccionesGrupos[clave] === 'boolean') return eleccionesGrupos[clave];
  return GRUPOS_PENDIENTES.find(g => g.clave === clave)?.abierto ?? true;
}

// Abre o cierra un grupo sin volver a consultar la base: solo muestra u oculta sus filas.
function fijarGrupoAbierto(clave, abierto) {
  if (hayBusquedaPendientes()) {
    eleccionesBusqueda[clave] = abierto;
  } else {
    eleccionesGrupos[clave] = abierto;
    guardarEleccionesGrupos();
  }
  const tbody = document.getElementById('tabla-pedidos-body');
  if (!tbody) return;
  tbody.querySelectorAll(`tr[data-fila-grupo="${clave}"]`).forEach(tr => tr.classList.toggle('d-none', !abierto));
  const boton = tbody.querySelector(`.grupo-toggle[data-grupo="${clave}"]`);
  boton?.setAttribute('aria-expanded', String(abierto));
  boton?.closest('tr')?.classList.toggle('plegado', !abierto);
}
function alternarGrupoPendientes(clave) {
  fijarGrupoAbierto(clave, !grupoAbierto(clave));
}

// Atajo de los chips: abre el grupo (si estaba plegado) y baja hasta su encabezado.
function irAGrupoPendientes(clave) {
  if (!grupoAbierto(clave)) fijarGrupoAbierto(clave, true);
  document.querySelector(`.grupo-toggle[data-grupo="${clave}"]`)?.closest('tr')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Chips de arriba: uno por grupo que tenga pedidos, con la cantidad y, en "falta cobrar" y "a devolver", el monto.
function htmlChipsPendientes(porGrupo, saldos) {
  return GRUPOS_PENDIENTES
    .filter(g => (porGrupo[g.clave] || []).length > 0)
    .map(g => {
      const lista = porGrupo[g.clave];
      const suma = (f) => lista.reduce((acc, p) => acc + f(saldoDe(saldos, p)), 0);
      let monto = '';
      if (g.clave === 'POR_COBRAR') monto = pesos(suma(s => s.saldo));
      if (g.clave === 'A_DEVOLVER') monto = pesos(suma(s => s.aDevolver));
      return `<button type="button" class="chip-grupo g-${g.clave}" data-grupo="${g.clave}" title="Ir a: ${g.titulo}">`
        + `<i class="fas ${g.icono}" aria-hidden="true"></i><span>${g.chip}</span><b class="chip-cant">${lista.length}</b>`
        + (monto ? `<span class="chip-monto">${monto}</span>` : '')
        + `</button>`;
    })
    .join('');
}

// Encabezado del grupo + sus filas (y un espacio antes, salvo el primero). Plegado, el encabezado sigue mostrando la
// cantidad, el subtotal y, en rojo, si adentro hay pedidos nuevos sin ver o de un día anterior.
function htmlGrupoPendientes(g, lista, saldos, hoy, esPrimero) {
  const plegado = !grupoAbierto(g.clave);
  const suma = (f) => lista.reduce((acc, p) => acc + f(saldoDe(saldos, p)), 0);
  let subtotal = '';
  if (g.clave === 'POR_COBRAR') subtotal = `${pesos(suma(s => s.saldo))} por cobrar`;
  if (g.clave === 'A_DEVOLVER') subtotal = `${pesos(suma(s => s.aDevolver))} a devolver`;

  const nuevos = lista.filter(esPedidoNuevoSinVer).length;
  const atrasados = lista.filter(p => p.fecha.split('T')[0] < hoy).length;
  const alertas = (nuevos > 0 ? `<span class="badge badge-danger">${nuevos} nuevo${nuevos !== 1 ? 's' : ''}</span>` : '')
    + (atrasados > 0 ? `<span class="badge badge-danger">${atrasados === 1 ? '1 de un día anterior' : `${atrasados} de días anteriores`}</span>` : '');

  const espacio = esPrimero ? '' : '<tr class="fila-grupo-espacio" aria-hidden="true"><td colspan="7"></td></tr>';
  const cabecera = `
    <tr class="fila-grupo-estado g-${g.clave}${plegado ? ' plegado' : ''}">
      <td colspan="7">
        <button type="button" class="grupo-toggle" data-grupo="${g.clave}" aria-expanded="${!plegado}">
          <i class="fas fa-chevron-down grupo-chevron" aria-hidden="true"></i>
          <i class="fas ${g.icono}" aria-hidden="true"></i>
          <span class="grupo-titulo">${g.titulo}</span>
          <span class="grupo-cant">${lista.length}</span>
          <span class="grupo-alertas">${alertas}</span>
          <span class="grupo-desc">${g.desc}</span>
          ${subtotal ? `<span class="grupo-subtotal">${subtotal}</span>` : ''}
        </button>
      </td>
    </tr>`;
  const filas = lista.map(p => filaPedidoHtml(p, saldoDe(saldos, p), { grupo: g.clave, oculta: plegado })).join('');
  return espacio + cabecera + filas;
}

async function cargarPendientes() {
  const numero = ++numeroConsultaPendientes;

  // 1) La vista dice cuáles son los pendientes (y trae su saldo); 2) se piden esos pedidos completos.
  let saldos = {};
  let data = [];
  let error = null;
  try {
    const { data: filas, error: errVista } = await supabaseAdmin
      .from('VW_PEDIDO_SALDO')
      .select('id_pedido, importe_total, pagado, saldo, cantidad_pagos, medios, cuentas, a_devolver')
      .or(FILTRO_PENDIENTES)
      .limit(500);
    if (errVista) throw errVista;
    (filas || []).forEach(r => {
      saldos[r.id_pedido] = {
        pagado: redondear(r.pagado), saldo: redondear(r.saldo), cantidadPagos: Number(r.cantidad_pagos || 0),
        medios: r.medios || '', cuentas: r.cuentas || '', aDevolver: redondear(r.a_devolver)
      };
    });
    const ids = (filas || []).map(r => r.id_pedido);
    if (ids.length > 0) {
      const res = await supabaseAdmin
        .from('TB_TPEDIDOS')
        .select(COLUMNAS_PEDIDO)
        .in('id', ids)
        .order('created_at', { ascending: true });
      if (res.error) throw res.error;
      data = res.data || [];
    }
  } catch (e) {
    error = e;
  }

  // Si mientras tanto se pidió otra carga o se cambió de vista, esta respuesta ya no sirve.
  if (numero !== numeroConsultaPendientes || modoPedidos !== 'PENDIENTES') return;

  if (error) {
    console.error('Error al cargar pedidos pendientes:', error);
    mostrarNotificacion('No se pudieron cargar los pedidos pendientes.', 'danger');
    return;
  }

  datosPendientes = { pedidos: data, saldos };
  const sinVer = data.filter(esPedidoNuevoSinVer).length;
  document.getElementById('btn-marcar-vistos')?.classList.toggle('d-none', sinVer === 0);
  dibujarPendientes();
}

// Dibuja chips y grupos con lo ya cargado, aplicando el buscador (sin consultar la base).
let datosPendientes = { pedidos: [], saldos: {} };
function dibujarPendientes() {
  const { pedidos: todos, saldos } = datosPendientes;
  const texto = (document.getElementById('buscar-pendientes')?.value || '').trim();
  document.getElementById('btn-limpiar-busqueda')?.classList.toggle('d-none', texto === '');
  const pedidos = texto ? todos.filter(p => coincideBusqueda(p, texto)) : todos;

  const porGrupo = {};
  pedidos.forEach(p => {
    const clave = claveGrupoPendiente(p, saldoDe(saldos, p));
    if (!porGrupo[clave]) porGrupo[clave] = [];
    porGrupo[clave].push(p);   // se conserva el orden: el más antiguo primero
  });

  const resumen = document.getElementById('resumen-pendientes');
  if (resumen) {
    resumen.innerHTML = htmlChipsPendientes(porGrupo, saldos)
      + (texto && todos.length > 0 ? `<span class="resumen-filtro">Mostrando ${pedidos.length} de ${todos.length}</span>` : '');
  }

  const tbody = document.getElementById('tabla-pedidos-body');
  if (!tbody) return;

  if (todos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-check-circle text-success mr-1"></i> No hay pedidos pendientes. Todo al día.</td></tr>`;
    return;
  }
  if (pedidos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-search mr-1"></i> Ningún pedido pendiente coincide con «${esc(texto)}».</td></tr>`;
    return;
  }

  const hoy = obtenerFechaActualISO();
  tbody.innerHTML = GRUPOS_PENDIENTES
    .filter(g => (porGrupo[g.clave] || []).length > 0)
    .map((g, i) => htmlGrupoPendientes(g, porGrupo[g.clave], saldos, hoy, i === 0))
    .join('');
}

// Botón "Visto" de una fila y botón "Marcar pedidos web como vistos"
export function marcarPedidoVisto(idPedido) {
  marcarVistos([idPedido]);
  cargarTablaPedidos();
}

export function marcarTodosLosPedidosVistos() {
  marcarTodosVistos();
  cargarTablaPedidos();
}

// Refresco automático cuando otro equipo (o un cliente desde la web) cambia pedidos.
// Si hay un menú "Más" abierto no se redibuja la tabla (se cerraría en la cara de la persona):
// se espera unos segundos y se vuelve a intentar.
function hayMenuMasAbierto() {
  if (document.querySelector('.btn-accion-mas[aria-expanded="true"]')) return true;
  return [...document.querySelectorAll('.menu-mas')].some(m => {
    const est = getComputedStyle(m);
    return est.display !== 'none' && est.visibility !== 'hidden' && est.opacity !== '0' && m.getClientRects().length > 0;
  });
}

let temporizadorRefresco = null;
function programarRefrescoListado(espera = 500, intentos = 0) {
  clearTimeout(temporizadorRefresco);
  temporizadorRefresco = setTimeout(() => {
    const sec = document.getElementById('sec-pedidos-dia');
    if (!sec || sec.classList.contains('d-none')) return;   // la pantalla no está a la vista
    if (hayMenuMasAbierto() && intentos < 6) { programarRefrescoListado(4000, intentos + 1); return; }
    cargarTablaPedidos();
  }, espera);
}
document.addEventListener('pedidos:cambio', () => programarRefrescoListado());

export async function cambiarEstadoPedido(idPedido, nuevoEstado) {
  marcarVistos([idPedido]);   // si la persona actúa sobre un pedido web, ya lo vio

  // (Cobrar ya no es un cambio de estado: tiene su propia acción, cobrarPedido.)

  // Volver de Listo a En preparación (por un "Marcar listo" equivocado): se confirma, porque la cocina lo vuelve a ver como
  // pendiente de armar y, si ya se le avisó al cliente por WhatsApp que estaba listo, ese aviso no se anula.
  if (nuevoEstado === 'EN_PREPARACION') {
    const sigue = await confirmarAccion({
      titulo: 'Volver a En preparación',
      mensaje: `El pedido #${idPedido} vuelve a En preparación y se lo va a ver de nuevo como pendiente de armar.\nSi ya le avisaste al cliente por WhatsApp que estaba listo, ese aviso no se anula.`,
      textoConfirmar: 'Volver a En preparación'
    });
    if (!sigue) return;
  }

  // Entregar un pedido que todavía no está pagado por completo: se pide confirmación, porque queda como "Debe $X" en
  // Pendientes. Un pedido ya pagado por el total pasa directo. Si no se pudo consultar el saldo, decide la base.
  if (nuevoEstado === 'ENTREGADO') {
    try {
      const id = Number(idPedido);
      let saldo = (await traerSaldos([id]))[id]?.saldo;
      if (saldo === undefined) {   // sin datos de saldo: se lo trata como sin pagos
        const { data: ped } = await supabaseAdmin.from('TB_TPEDIDOS').select('importe_total').eq('id', id).single();
        saldo = redondear(ped?.importe_total);
      }
      if (saldo > 0 && !(await confirmarEntregaConSaldo(saldo))) return;
    } catch (e) { /* si no se pudo consultar, decide la base */ }
  }

  // Anular: primero se pide el motivo (lista corta). Si la persona cierra la ventana, no se anula.
  let motivoAnulacion = null;
  if (nuevoEstado === 'ANULADO') {
    // Un pedido con pagos se puede anular (script 51), pero la plata queda para devolver o traspasar: se avisa ANTES de pedir el motivo.
    try {
      const s = (await traerSaldos([Number(idPedido)]))[Number(idPedido)];
      if (s && s.pagado > 0) {
        const sigue = await confirmarAccion({
          titulo: 'Pedido con pagos',
          mensaje: `Este pedido ya tiene ${pesos(s.pagado)} pagados. Si lo anulás, esa plata queda para devolver al cliente o para traspasar a un pedido nuevo (lo vas a ver en Pendientes).`,
          textoConfirmar: 'Continuar', peligro: true
        });
        if (!sigue) return;
      }
    } catch (e) { /* si no se pudo consultar, decide la base */ }
    motivoAnulacion = await pedirMotivoAnulacion(idPedido);
    if (!motivoAnulacion) return;
  }

  // El servidor valida que la transición esté permitida y, al anular, que haya un motivo
  // válido (cambiar_estado_pedido, scripts 24, 48 y 49).
  const { data: resultado, error } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
    p_id_pedido: Number(idPedido),
    p_nuevo_estado: nuevoEstado,
    ...(motivoAnulacion ? { p_motivo: motivoAnulacion.motivo, p_detalle: motivoAnulacion.detalle } : {})
  });

  if (error) {
    // La base puede rechazar el cambio con un código (por ejemplo, si la caja del día ya está cerrada)
    // y mensajeErrorFuncion lo traduce a un mensaje claro.
    mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
  } else {
    cargarTablaPedidos();
    if (nuevoEstado === 'EN_PREPARACION') mostrarNotificacion(`Pedido #${idPedido} volvió a En preparación.`, 'info');
    if (nuevoEstado === 'ANULADO' && Number(resultado?.a_devolver) > 0) {
      await resolverPagoDeAnulado(Number(idPedido), Number(resultado.a_devolver));
    }
  }
}

// -----------------------------------------------------------------------------
// resolverPagoDeAnulado  (interna)
//   Apenas se anula un pedido pagado, se pregunta qué hacer con la plata: cargar un pedido nuevo con ese pago (B),
//   pasarlo a un pedido ya cargado (A), devolverlo, o resolverlo después (queda en Pendientes).
// -----------------------------------------------------------------------------
async function resolverPagoDeAnulado(idPedido, aDevolver) {
  const eleccion = await elegirQueHacerConElPago({ idOrigen: idPedido, aDevolver });
  if (eleccion === 'NUEVO') await cargarPedidoConPago(idPedido);
  else if (eleccion === 'TRASPASAR') await traspasarPago(idPedido);
  else if (eleccion === 'DEVOLVER') await devolverPedido(idPedido);
  else mostrarNotificacion(`Pedido #${idPedido} anulado. Quedaron ${pesos(aDevolver)} para devolver o traspasar: lo ves en Pendientes.`, 'warning');
}

// =============================================================================
// DEVOLVER PLATA Y TRASPASAR UN PAGO (script 51; solo Encargado y Dueño, la base también lo verifica)
//   Devolver: la ventana de cobro (cobro.js) se reutiliza para elegir POR DÓNDE sale la plata (efectivo del cajón o
//   una cuenta). Se devuelve siempre todo lo que hay para devolver.
//   Traspasar: se elige el pedido nuevo que recibe el pago (traspasoPago.js) y la base hace los dos movimientos.
// =============================================================================
async function traerPedidoYDevolucion(idPedido) {
  const { data: pedido, error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('id, estado, nombre_referencia, TB_BCLIENTES(nombre)')
    .eq('id', idPedido)
    .single();
  if (error || !pedido) {
    mostrarNotificacion('No se pudo cargar el pedido.', 'danger');
    return null;
  }
  try {
    const s = saldoDe(await traerSaldos([pedido.id]), pedido);
    if (s.aDevolver <= 0) {
      mostrarNotificacion(mensajeErrorFuncion({ message: 'nada_para_devolver' }, 'pedido'), 'warning');
      cargarTablaPedidos();
      return null;
    }
    return { pedido, aDevolver: s.aDevolver };
  } catch (e) {
    mostrarNotificacion('No se pudo consultar los pagos de este pedido.', 'danger');
    return null;
  }
}

export async function devolverPedido(idPedido) {
  marcarVistos([idPedido]);
  const datos = await traerPedidoYDevolucion(idPedido);
  if (!datos) return;
  const { pedido, aDevolver } = datos;
  const cliente = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';

  await abrirModalCobro({
    titulo: 'Devolver plata',
    subtitulo: `Pedido #${pedido.id} · ${cliente}`,
    etiquetaTotal: 'Total a devolver',
    total: aDevolver,
    sinVuelto: true,
    tituloCuenta: 'Cuenta de donde sale la plata',
    textoConfirmar: 'Confirmar devolución',
    alConfirmar: async (idMedio, idCuenta) => {
      const { error } = await supabaseAdmin.rpc('registrar_devolucion_pedido', {
        p_id_pedido: Number(pedido.id),
        p_id_medio: idMedio,
        p_id_cuenta: idCuenta
      });
      if (error) {
        mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
        return false;
      }
      mostrarNotificacion('Devolución registrada.');
      cargarTablaPedidos();
      return true;
    }
  });
}

export async function traspasarPago(idOrigen) {
  marcarVistos([idOrigen]);
  const datos = await traerPedidoYDevolucion(idOrigen);
  if (!datos) return;
  if (datos.pedido.estado !== 'ANULADO') {
    mostrarNotificacion(mensajeErrorFuncion({ message: 'pedido_origen_invalido' }, 'pedido'), 'warning');
    return;
  }

  const idDestino = await elegirPedidoDestino({ idOrigen: Number(idOrigen), aDevolver: datos.aDevolver });
  if (!idDestino) return;

  const { data, error } = await supabaseAdmin.rpc('traspasar_pago_pedido', {
    p_id_origen: Number(idOrigen),
    p_id_destino: Number(idDestino)
  });
  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'pedido'), 'danger');
    return;
  }

  let mensaje = `Pago traspasado: ${pesos(data?.traspasado)} del pedido #${idOrigen} al #${idDestino}.`;
  if (Number(data?.a_devolver_origen) > 0) mensaje += ` Quedan ${pesos(data.a_devolver_origen)} a devolver en el #${idOrigen}.`;
  if (Number(data?.saldo_destino) > 0) mensaje += ` Al #${idDestino} le faltan cobrar ${pesos(data.saldo_destino)}.`;
  mostrarNotificacion(mensaje);
  cargarTablaPedidos();
}

// =============================================================================
// COBRO DE UN PEDIDO YA CARGADO
// La ventana (medio, cuenta, vuelto) vive en cobro.js y es la MISMA que usa el POS.
// Acá solo preparamos los datos del pedido y le decimos qué hacer al confirmar.
// Se cobra SIEMPRE el saldo que falta (total menos lo ya pagado).
//   entregar = true  -> "Cobrar y entregar": un solo paso (cambiar_estado_pedido a ENTREGADO con el pago).
//   entregar = false -> solo registra el cobro y el pedido sigue en su estado (registrar_cobro_pedido):
//                       sirve para el pago por adelantado y para cobrar un pedido ya entregado.
// =============================================================================
export async function cobrarPedido(idPedido, entregar = false) {
  marcarVistos([idPedido]);

  // Traemos el pedido con sus renglones (para contar las unidades) y su saldo.
  const { data: pedido, error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('id, estado, importe_total, nombre_referencia, TB_BCLIENTES(nombre), TB_DPEDIDOS(id_producto, cantidad)')
    .eq('id', idPedido)
    .single();

  if (error || !pedido) {
    mostrarNotificacion('No se pudo cargar el pedido para cobrarlo.', 'danger');
    return;
  }

  let s;
  try {
    s = saldoDe(await traerSaldos([pedido.id]), pedido);
  } catch (e) {
    mostrarNotificacion('No se pudo consultar cuánto falta cobrar de este pedido.', 'danger');
    return;
  }
  if (pedido.estado === 'ANULADO' || s.saldo <= 0) {
    mostrarNotificacion(mensajeErrorFuncion({ message: pedido.estado === 'ANULADO' ? 'pedido_anulado' : 'sin_saldo' }, 'pedido'), 'warning');
    cargarTablaPedidos();
    return;
  }

  // Unidades = suma de cantidades SIN el renglón de descuento (producto 999: su
  // cantidad son docenas, no unidades).
  const unidades = (pedido.TB_DPEDIDOS || [])
    .filter(r => Number(r.id_producto) !== 999)
    .reduce((acc, r) => acc + Number(r.cantidad), 0);

  const cliente = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';

  // Clave de operación (script 59): vale para esta ventana de cobro. Si se corta la conexión y se vuelve a tocar "Confirmar",
  // se manda la MISMA clave y la base no cobra dos veces. Se renueva cuando la base responde (bien o con un error).
  let claveCobro = null;

  await abrirModalCobro({
    titulo: entregar ? 'Cobrar y Entregar' : (pedido.estado === 'ENTREGADO' ? 'Registrar cobro' : 'Cobrar pedido'),
    subtitulo: `Pedido #${pedido.id} · ${cliente}`,
    etiquetaTotal: s.pagado > 0 ? 'Saldo a cobrar' : 'Total a cobrar',
    total: s.saldo,
    unidades,
    // Cobro parcial (seña o pago en dos veces): el monto arranca en el saldo y se puede bajar.
    permiteMontoParcial: true,
    ayudaParcial: entregar ? 'El pedido se entrega igual y queda con ese saldo por cobrar.' : '',
    // Callback: la ventana lo llama al confirmar. true = se guardó (la ventana se cierra).
    alConfirmar: async (idMedio, idCuenta, _entregar, monto) => {
      const pesos = (n) => `$${(Math.round(Number(n) * 100) / 100).toLocaleString('es-AR')}`;
      const esParcial = Math.round(Number(monto) * 100) < Math.round(Number(s.saldo) * 100);

      // "Cobrar y entregar" con cobro parcial: el pedido se entrega y queda debiendo. Se pide confirmación; si se vuelve
      // atrás, la ventana de cobro queda abierta (nada se guardó).
      if (entregar && esParcial) {
        if (!(await confirmarEntregaConSaldo(redondear(Number(s.saldo) - Number(monto))))) return false;
      }

      if (entregar && !esParcial) {
        // Entregar y cobrar todo van en la MISMA llamada: se guardan juntos o no se guarda nada.
        let errorCobro = null;
        try {
          ({ error: errorCobro } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
            p_id_pedido: Number(pedido.id),
            p_nuevo_estado: 'ENTREGADO',
            p_id_medio: idMedio,
            p_id_cuenta: idCuenta
          }));
        } catch (fallo) {
          errorCobro = fallo;   // una excepción de red cuenta como error de conexión
        }
        if (errorCobro) {
          if (esErrorDeConexion(errorCobro)) {
            // La respuesta nunca llegó: el cobro PUDO registrarse. Si se reintenta y ya estaba, la base lo rechaza (no se
            // cobra dos veces), pero conviene mirar el listado primero.
            mostrarAvisoConAccion({
              mensaje: `No se pudo confirmar si el cobro del pedido #${pedido.id} se registró (falló la conexión). Antes de volver a intentar, revisá en "Listado de Pedidos" si ya figura como cobrado.`,
              textoAccion: 'Entendido',
              duracionMs: 0,
              tipo: 'peligro'
            });
            return false;
          }
          // Por ejemplo, si la caja de hoy ya está cerrada.
          mostrarNotificacion(mensajeErrorFuncion(errorCobro, 'pedido'), 'danger');
          return false;
        }
        mostrarNotificacion('Cobro registrado.');
        cargarTablaPedidos();
        return true;
      }

      // Cobro (completo o parcial) sin entregar. Con monto parcial se manda p_monto; sin él, la base cobra el saldo.
      if (!claveCobro) claveCobro = nuevaClaveOperacion();
      let datosCobro = null;
      let errorCobro = null;
      try {
        ({ data: datosCobro, error: errorCobro } = await supabaseAdmin.rpc('registrar_cobro_pedido_seguro', {
          p_clave: claveCobro,
          p_id_pedido: Number(pedido.id),
          p_id_medio: idMedio,
          p_id_cuenta: idCuenta,
          ...(esParcial ? { p_monto: Number(monto) } : {})
        }));
      } catch (fallo) {
        errorCobro = fallo;   // una excepción de red cuenta como error de conexión
      }
      if (errorCobro) {
        if (esErrorDeConexion(errorCobro)) {
          // La respuesta nunca llegó: el cobro PUDO registrarse. La clave NO se renueva: si se vuelve a tocar "Confirmar" se
          // manda la misma y la base devuelve el cobro ya registrado en vez de cobrar de nuevo (script 59).
          mostrarAvisoConAccion({
            mensaje: `No se pudo confirmar si el cobro del pedido #${pedido.id} se registró (falló la conexión). Podés volver a tocar el botón: si ya se había registrado, no se cobra dos veces.`,
            textoAccion: 'Entendido',
            duracionMs: 0,
            tipo: 'peligro'
          });
          return false;
        }
        claveCobro = null;   // la base respondió con un error: el próximo intento es una operación nueva
        mostrarNotificacion(mensajeErrorFuncion(errorCobro, 'pedido'), 'danger');
        return false;
      }
      claveCobro = null;   // la base respondió bien: esta operación terminó
      if (datosCobro?.repetido) {
        mostrarNotificacion('Se había cortado la conexión, pero el cobro ya estaba registrado: no se cobró dos veces.', 'info');
      }

      // "Cobrar y entregar" con cobro parcial: son DOS pasos (cobro y después entrega sin cobrar el resto). Si la entrega
      // falla, el cobro ya quedó registrado: se avisa y la ventana se cierra para no cobrar dos veces.
      if (entregar) {
        const { error: errorEntrega } = await supabaseAdmin.rpc('cambiar_estado_pedido', {
          p_id_pedido: Number(pedido.id),
          p_nuevo_estado: 'ENTREGADO'
        });
        if (errorEntrega) {
          mostrarNotificacion(`Se registró el cobro de ${pesos(monto)}, pero no se pudo marcar el pedido como entregado: ${mensajeErrorFuncion(errorEntrega, 'pedido')} Entregalo desde el listado.`, 'warning');
          cargarTablaPedidos();
          return true;
        }
      }

      mostrarNotificacion(esParcial
        ? `Cobro parcial registrado: ${pesos(monto)}. Faltan ${pesos(Number(s.saldo) - Number(monto))}${entregar ? '. Pedido entregado.' : '.'}`
        : 'Cobro registrado.');
      cargarTablaPedidos();
      return true;
    }
  });
}

// -----------------------------------------------------------------------------
// volcarPedidoEnPOS  (interna)
//   Lleva a la pantalla del POS los datos de un pedido (cliente, lista, referencia y productos). La usan
//   editarPedido (para editar ese pedido) y cargarPedidoConPago (para armar uno nuevo parecido).
// -----------------------------------------------------------------------------
async function volcarPedidoEnPOS(pedido) {
  const linkPedidos = document.querySelector('#menu-navegacion .nav-link[data-section="pedidos"]');
  navegarA('pedidos', linkPedidos);

  // navegarA arranca inicializarPOS(), que reconstruye los selects (cliente, lista, medio de pago) cuando le
  // llegan los datos de la base. Si pusiéramos los valores del pedido antes de que termine, esa reconstrucción
  // los pisaría. Por eso esperamos acá.
  await esperarPOSListo();

  // Cliente. El cliente usa Select2, que dibuja su propio cuadro encima del <select>: cambiar solo .value no
  // actualiza lo que se ve. trigger('change.select2') le avisa SOLO a Select2, sin disparar alCambiarCliente.
  if (document.getElementById('select-cliente-pedido')) {
    $('#select-cliente-pedido').val(pedido.id_cliente).trigger('change.select2');
    // alCambiarCliente ajusta la etiqueta de "Referencia" y pone la lista predeterminada: la pisamos abajo.
    await alCambiarCliente();
  }

  // Lista de precios del pedido (la que se usó al crearlo, no la predeterminada).
  const selectLista = document.getElementById('select-lista-pedido');
  if (selectLista && pedido.id_lista_precio) {
    selectLista.value = pedido.id_lista_precio;
    $('#select-lista-pedido').trigger('change.select2');   // Select2 dibuja su propio cuadro (igual que Cliente, arriba)
  }

  // Referencia: va DESPUÉS de alCambiarCliente porque esa función la limpia.
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = pedido.nombre_referencia || '';

  // Recarga los precios con la lista del pedido
  await cargarPOS();

  const nuevoCarrito = {};
  (pedido.TB_DPEDIDOS || []).forEach(item => {
    const idProd = item.id_producto;
    if (Number(idProd) === 999) return; // el descuento por docena se recalcula al guardar
    nuevoCarrito[idProd] = (nuevoCarrito[idProd] || 0) + item.cantidad;
  });
  setCarrito(nuevoCarrito);

  renderizarGrillaPOS();
  actualizarModoEdicionPOS();
}

// -----------------------------------------------------------------------------
// cargarPedidoConPago  (opción B)
//   Desde un pedido ANULADO con plata: abre el POS con sus mismos productos, cliente y referencia para armar el
//   pedido nuevo (cambiarle lo que pidió el cliente). Al guardarlo con "Solo preparar", el POS traspasa el pago
//   del anulado al nuevo (pos.js). Si cancelás, el pago sigue en Pendientes.
// -----------------------------------------------------------------------------
export async function cargarPedidoConPago(idOrigen) {
  marcarVistos([idOrigen]);
  const datos = await traerPedidoYDevolucion(idOrigen);
  if (!datos) return;
  if (datos.pedido.estado !== 'ANULADO') {
    mostrarNotificacion(mensajeErrorFuncion({ message: 'pedido_origen_invalido' }, 'pedido'), 'warning');
    return;
  }

  // Si ya hay un pedido armado en el POS, se pregunta antes de pisarlo.
  if (Object.keys(carrito).length > 0) {
    const sigue = await confirmarAccion({
      titulo: 'Reemplazar el pedido del POS',
      mensaje: 'Ya hay un pedido armado en el POS. Si seguís, se reemplaza por el nuevo pedido con el pago del #' + idOrigen + '.',
      textoConfirmar: 'Sí, reemplazar',
      peligro: true
    });
    if (!sigue) return;
  }

  try {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('*, TB_DPEDIDOS(id_producto, cantidad)')
      .eq('id', idOrigen)
      .single();
    if (error || !pedido) {
      mostrarNotificacion('No se pudo cargar el pedido anulado.', 'danger');
      return;
    }

    // Es un pedido NUEVO (no se edita ninguno): solo queda anotado de dónde viene el pago.
    setPedidoEditandoId(null);
    setPedidoEditandoEstado(null);
    setPedidoPagoOrigen({ id: Number(idOrigen), aDevolver: datos.aDevolver });
    actualizarModoEdicionPOS();

    await volcarPedidoEnPOS(pedido);
    mostrarNotificacion(`Pedido nuevo con el pago del #${idOrigen}: cambialo si hace falta y guardalo con "Solo preparar".`, 'info');
  } catch (err) {
    console.error('Error en cargarPedidoConPago:', err);
    setPedidoPagoOrigen(null);
    actualizarModoEdicionPOS();
    mostrarNotificacion('Ocurrió un error al armar el pedido nuevo.', 'danger');
  }
}

export async function editarPedido(idPedido) {
  marcarVistos([idPedido]);
  try {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('*, TB_DPEDIDOS(id_producto, cantidad)')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) {
      mostrarNotificacion('Error al cargar el pedido para edición', 'danger');
      return;
    }

    setPedidoEditandoId(pedido.id);
    setPedidoEditandoEstado(pedido.estado);   // EN_PREPARACION o LISTO: el POS lo muestra y lo conserva al guardar
    setPedidoPagoOrigen(null);                // editar un pedido corta cualquier vínculo con un pago pendiente (opción B)
    actualizarModoEdicionPOS();

    await volcarPedidoEnPOS(pedido);
    guardarFotoPedidoEditando();   // para detectar "Guardar cambios" sin cambios
    mostrarNotificacion(`Editando Pedido #${pedido.id}`, 'info');

  } catch (err) {
    console.error('Error en editarPedido:', err);
    mostrarNotificacion('Ocurrió un error al intentar editar el pedido.', 'danger');
  }
}

export async function verDetallePedido(idPedido) {
  try {
    const { data: pedido, error } = await supabaseAdmin
      .from('TB_TPEDIDOS')
      .select('*, TB_BCLIENTES(nombre), TB_DPEDIDOS(cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(nombre, TB_BCATEGORIAS(nombre)))')
      .eq('id', idPedido)
      .single();

    if (error || !pedido) return;

    // Abrir el detalle de un pedido web nuevo lo da por visto (y se quita la marca NUEVO de la fila).
    if (esPedidoNuevoSinVer(pedido)) {
      marcarVistos([pedido.id]);
      cargarTablaPedidos();
    }

    pedidoActualModalId = idPedido;

    const formatearMoneda = (val) => Number(val || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    document.getElementById('detalle-id-pedido').innerText = pedido.id;
    // Cobros del pedido: medios (y cuentas) con lo pagado y lo que falta o hay que devolver.
    let sd;
    try {
      sd = saldoDe(await traerSaldos([pedido.id]), pedido);
    } catch (e) {
      sd = { pagado: 0, saldo: redondear(pedido.importe_total), medios: '', cuentas: '' };
    }
    let resumenPago = '';
    if (pedido.estado === 'ANULADO' && sd.aDevolver > 0) {
      resumenPago = `<small class="d-block text-danger font-weight-bold">Anulado con ${esc(pesos(sd.aDevolver))} para devolver o traspasar</small>`;
    } else if (pedido.estado !== 'ANULADO') {
      if (sd.aDevolver > 0) resumenPago = `<small class="d-block text-danger font-weight-bold">Pagado ${esc(pesos(sd.pagado))} · hay que devolver ${esc(pesos(sd.aDevolver))}</small>`;
      else if (sd.saldo > 0 && sd.pagado > 0) resumenPago = `<small class="d-block text-warning font-weight-bold">Pagado ${esc(pesos(sd.pagado))} · falta ${esc(pesos(sd.saldo))}</small>`;
      else if (sd.saldo === 0 && sd.pagado > 0) resumenPago = '<small class="d-block text-success font-weight-bold">Pagado ✓</small>';
    }
    document.getElementById('detalle-medio-pago').innerHTML =
      (sd.medios
        ? esc(sd.medios) + (sd.cuentas ? `<small class="d-block text-muted font-weight-normal">${esc(sd.cuentas)}</small>` : '')
        : '<span class="text-muted font-weight-normal">Sin cobrar</span>')
      + resumenPago;
    document.getElementById('detalle-monto-total').innerText = `$${formatearMoneda(pedido.importe_total)}`;

    const clienteNombre = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';
    document.getElementById('detalle-cliente').innerHTML = `
      <span class="badge badge-warning text-dark px-2 py-1 font-weight-bold" style="font-size: 0.95rem;">
        <i class="fas fa-user mr-1"></i> ${esc(clienteNombre)}
      </span>
      ${pedido.canal && pedido.canal !== 'MOSTRADOR' ? `<span class="badge badge-dark ml-1">${esc(pedido.canal)}</span>` : ''}
    `;

    const btnImprimirCocina = document.getElementById('btn-imprimir-cocina');
    if (btnImprimirCocina) btnImprimirCocina.onclick = async () => {
      if (!pedidoActualModalId) return;
      const pedidoObj = await obtenerPedidoParaImprimir(pedidoActualModalId);
      imprimirComprobante(pedidoObj, true);
    };

    const btnImprimirCliente = document.getElementById('btn-imprimir-cliente');
    if (btnImprimirCliente) btnImprimirCliente.onclick = async () => {
      if (!pedidoActualModalId) return;
      const pedidoObj = await obtenerPedidoParaImprimir(pedidoActualModalId);
      imprimirComprobante(pedidoObj, false);
    };
    
    const items = pedido.TB_DPEDIDOS || [];
    const htmlItems = items.length > 0 
      ? items.map(item => {
          const esDocena = item.cantidad >= 12 && (item.cantidad % 12 === 0);
          const etiquetaCant = esDocena ? `${item.cantidad / 12} doc.` : `${item.cantidad} u.`;
          const nombreCategoria = item.TB_BPRODUCTOS?.TB_BCATEGORIAS?.nombre || '';
          
          return `
            <tr>
              <td>
                <span class="badge badge-light border mr-1">${esc(nombreCategoria)}</span>
                <strong>${esc(item.TB_BPRODUCTOS?.nombre || 'Producto')}</strong>
              </td>
              <td class="text-center font-weight-bold">${etiquetaCant}</td>
              <td class="text-right text-muted">$${formatearMoneda(item.precioUnitario)} <small class="text-secondary">${esDocena ? '/doc' : '/u'}</small></td>
              <td class="text-right font-weight-bold">$${formatearMoneda(item.subTotal)}</td>
            </tr>
          `;
        }).join('')
      : `<tr><td colspan="4" class="text-center text-muted py-3">No hay ítems registrados.</td></tr>`;

    document.getElementById('tabla-detalle-body').innerHTML = htmlItems;
    $('#modalDetallePedido').modal('show');
  
    if (document.getElementById('detalle-observaciones')) {
    document.getElementById('detalle-observaciones').innerText = pedido.observaciones || 'Sin observaciones';
    }

  } catch (err) {
    console.error('Error al cargar detalle del pedido:', err);
    mostrarNotificacion('Ocurrió un error al cargar el detalle.', 'danger');
  }
}

// =========================================================================
// ESCUCHADOR DE EVENTOS DE IMPRESIÓN DIRECTA EN LA TABLA
// =========================================================================
// Chips de arriba: llevan al grupo.
document.getElementById('resumen-pendientes')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip-grupo');
  if (chip) irAGrupoPendientes(chip.dataset.grupo);
});

// Buscador de Pendientes: filtra lo que ya está cargado. Escape o la cruz lo borran.
const inputBuscarPendientes = document.getElementById('buscar-pendientes');
inputBuscarPendientes?.addEventListener('input', () => {
  eleccionesBusqueda = {};   // texto nuevo = resultados nuevos: los grupos con resultados vuelven a abrirse
  if (modoPedidos === 'PENDIENTES') dibujarPendientes();
});
inputBuscarPendientes?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inputBuscarPendientes.value !== '') {
    inputBuscarPendientes.value = '';
    eleccionesBusqueda = {};
    dibujarPendientes();
  }
});
document.getElementById('btn-limpiar-busqueda')?.addEventListener('click', () => {
  if (inputBuscarPendientes) { inputBuscarPendientes.value = ''; inputBuscarPendientes.focus(); }
  eleccionesBusqueda = {};
  dibujarPendientes();
});

document.getElementById('tabla-pedidos-body')?.addEventListener('click', async (e) => {
  // Plegar / abrir un grupo de Pendientes.
  const btnGrupo = e.target.closest('.grupo-toggle');
  if (btnGrupo) {
    alternarGrupoPendientes(btnGrupo.dataset.grupo);
    return;
  }

  // Avisar por WhatsApp: va primero y sin "await" antes, para que el navegador no bloquee la ventana nueva.
  const btnAvisar = e.target.closest('.btn-avisar-ws');
  if (btnAvisar) {
    const d = btnAvisar.dataset;
    const texto = mensajePedidoListo(d.nombre, d.id, d.saldo);
    window.open(`https://wa.me/${d.tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    return;
  }

  // Ver historial del pedido (sin "await" antes, igual que el aviso de WhatsApp).
  const btnHistorial = e.target.closest('.btn-ver-historial');
  if (btnHistorial) {
    verHistorialPedido(Number(btnHistorial.dataset.id));
    return;
  }

  const btnCocina = e.target.closest('.btn-print-cocina');
  if (btnCocina) {
    const idPedido = btnCocina.dataset.id;
    const pedidoObj = await obtenerPedidoParaImprimir(idPedido);
    if (pedidoObj) imprimirComprobante(pedidoObj, true);
    return;
  }

  const btnCliente = e.target.closest('.btn-print-cliente');
  if (btnCliente) {
    const idPedido = btnCliente.dataset.id;
    const pedidoObj = await obtenerPedidoParaImprimir(idPedido);
    if (pedidoObj) imprimirComprobante(pedidoObj, false);
    return;
  }
});
