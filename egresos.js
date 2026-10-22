// =============================================================================
// egresos.js  ·  GASTOS SUELTOS Y RETIROS DE EFECTIVO
// =============================================================================
//
// QUÉ HACE
//   Muestra TODA la plata que sale de la caja (gastos, retiros y pagos a
//   proveedores) con filtros por fecha, tipo y estado, y permite:
//     - registrar un GASTO suelto (luz, hielo, sueldos, una reparación...)
//     - registrar un RETIRO de efectivo (el dueño saca plata de la caja)
//     - anular un movimiento
//
//   Los pagos a proveedores se REGISTRAN desde Compras / Deuda a Proveedores
//   (pagos.js); acá solo se ven en la lista, para tener el panorama completo.
//
// ¿EN QUÉ SE DIFERENCIA UN GASTO DE UN RETIRO?
//   - Gasto : plata que se paga por algo que el negocio consume (puede ser en
//             efectivo, transferencia, etc.).
//   - Retiro: plata que sale de la caja pero NO es un gasto (por ejemplo, el
//             dueño se lleva efectivo). Siempre es en efectivo, y en los
//             reportes se muestra aparte para no mezclarlo con los gastos.
//
// CÓMO SE GUARDA
//   Con las funciones de la base del script 04: registrar_egreso y
//   anular_egreso. Ellas validan todo (monto, día cerrado, retiro solo en
//   efectivo...). Esta pantalla no escribe directo en la tabla.
//
// CÓMO SE CONECTA: index.html (sec-egresos, modal-egreso), main.js, pagos.js
// (para anular), utils.js y config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, mensajeErrorFuncion,
  formatearMoneda, formatearFechaAR, obtenerFechaActualISO, llenarSelectCuentas
} from './utils.js';
import { anularPago } from './pagos.js';


// Copia en memoria de la lista que se muestra (ver proveedores.js).
let egresosCache = [];

// Medios y cuentas cargados al abrir la ventana (ver pagos.js, mismo patrón).
let mediosEgreso = [];
let cuentasEgreso = [];

// -----------------------------------------------------------------------------
// actualizarCuentaEgreso  (interna)
//   Muestra la cuenta solo en un GASTO con medio NO efectivo. Un retiro es siempre
//   en efectivo, así que nunca la pide.
// -----------------------------------------------------------------------------
function actualizarCuentaEgreso() {
  const idMedio = document.getElementById('egreso-medio').value;
  const medio = mediosEgreso.find(m => String(m.id) === idMedio);
  const esRetiro = document.getElementById('egreso-tipo').value === 'RETIRO';
  const pideCuenta = !esRetiro && !!medio && !medio.es_efectivo;
  document.getElementById('egreso-grupo-cuenta').classList.toggle('d-none', !pideCuenta);
}


// Nombres y colores de cada tipo de movimiento. Es un "diccionario": se busca
// por el código del tipo, por ejemplo TIPOS['GASTO'] da { texto, clase }.
const TIPOS = {
  GASTO:          { texto: 'Gasto',          clase: 'badge-warning' },
  RETIRO:         { texto: 'Retiro',         clase: 'badge-dark' },
  PAGO_PROVEEDOR: { texto: 'Pago proveedor', clase: 'badge-info' }
};


// -----------------------------------------------------------------------------
// cargarEgresos
//   Trae los movimientos según los filtros y dibuja la pantalla.
// -----------------------------------------------------------------------------
export async function cargarEgresos() {
  const tbody = document.getElementById('tabla-egresos-body');
  if (!tbody) return;

  const inputDesde = document.getElementById('filtro-egreso-desde');
  const inputHasta = document.getElementById('filtro-egreso-hasta');

  // La primera vez, el filtro propone el día de HOY (lo más habitual: "¿qué salió hoy?").
  if (inputDesde && !inputDesde.value) {
    const hoy = obtenerFechaActualISO();
    inputDesde.value = hoy;
    inputHasta.value = hoy;
  }

  // CONSULTA CON DATOS RELACIONADOS ANIDADOS
  // Además de las columnas del movimiento, pedimos datos de otras tablas:
  //   TB_BMEDIO_PAGO ( ... )        -> con qué se pagó
  //   TB_BCATEGORIAS_EGRESO ( ... ) -> categoría del gasto
  //   TB_TCOMPRAS ( id, TB_BPROVEEDORES ( nombre ) )
  //        -> si es un pago a proveedor, su compra y, DENTRO de ella, el
  //           proveedor. Los paréntesis se pueden anidar: es "seguir la cadena"
  //           de relaciones entre tablas.
  let consulta = supabaseAdmin
    .from('TB_TEGRESOS')
    .select(`
      id, fecha, tipo, concepto, monto, observaciones, estado, motivo_anulacion, id_cierre, id_compra,
      TB_BMEDIO_PAGO ( nombre, es_efectivo ),
      TB_BCUENTAS ( nombre ),
      TB_BCATEGORIAS_EGRESO ( nombre ),
      TB_TCOMPRAS ( id, TB_BPROVEEDORES ( nombre ) )
    `)
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);

  // Filtros opcionales: cada uno AGREGA una condición solo si el usuario lo eligió.
  if (inputDesde.value) consulta = consulta.gte('fecha', inputDesde.value);
  if (inputHasta.value) consulta = consulta.lte('fecha', inputHasta.value);

  const tipo = document.getElementById('filtro-egreso-tipo')?.value;
  if (tipo) consulta = consulta.eq('tipo', tipo);

  const estado = document.getElementById('filtro-egreso-estado')?.value;
  if (estado) consulta = consulta.eq('estado', estado);

  const { data, error } = await consulta;

  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-danger text-center">${esc(mensajeErrorBD(error))}</td></tr>`;
    return;
  }

  egresosCache = data || [];
  renderizarEgresos();
}


// -----------------------------------------------------------------------------
// renderizarEgresos  (interna)
//   Dibuja el resumen y la tabla a partir de egresosCache.
// -----------------------------------------------------------------------------
function renderizarEgresos() {
  const tbody = document.getElementById('tabla-egresos-body');
  const resumen = document.getElementById('resumen-egresos');
  if (!tbody) return;

  // ---- Resumen (solo movimientos ACTIVOS: los anulados no cuentan) ----
  if (resumen) {
    const activos = egresosCache.filter(e => e.estado === 'ACTIVO');

    // Función ayudante: suma los montos de los movimientos que cumplen una condición.
    // "condicion" es una función que recibe un movimiento y devuelve true o false.
    // (Otro ejemplo de callback: la función se pasa como dato.)
    const sumar = (condicion) =>
      activos.filter(condicion).reduce((acc, e) => acc + Number(e.monto), 0);

    const gastos   = sumar(e => e.tipo === 'GASTO');
    const pagos    = sumar(e => e.tipo === 'PAGO_PROVEEDOR');
    const retiros  = sumar(e => e.tipo === 'RETIRO');
    const total    = gastos + pagos + retiros;
    // "?." porque el medio de pago podría faltar; si falta, no cuenta como efectivo.
    const efectivo = sumar(e => e.TB_BMEDIO_PAGO?.es_efectivo);

    resumen.innerHTML = `
      <span class="mr-3">Gastos: <strong>$${formatearMoneda(gastos)}</strong></span>
      <span class="mr-3">Pagos a proveedores: <strong>$${formatearMoneda(pagos)}</strong></span>
      <span class="mr-3">Retiros: <strong>$${formatearMoneda(retiros)}</strong></span>
      <span class="mr-3">Total: <strong class="text-danger">$${formatearMoneda(total)}</strong></span>
      <span>(en efectivo: <strong>$${formatearMoneda(efectivo)}</strong>)</span>
    `;
  }

  if (egresosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-3">No hay movimientos para estos filtros.</td></tr>`;
    return;
  }

  tbody.innerHTML = egresosCache.map(e => {
    const tipo = TIPOS[e.tipo] || { texto: e.tipo, clase: 'badge-light' };
    const anulado = e.estado === 'ANULADO';

    // Cuenta: solo se muestra si el medio no es efectivo (en efectivo siempre es la
    // cuenta Efectivo y sería repetir lo mismo).
    const cuenta = (e.TB_BCUENTAS?.nombre && !e.TB_BMEDIO_PAGO?.es_efectivo)
      ? `<div class="small text-muted">${esc(e.TB_BCUENTAS.nombre)}</div>` : '';

    // El "detalle" depende del tipo: un pago a proveedor muestra su compra y su
    // proveedor (dos niveles de "?." porque el dato está anidado); un gasto o
    // retiro muestra su concepto.
    const detalle = e.tipo === 'PAGO_PROVEEDOR'
      ? `Compra #${e.id_compra} · ${esc(e.TB_TCOMPRAS?.TB_BPROVEEDORES?.nombre)}`
      : esc(e.concepto);

    // Líneas chicas debajo del detalle (solo si hay algo que mostrar).
    const observaciones = e.observaciones
      ? `<div class="small text-muted">${esc(e.observaciones)}</div>` : '';
    const motivo = anulado && e.motivo_anulacion
      ? `<div class="small text-danger">Anulado: ${esc(e.motivo_anulacion)}</div>` : '';

    // Acciones: un movimiento ACTIVO se puede anular, salvo que su día ya esté
    // cerrado (en ese caso mostramos un candado). La base vuelve a controlar esto.
    let acciones = '';
    if (!anulado) {
      acciones = e.id_cierre
        ? '<i class="fas fa-lock text-muted" title="El día ya está cerrado"></i>'
        : `<button class="btn btn-sm btn-outline-danger" title="Anular"
                   data-action="anular-egreso" data-id="${e.id}" data-tipo="${esc(e.tipo)}">
             <i class="fas fa-ban"></i>
           </button>`;
    }

    return `
      <tr class="${anulado ? 'text-muted' : ''}">
        <td>${formatearFechaAR(e.fecha)}</td>
        <td><span class="badge ${tipo.clase}">${esc(tipo.texto)}</span></td>
        <td>${detalle}${observaciones}${motivo}</td>
        <td>${esc(e.TB_BCATEGORIAS_EGRESO?.nombre) || '-'}</td>
        <td>${esc(e.TB_BMEDIO_PAGO?.nombre)}${cuenta}</td>
        <td class="text-right font-weight-bold">$${formatearMoneda(e.monto)}</td>
        <td class="text-center">${anulado
          ? '<span class="badge badge-secondary">Anulado</span>'
          : '<span class="badge badge-success">Activo</span>'}</td>
        <td class="text-center">${acciones}</td>
      </tr>`;
  }).join('');
}


// -----------------------------------------------------------------------------
// abrirModalEgreso
//   Abre el formulario para un GASTO o un RETIRO. Es la misma ventana para los
//   dos: cambian el título, las categorías y los medios de pago permitidos.
//   Recibe: tipo -> 'GASTO' o 'RETIRO'.
// -----------------------------------------------------------------------------
export async function abrirModalEgreso(tipo) {
  const [resMedios, resCategorias, resCuentas] = await Promise.all([
    supabaseAdmin.from('TB_BMEDIO_PAGO').select('id, nombre, es_efectivo').order('id', { ascending: true }),
    supabaseAdmin.from('TB_BCATEGORIAS_EGRESO').select('id, nombre').eq('activo', true).order('nombre', { ascending: true }),
    supabaseAdmin.from('TB_BCUENTAS').select('id, nombre, tipo').eq('activo', true).order('nombre', { ascending: true })
  ]);

  const errorCarga = resMedios.error || resCategorias.error || resCuentas.error;
  if (errorCarga) {
    mostrarNotificacion(mensajeErrorBD(errorCarga), 'danger');
    return;
  }

  const esRetiro = tipo === 'RETIRO';

  // Un retiro solo puede ser en efectivo: dejamos únicamente los medios marcados
  // como efectivo. .filter() se queda con los que cumplen la condición.
  const todosLosMedios = resMedios.data || [];
  const medios = esRetiro ? todosLosMedios.filter(m => m.es_efectivo) : todosLosMedios;

  if (medios.length === 0) {
    mostrarNotificacion('No hay un medio de pago marcado como efectivo (columna es_efectivo en TB_BMEDIO_PAGO).', 'warning');
    return;
  }

  // Guardamos medios y cuentas para saber después si el medio elegido es efectivo.
  mediosEgreso = medios;
  cuentasEgreso = resCuentas.data || [];

  document.getElementById('form-egreso').reset();
  document.getElementById('egreso-tipo').value = tipo;
  document.getElementById('modal-egreso-title').innerText = esRetiro ? 'Nuevo Retiro de Efectivo' : 'Nuevo Gasto';

  // Medios de pago. Si queda uno solo (caso típico del retiro), ya viene elegido.
  document.getElementById('egreso-medio').innerHTML =
    (medios.length > 1 ? '<option value="">-- Seleccionar medio --</option>' : '') +
    medios.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');

  // Cuenta: se llena una vez; el grupo se muestra solo si el medio elegido no es efectivo.
  llenarSelectCuentas(document.getElementById('egreso-cuenta'), cuentasEgreso, null);
  document.getElementById('egreso-medio').onchange = () => actualizarCuentaEgreso();
  actualizarCuentaEgreso();

  // Categoría: solo para gastos. En un retiro se oculta todo el grupo.
  document.getElementById('egreso-categoria').innerHTML =
    '<option value="">-- Sin categoría --</option>' +
    (resCategorias.data || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  document.getElementById('grupo-egreso-categoria').classList.toggle('d-none', esRetiro);

  // Fecha: hoy por defecto; no se permiten fechas futuras.
  const hoy = obtenerFechaActualISO();
  const inputFecha = document.getElementById('egreso-fecha');
  inputFecha.value = hoy;
  inputFecha.max = hoy;

  document.getElementById('egreso-concepto').placeholder = esRetiro
    ? 'Ej: Retiro del dueño, depósito en el banco'
    : 'Ej: Factura de luz, bolsa de hielo, reparación del horno';

  $('#modal-egreso').modal('show');
}


// -----------------------------------------------------------------------------
// guardarEgreso
//   Se ejecuta al enviar el formulario: valida y llama a "registrar_egreso".
// -----------------------------------------------------------------------------
export async function guardarEgreso(event) {
  event.preventDefault();

  const boton = document.getElementById('btn-guardar-egreso');
  const tipo = document.getElementById('egreso-tipo').value;
  const concepto = document.getElementById('egreso-concepto').value.trim();
  const idMedio = document.getElementById('egreso-medio').value;
  const idCategoria = document.getElementById('egreso-categoria').value;
  const monto = parseFloat(document.getElementById('egreso-monto').value);
  const fecha = document.getElementById('egreso-fecha').value;
  const observaciones = document.getElementById('egreso-observaciones').value.trim();
  const idCuentaElegida = document.getElementById('egreso-cuenta').value;

  // Controles rápidos para avisar claro; la base vuelve a validar todo.
  if (concepto.length < 3) {
    mostrarNotificacion('Escribí un concepto (mínimo 3 letras).', 'warning');
    return;
  }
  if (idMedio === '') {
    mostrarNotificacion('Elegí el medio de pago.', 'warning');
    return;
  }
  // La cuenta se pide solo en un GASTO con medio no efectivo. El retiro la ignora.
  const medioElegido = mediosEgreso.find(m => String(m.id) === idMedio);
  const pideCuenta = tipo === 'GASTO' && !!medioElegido && !medioElegido.es_efectivo;
  if (pideCuenta && idCuentaElegida === '') {
    mostrarNotificacion('Elegí la cuenta desde la que se paga.', 'warning');
    return;
  }
  const idCuenta = pideCuenta ? Number(idCuentaElegida) : null;

  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('El monto debe ser mayor a cero.', 'warning');
    return;
  }

  boton.disabled = true;
  try {
    // Los nombres p_... deben coincidir con los parámetros de registrar_egreso (script 04).
    // La categoría solo se envía en los gastos; en un retiro va null.
    const { error } = await supabaseAdmin.rpc('registrar_egreso', {
      p_tipo: tipo,
      p_concepto: concepto,
      p_id_categoria: (tipo === 'GASTO' && idCategoria !== '') ? Number(idCategoria) : null,
      p_id_medio_pago: Number(idMedio),
      p_id_cuenta: idCuenta,
      p_monto: monto,
      p_fecha: fecha || null,
      p_observaciones: observaciones || null
    });

    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'movimiento'), 'danger');
      return;
    }

    $('#modal-egreso').modal('hide');
    mostrarNotificacion(tipo === 'RETIRO' ? 'Retiro registrado.' : 'Gasto registrado.');
    await cargarEgresos();

  } catch (err) {
    console.error('Error al registrar el movimiento:', err);
    mostrarNotificacion('No se pudo guardar. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    boton.disabled = false;
  }
}


// -----------------------------------------------------------------------------
// anularEgreso
//   Anula un movimiento (pide un motivo). Reutiliza anularPago de pagos.js, que ya
//   sabe llamar a la función "anular_egreso"; solo cambiamos los textos.
//   Recibe: idEgreso -> número del movimiento.
//           tipo     -> su tipo, para elegir el mensaje correcto.
// -----------------------------------------------------------------------------
export async function anularEgreso(idEgreso, tipo) {
  // Un pago a proveedor usa los textos por defecto de anularPago (hablan de la
  // compra). Los gastos y retiros usan textos propios.
  const textos = tipo === 'PAGO_PROVEEDOR'
    ? {}
    : { motivo: 'Motivo de la anulación (obligatorio):', ok: 'Movimiento anulado.' };

  // El tercer argumento son los textos; el segundo es el callback que refresca la lista.
  await anularPago(idEgreso, cargarEgresos, textos);
}
