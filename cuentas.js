// =============================================================================
// cuentas.js  ·  CUENTAS Y SALDOS (dónde está la plata)
// =============================================================================
//
// QUÉ HACE
//   Muestra todas las cuentas (Efectivo, bancos, billeteras como Mercado Pago) con su
//   SALDO ACTUAL, y permite crearlas, editarlas y activarlas / desactivarlas.
//
// CÓMO SE CALCULA EL SALDO (lo hace la base, en la vista VW_SALDOS_CUENTAS, script 14)
//   saldo actual = saldo inicial + ingresos - egresos
//     ingresos = pedidos cobrados en esa cuenta
//     egresos  = gastos, pagos a proveedores y retiros de esa cuenta
//   Solo cuentan los movimientos DESDE la fecha del saldo inicial (inclusive): el saldo
//   inicial es lo que había en la cuenta al COMENZAR ese día. Nada se guarda aparte, así que
//   el saldo nunca queda desactualizado.
//
// SALDO AL ÚLTIMO CIERRE (script 18)
//   Una columna extra muestra cuánta plata tenía cada cuenta al cierre de caja más reciente
//   (vista VW_SALDOS_ULTIMO_CIERRE): saldo inicial + movimientos hasta ese día inclusive. Sirve
//   para comparar contra el saldo actual y ver qué se movió desde entonces. Si no hay cierres (o
//   la cuenta empieza después del cierre) se muestra "-".
//
// REGLAS (las hace cumplir la base)
//   - Hay una sola cuenta de Efectivo y no se puede desactivar, borrar ni cambiar de tipo.
//   - El nombre de una cuenta no se puede repetir.
//   - Las cuentas no se borran: se desactivan (el historial queda intacto).
//
// TRANSFERENCIAS Y AJUSTES (script 15)
//   - Transferir: mueve plata de una cuenta a otra (por ejemplo, depositar efectivo en el banco).
//     Resta de la origen y suma a la destino: el saldo TOTAL no cambia.
//   - Ajustar: suma o resta en UNA cuenta, con un motivo obligatorio (comisión bancaria no
//     cargada, una diferencia que se encontró, etc.).
//   Los dos se guardan con funciones de la base, que rechazan los días con la caja cerrada.
//
// MOVIMIENTOS DE UNA CUENTA (script 16)
//   El botón de la lista abre el detalle de todo lo que sumó o restó el saldo: cobros, gastos,
//   pagos a proveedores, retiros, transferencias y ajustes. Las transferencias y los ajustes
//   manuales se pueden ANULAR desde ahí; lo demás se anula en su pantalla (Pedidos, Gastos...).
//
// CÓMO SE CONECTA: index.html (sec-cuentas, modal-cuenta, modal-transferencia, modal-ajuste,
// modal-movimientos-cuenta),
// main.js, utils.js y config.js.
// Es el mismo patrón que proveedores.js e insumos.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorFuncion, formatearMoneda, formatearFechaAR,
  obtenerFechaActualISO, confirmarAccion
} from './utils.js';
import './menuMas.js';   // deja listo el botón "Más" de la tabla (abre / cierra el menú)


// Copia en memoria de las cuentas que se muestran (ver proveedores.js).
let cuentasCache = [];

// Cuenta cuyos movimientos se están mirando en la ventana (para refrescar la lista al anular).
let cuentaMovimientosId = null;

// Cuántos movimientos se traen como máximo (los más recientes primero).
const LIMITE_MOVIMIENTOS = 300;

// Cómo se ve cada tipo de cuenta: texto, color de la insignia (badge) e ícono.
// Es un "diccionario": se busca por el código, por ejemplo TIPOS['BANCO'].texto.
// Cómo se ve cada tipo de movimiento en la lista de una cuenta (viene de VW_MOVIMIENTOS_CUENTA).
const TIPOS_MOV = {
  COBRO:                 { texto: 'Cobro',          clase: 'badge-success' },
  GASTO:                 { texto: 'Gasto',          clase: 'badge-warning' },
  PAGO_PROVEEDOR:        { texto: 'Pago proveedor', clase: 'badge-info' },
  RETIRO:                { texto: 'Retiro',         clase: 'badge-dark' },
  TRANSFERENCIA_ENTRADA: { texto: 'Transferencia',  clase: 'badge-primary' },
  TRANSFERENCIA_SALIDA:  { texto: 'Transferencia',  clase: 'badge-primary' },
  AJUSTE:                { texto: 'Ajuste',         clase: 'badge-secondary' }
};

const TIPOS = {
  EFECTIVO:  { texto: 'Efectivo',  clase: 'badge-success', icono: 'fa-money-bill-wave' },
  BANCO:     { texto: 'Banco',     clase: 'badge-primary', icono: 'fa-university' },
  BILLETERA: { texto: 'Billetera', clase: 'badge-info',    icono: 'fa-wallet' }
};


// -----------------------------------------------------------------------------
// dinero  (interna)
//   Da formato a un importe y pone el signo "-" ANTES del "$" si es negativo.
//   Ejemplo: dinero(-1500) -> '-$1.500,00'  (formatearMoneda solo no lo hace bien).
// -----------------------------------------------------------------------------
function dinero(valor) {
  const n = Number(valor || 0);
  return `${n < 0 ? '-' : ''}$${formatearMoneda(Math.abs(n))}`;
}


// -----------------------------------------------------------------------------
// cargarCuentas
//   Trae saldos y avisos de la base y dibuja la pantalla. Se llama al entrar a la
//   pantalla y después de cada cambio.
// -----------------------------------------------------------------------------
export async function cargarCuentas() {
  const tbody = document.getElementById('tabla-cuentas-body');
  if (!tbody) return;

  // Las dos consultas salen AL MISMO TIEMPO (Promise.all). La segunda devuelve una sola
  // fila: maybeSingle() la entrega como objeto (en vez de una lista de un elemento).
  const [resSaldos, resSinCuenta, resCierre] = await Promise.all([
    supabaseAdmin.from('VW_SALDOS_CUENTAS').select('*'),
    supabaseAdmin.from('VW_MOV_SIN_CUENTA').select('*').maybeSingle(),
    // NUEVO (script 18): saldo de cada cuenta al último cierre de caja
    supabaseAdmin.from('VW_SALDOS_ULTIMO_CIERRE').select('*')
  ]);

  if (resSaldos.error) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-danger text-center">${esc(mensajeErrorFuncion(resSaldos.error, 'cuenta'))}</td></tr>`;
    return;
  }

  // Orden: Efectivo primero, después las activas y, dentro de cada grupo, por nombre.
  // Los true/false se pueden restar (true = 1, false = 0): sirve para que el sort ponga
  // primero a los que cumplen la condición.
  cuentasCache = (resSaldos.data || []).sort((a, b) =>
    (b.tipo === 'EFECTIVO') - (a.tipo === 'EFECTIVO')
    || b.activo - a.activo
    || a.nombre.localeCompare(b.nombre));

  // NUEVO (script 18): se agrega a cada cuenta su saldo al último cierre. Un "Map" es un diccionario
  // que se busca por clave (acá, el id de la cuenta). Si la consulta fallara o la cuenta no tiene
  // fila, queda en null y la pantalla muestra "-" (es un dato extra, no lo principal).
  const cierrePorCuenta = new Map(
    (resCierre.error ? [] : (resCierre.data || [])).map(f => [f.id_cuenta, f]));
  cuentasCache.forEach(c => {
    const f = cierrePorCuenta.get(c.id);
    c.saldo_cierre = f ? Number(f.saldo_cierre) : null;
    c.fecha_cierre = f ? f.fecha_cierre : null;
  });

  renderizarCuentas();
  // Si esta consulta fallara, solo se omite el aviso: no es lo principal de la pantalla.
  mostrarAvisoSinCuenta(resSinCuenta.error ? null : resSinCuenta.data);
}


// -----------------------------------------------------------------------------
// renderizarCuentas  (interna)
//   Dibuja los totales y la tabla a partir de cuentasCache. No consulta a la base.
// -----------------------------------------------------------------------------
function renderizarCuentas() {
  const tbody = document.getElementById('tabla-cuentas-body');
  if (!tbody) return;

  // ---- Totales: solo de las cuentas ACTIVAS ----
  const activas = cuentasCache.filter(c => c.activo);
  const suma = (lista) => lista.reduce((acc, c) => acc + Number(c.saldo_actual), 0);
  const efectivo = suma(activas.filter(c => c.tipo === 'EFECTIVO'));
  const otras = suma(activas.filter(c => c.tipo !== 'EFECTIVO'));

  document.getElementById('cuentas-total').textContent = dinero(efectivo + otras);
  document.getElementById('cuentas-efectivo').textContent = dinero(efectivo);
  document.getElementById('cuentas-otras').textContent = dinero(otras);

  if (cuentasCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">No hay cuentas cargadas todavía.</td></tr>`;
    return;
  }

  tbody.innerHTML = cuentasCache.map(c => {
    const tipo = TIPOS[c.tipo] || { texto: c.tipo, clase: 'badge-light', icono: 'fa-wallet' };
    const saldo = Number(c.saldo_actual);
    const traspasos = Number(c.traspasos || 0);   // transferencias y ajustes (suman o restan)

    // Opciones del menú "Más" (lo abre y lo cierra menuMas.js).
    // Solo las cuentas activas se pueden ajustar.
    const opcionesMas = [];
    if (c.activo) {
      opcionesMas.push(`<button type="button" class="menu-mas-item" role="menuitem"
                 data-action="ajustar-cuenta" data-id="${c.id}"><i class="fas fa-sliders-h"></i> Ajustar saldo</button>`);
    }
    opcionesMas.push(`<button type="button" class="menu-mas-item" role="menuitem"
                 data-action="editar-cuenta" data-id="${c.id}"><i class="fas fa-edit"></i> Editar cuenta</button>`);
    // La cuenta Efectivo no se puede desactivar: esa opción directamente no aparece.
    if (c.tipo !== 'EFECTIVO') {
      opcionesMas.push('<div class="menu-mas-sep" role="separator"></div>');
      opcionesMas.push(`<button type="button" class="menu-mas-item ${c.activo ? 'menu-mas-peligro' : ''}" role="menuitem"
                 data-action="cambiar-estado-cuenta" data-id="${c.id}"><i class="fas ${c.activo ? 'fa-ban' : 'fa-check'}"></i> ${c.activo ? 'Desactivar cuenta' : 'Activar cuenta'}</button>`);
    }

    return `
      <tr class="${c.activo ? '' : 'text-muted'}">
        <td>
          <i class="fas ${tipo.icono} mr-2 text-muted"></i><strong>${esc(c.nombre)}</strong>
          <div><span class="badge ${tipo.clase}">${esc(tipo.texto)}</span></div>
        </td>
        <td class="text-right">${dinero(c.saldo_inicial)}
          <div class="small text-muted">al ${formatearFechaAR(c.fecha_saldo_inicial)}</div>
        </td>
        <td class="text-right">${dinero(c.ingresos)}</td>
        <td class="text-right ${Number(c.egresos) > 0 ? 'text-danger' : ''}">${Number(c.egresos) > 0 ? '-' : ''}${dinero(c.egresos)}</td>
        <td class="text-right ${traspasos < 0 ? 'text-danger' : (traspasos > 0 ? 'text-success' : 'text-muted')}">${traspasos === 0 ? '-' : (traspasos > 0 ? '+' : '') + dinero(traspasos)}</td>
        <td class="text-right font-weight-bold ${saldo < 0 ? 'text-danger' : ''}">${dinero(saldo)}</td>
        <td class="text-right ${c.saldo_cierre !== null && c.saldo_cierre < 0 ? 'text-danger' : ''}">${c.saldo_cierre === null
          ? '<span class="text-muted">-</span>'
          : `${dinero(c.saldo_cierre)}<div class="small text-muted">al ${formatearFechaAR(c.fecha_cierre)}</div>`}</td>
        <td class="text-center">
          ${c.activo
            ? '<span class="badge badge-success">Activa</span>'
            : '<span class="badge badge-secondary">Inactiva</span>'}
        </td>
        <td>
          <div class="acciones-fila">
            <button class="btn btn-accion btn-accion-ver" title="Ver movimientos de la cuenta"
                    data-action="ver-movimientos-cuenta" data-id="${c.id}">
              <i class="fas fa-list"></i> Ver movimientos
            </button>
            <div class="mas-wrap">
              <button type="button" class="btn btn-accion btn-accion-mas" aria-haspopup="true" aria-expanded="false" title="Más acciones">
                Más <i class="fas fa-chevron-down"></i>
              </button>
              <div class="menu-mas" role="menu">${opcionesMas.join('')}</div>
            </div>
          </div>
        </td>
      </tr>`;
  }).join('');
}


// -----------------------------------------------------------------------------
// mostrarAvisoSinCuenta  (interna)
//   Avisa si hay cobros o pagos que no tienen cuenta cargada (por ejemplo, transferencias
//   viejas): esos movimientos no suman a ningún saldo, y conviene saberlo.
//   Recibe: datos -> la fila de VW_MOV_SIN_CUENTA (o null).
// -----------------------------------------------------------------------------
function mostrarAvisoSinCuenta(datos) {
  const aviso = document.getElementById('cuentas-aviso');
  if (!aviso) return;

  const pedidos = Number(datos?.pedidos || 0);
  const egresos = Number(datos?.egresos || 0);

  // toggle('d-none', true) oculta; toggle('d-none', false) muestra.
  aviso.classList.toggle('d-none', pedidos + egresos === 0);
  if (pedidos + egresos === 0) return;

  const partes = [];
  if (pedidos > 0) partes.push(`${pedidos} cobro${pedidos === 1 ? '' : 's'} (${dinero(datos.monto_pedidos)})`);
  if (egresos > 0) partes.push(`${egresos} pago${egresos === 1 ? '' : 's'} o gasto${egresos === 1 ? '' : 's'} (${dinero(datos.monto_egresos)})`);
  aviso.innerHTML = `<i class="fas fa-exclamation-triangle mr-2"></i>Hay ${partes.join(' y ')} sin cuenta cargada: no suman a ningún saldo de esta pantalla.`;
}


// -----------------------------------------------------------------------------
// abrirModalNuevaCuenta
//   Abre la ventana con el formulario vacío.
// -----------------------------------------------------------------------------
export function abrirModalNuevaCuenta() {
  document.getElementById('cuenta-id').value = '';
  document.getElementById('form-cuenta').reset();
  document.getElementById('modal-cuenta-title').innerText = 'Nueva Cuenta';
  armarSelectTipo('');

  // Por defecto el saldo inicial es 0 y empieza HOY. No se permiten fechas futuras.
  const hoy = obtenerFechaActualISO();
  const inputFecha = document.getElementById('cuenta-fecha');
  inputFecha.value = hoy;
  inputFecha.max = hoy;
  document.getElementById('cuenta-saldo').value = '0';

  $('#modal-cuenta').modal('show');
}


// -----------------------------------------------------------------------------
// abrirModalEditarCuenta
//   Abre la ventana con los datos de la cuenta elegida. Recibe: id -> número de la cuenta.
// -----------------------------------------------------------------------------
export function abrirModalEditarCuenta(id) {
  const cuenta = cuentasCache.find(c => c.id === id);
  if (!cuenta) return;

  document.getElementById('cuenta-id').value = cuenta.id;
  document.getElementById('cuenta-nombre').value = cuenta.nombre;
  document.getElementById('cuenta-saldo').value = cuenta.saldo_inicial;
  document.getElementById('modal-cuenta-title').innerText = 'Editar Cuenta';
  armarSelectTipo(cuenta.tipo);

  const inputFecha = document.getElementById('cuenta-fecha');
  inputFecha.value = cuenta.fecha_saldo_inicial;
  inputFecha.max = obtenerFechaActualISO();

  $('#modal-cuenta').modal('show');
}


// -----------------------------------------------------------------------------
// armarSelectTipo  (interna)
//   Llena el desplegable "Tipo". La cuenta Efectivo es única y fija: si se está editando,
//   se muestra solo "Efectivo" y no se puede cambiar. Para una cuenta nueva o una de banco
//   o billetera, solo se ofrecen Banco y Billetera.
//   Recibe: tipoActual -> '' (cuenta nueva) o el tipo de la cuenta que se edita.
// -----------------------------------------------------------------------------
function armarSelectTipo(tipoActual) {
  const select = document.getElementById('cuenta-tipo');

  if (tipoActual === 'EFECTIVO') {
    select.innerHTML = '<option value="EFECTIVO">Efectivo</option>';
    select.disabled = true;      // un campo deshabilitado no se puede cambiar, pero su valor se puede leer
    return;
  }

  select.disabled = false;
  select.innerHTML =
    '<option value="">-- Seleccionar tipo --</option>' +
    '<option value="BANCO">Banco (cuenta bancaria)</option>' +
    '<option value="BILLETERA">Billetera (Mercado Pago, etc.)</option>';
  select.value = tipoActual;
}


// -----------------------------------------------------------------------------
// guardarCuenta
//   Se ejecuta al enviar el formulario del modal: crea o actualiza la cuenta.
// -----------------------------------------------------------------------------
export async function guardarCuenta(event) {
  event.preventDefault();

  const id = document.getElementById('cuenta-id').value;
  const nombre = document.getElementById('cuenta-nombre').value.trim();
  const tipo = document.getElementById('cuenta-tipo').value;
  const saldo = parseFloat(document.getElementById('cuenta-saldo').value);
  const fecha = document.getElementById('cuenta-fecha').value;

  // Controles rápidos para avisar claro; la base vuelve a validar todo.
  if (nombre.length < 2) {
    mostrarNotificacion('El nombre es obligatorio (mínimo 2 letras).', 'warning');
    return;
  }
  if (tipo === '') {
    mostrarNotificacion('Elegí el tipo de cuenta.', 'warning');
    return;
  }
  if (isNaN(saldo)) {
    mostrarNotificacion('El saldo inicial no es un número válido.', 'warning');
    return;
  }
  if (fecha === '' || fecha > obtenerFechaActualISO()) {
    mostrarNotificacion('La fecha del saldo inicial no puede estar vacía ni ser futura.', 'warning');
    return;
  }

  const datos = { nombre, tipo, saldo_inicial: saldo, fecha_saldo_inicial: fecha };

  const resultado = id
    ? await supabaseAdmin.from('TB_BCUENTAS').update(datos).eq('id', id)
    : await supabaseAdmin.from('TB_BCUENTAS').insert([datos]);

  if (resultado.error) {
    // 23505 = valor repetido (el nombre ya existe). Lo escribimos acá para que el
    // mensaje diga "una cuenta" y no "un cuenta".
    const mensaje = resultado.error.code === '23505'
      ? 'Ya existe una cuenta con ese nombre.'
      : mensajeErrorFuncion(resultado.error, 'cuenta');
    mostrarNotificacion(mensaje, 'danger');
    return;
  }

  $('#modal-cuenta').modal('hide');
  mostrarNotificacion(id ? 'Cuenta actualizada.' : 'Cuenta creada.');
  await cargarCuentas();
}


// -----------------------------------------------------------------------------
// cambiarEstadoCuenta
//   Activa o desactiva una cuenta (baja lógica: nunca se borra).
//   Recibe: id -> número de la cuenta.
// -----------------------------------------------------------------------------
export async function cambiarEstadoCuenta(id) {
  const cuenta = cuentasCache.find(c => c.id === id);
  if (!cuenta || cuenta.tipo === 'EFECTIVO') return;   // la de efectivo es fija

  const nuevoEstado = !cuenta.activo;

  // Al DESACTIVAR pedimos confirmación, y si todavía tiene plata lo decimos.
  if (!nuevoEstado) {
    const saldo = Number(cuenta.saldo_actual);
    const aviso = Math.abs(saldo) > 0.004 ? ` Todavía tiene un saldo de ${dinero(saldo)}.` : '';
    const ok = await confirmarAccion({
      titulo: 'Desactivar cuenta',
      mensaje: `¿Desactivar "${cuenta.nombre}"?${aviso} No podrá elegirse en cobros ni pagos nuevos (el historial se conserva).`,
      textoConfirmar: 'Sí, desactivar',
      peligro: true
    });
    if (!ok) return;
  }

  const { error } = await supabaseAdmin
    .from('TB_BCUENTAS')
    .update({ activo: nuevoEstado })
    .eq('id', id);

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'cuenta'), 'danger');
    return;
  }

  mostrarNotificacion(nuevoEstado ? 'Cuenta activada.' : 'Cuenta desactivada.');
  await cargarCuentas();
}


// =============================================================================
// TRANSFERENCIAS Y AJUSTES
// =============================================================================

// -----------------------------------------------------------------------------
// opcionesCuentas  (interna)
//   Arma las <option> de un desplegable de cuentas, mostrando el saldo de cada una para
//   que se vea de dónde conviene sacar la plata.
//   Recibe: lista -> cuentas; idElegida -> la que debe quedar seleccionada.
// -----------------------------------------------------------------------------
function opcionesCuentas(lista, idElegida) {
  return lista.map(c =>
    `<option value="${c.id}" ${Number(c.id) === Number(idElegida) ? 'selected' : ''}>${esc(c.nombre)} · ${dinero(c.saldo_actual)}</option>`
  ).join('');
}


// -----------------------------------------------------------------------------
// avisoSaldoTransferencia  (interna)
//   Muestra debajo de "Desde" el saldo de la cuenta elegida y, si el monto lo supera, avisa
//   que la cuenta quedaría en negativo (se permite: un banco puede estar en rojo).
// -----------------------------------------------------------------------------
function avisoSaldoTransferencia() {
  const aviso = document.getElementById('transf-saldo-origen');
  const cuenta = cuentasCache.find(c => c.id === Number(document.getElementById('transf-origen').value));
  if (!cuenta) { aviso.textContent = ''; return; }

  const monto = parseFloat(document.getElementById('transf-monto').value);
  const saldo = Number(cuenta.saldo_actual);

  if (!isNaN(monto) && monto > saldo) {
    aviso.className = 'form-text text-warning font-weight-bold';
    aviso.textContent = `Saldo actual: ${dinero(saldo)}. Con este monto la cuenta quedaría en ${dinero(saldo - monto)}.`;
  } else {
    aviso.className = 'form-text text-muted';
    aviso.textContent = `Saldo actual: ${dinero(saldo)}`;
  }
}


// -----------------------------------------------------------------------------
// abrirModalTransferencia
//   Abre la ventana para mover plata entre dos cuentas activas.
// -----------------------------------------------------------------------------
export function abrirModalTransferencia() {
  const activas = cuentasCache.filter(c => c.activo);
  if (activas.length < 2) {
    mostrarNotificacion('Necesitás al menos dos cuentas activas para transferir.', 'warning');
    return;
  }

  document.getElementById('form-transferencia').reset();

  // Por defecto sale de Efectivo y entra a otra cuenta: es el caso más común (depositar).
  const origen = activas.find(c => c.tipo === 'EFECTIVO') || activas[0];
  const destino = activas.find(c => c.id !== origen.id);

  const selectOrigen = document.getElementById('transf-origen');
  selectOrigen.innerHTML = opcionesCuentas(activas, origen.id);
  document.getElementById('transf-destino').innerHTML = opcionesCuentas(activas, destino.id);

  // Fecha: hoy por defecto; no se permiten fechas futuras.
  const hoy = obtenerFechaActualISO();
  const inputFecha = document.getElementById('transf-fecha');
  inputFecha.value = hoy;
  inputFecha.max = hoy;

  // El aviso de saldo se actualiza al cambiar la cuenta o al escribir el monto. Se asigna con
  // "onchange =" / "oninput =" (reemplaza al anterior en cada apertura, no se acumula).
  selectOrigen.onchange = () => avisoSaldoTransferencia();
  document.getElementById('transf-monto').oninput = () => avisoSaldoTransferencia();
  avisoSaldoTransferencia();

  $('#modal-transferencia').modal('show');
}


// -----------------------------------------------------------------------------
// guardarTransferencia
//   Se ejecuta al enviar el formulario: valida y llama a "registrar_transferencia".
// -----------------------------------------------------------------------------
export async function guardarTransferencia(event) {
  event.preventDefault();

  const origen = Number(document.getElementById('transf-origen').value);
  const destino = Number(document.getElementById('transf-destino').value);
  const monto = parseFloat(document.getElementById('transf-monto').value);
  const fecha = document.getElementById('transf-fecha').value;
  const concepto = document.getElementById('transf-concepto').value.trim();

  // Controles rápidos para avisar claro; la base vuelve a validar todo.
  if (origen === destino) {
    mostrarNotificacion('La cuenta de origen y la de destino no pueden ser la misma.', 'warning');
    return;
  }
  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('El monto debe ser mayor a cero.', 'warning');
    return;
  }
  if (fecha === '' || fecha > obtenerFechaActualISO()) {
    mostrarNotificacion('La fecha no puede estar vacía ni ser futura.', 'warning');
    return;
  }

  const boton = document.getElementById('btn-guardar-transferencia');
  boton.disabled = true;
  try {
    // Los nombres p_... deben coincidir con los parámetros de registrar_transferencia (script 15).
    const { error } = await supabaseAdmin.rpc('registrar_transferencia', {
      p_id_cuenta_origen: origen,
      p_id_cuenta_destino: destino,
      p_monto: monto,
      p_fecha: fecha,
      p_concepto: concepto || null
    });

    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'transferencia'), 'danger');
      return;
    }

    $('#modal-transferencia').modal('hide');
    mostrarNotificacion('Transferencia registrada.');
    await cargarCuentas();

  } catch (err) {
    console.error('Error al registrar la transferencia:', err);
    mostrarNotificacion('No se pudo guardar. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    boton.disabled = false;
  }
}


// -----------------------------------------------------------------------------
// abrirModalAjuste
//   Abre la ventana para sumar o restar saldo en una cuenta. Recibe: id -> número de la cuenta.
// -----------------------------------------------------------------------------
export function abrirModalAjuste(id) {
  const cuenta = cuentasCache.find(c => c.id === id);
  if (!cuenta || !cuenta.activo) return;

  document.getElementById('form-ajuste').reset();
  document.getElementById('ajuste-cuenta-id').value = cuenta.id;
  document.getElementById('ajuste-cuenta-nombre').textContent = cuenta.nombre;
  document.getElementById('ajuste-saldo-actual').textContent = dinero(cuenta.saldo_actual);

  const hoy = obtenerFechaActualISO();
  const inputFecha = document.getElementById('ajuste-fecha');
  inputFecha.value = hoy;
  inputFecha.max = hoy;

  $('#modal-ajuste').modal('show');
}


// -----------------------------------------------------------------------------
// guardarAjuste
//   Se ejecuta al enviar el formulario: valida y llama a "registrar_ajuste".
//   En pantalla se elige "Sumar" o "Restar" y se escribe el monto SIEMPRE positivo; acá se
//   convierte en un número con signo, que es lo que espera la base (restar = negativo).
// -----------------------------------------------------------------------------
export async function guardarAjuste(event) {
  event.preventDefault();

  const idCuenta = Number(document.getElementById('ajuste-cuenta-id').value);
  const sentido = document.getElementById('ajuste-sentido').value;       // 'SUMAR' o 'RESTAR'
  const monto = parseFloat(document.getElementById('ajuste-monto').value);
  const fecha = document.getElementById('ajuste-fecha').value;
  const motivo = document.getElementById('ajuste-motivo').value.trim();

  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('El monto debe ser mayor a cero.', 'warning');
    return;
  }
  if (motivo.length < 3) {
    mostrarNotificacion('Escribí el motivo del ajuste (mínimo 3 letras).', 'warning');
    return;
  }
  if (fecha === '' || fecha > obtenerFechaActualISO()) {
    mostrarNotificacion('La fecha no puede estar vacía ni ser futura.', 'warning');
    return;
  }

  const boton = document.getElementById('btn-guardar-ajuste');
  boton.disabled = true;
  try {
    const { error } = await supabaseAdmin.rpc('registrar_ajuste', {
      p_id_cuenta: idCuenta,
      p_monto: sentido === 'RESTAR' ? -monto : monto,
      p_motivo: motivo,
      p_fecha: fecha
    });

    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'ajuste'), 'danger');
      return;
    }

    $('#modal-ajuste').modal('hide');
    mostrarNotificacion('Ajuste registrado.');
    await cargarCuentas();

  } catch (err) {
    console.error('Error al registrar el ajuste:', err);
    mostrarNotificacion('No se pudo guardar. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    boton.disabled = false;
  }
}


// =============================================================================
// MOVIMIENTOS DE UNA CUENTA
// =============================================================================

// -----------------------------------------------------------------------------
// abrirMovimientosCuenta
//   Abre la ventana con todo lo que movió el saldo de una cuenta. Recibe: id -> número de la cuenta.
// -----------------------------------------------------------------------------
export async function abrirMovimientosCuenta(id) {
  const cuenta = cuentasCache.find(c => c.id === id);
  if (!cuenta) return;

  cuentaMovimientosId = id;
  document.getElementById('mov-cuenta-body').innerHTML =
    '<tr><td colspan="5" class="text-center py-3">Cargando movimientos...</td></tr>';
  $('#modal-movimientos-cuenta').modal('show');
  await cargarMovimientosCuenta();
}


// -----------------------------------------------------------------------------
// cargarMovimientosCuenta  (interna)
//   Trae los movimientos de la cuenta abierta y dibuja la lista.
//   Cada fila viene de VW_MOVIMIENTOS_CUENTA con el monto CON SIGNO: + entra, - sale.
// -----------------------------------------------------------------------------
async function cargarMovimientosCuenta() {
  const cuenta = cuentasCache.find(c => c.id === cuentaMovimientosId);
  const tbody = document.getElementById('mov-cuenta-body');
  if (!cuenta || !tbody) return;

  document.getElementById('mov-cuenta-titulo').textContent = `Movimientos: ${cuenta.nombre}`;
  document.getElementById('mov-cuenta-resumen').textContent =
    `Saldo inicial ${dinero(cuenta.saldo_inicial)} al ${formatearFechaAR(cuenta.fecha_saldo_inicial)} · ` +
    `Saldo actual ${dinero(cuenta.saldo_actual)}`;

  // Los más nuevos primero. El segundo orden desempata los del mismo día.
  const { data, error } = await supabaseAdmin
    .from('VW_MOVIMIENTOS_CUENTA')
    .select('*')
    .eq('id_cuenta', cuentaMovimientosId)
    .order('fecha', { ascending: false })
    .order('id_origen', { ascending: false })
    .limit(LIMITE_MOVIMIENTOS);

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">${esc(mensajeErrorFuncion(error, 'movimiento'))}</td></tr>`;
    return;
  }

  const lista = data || [];
  document.getElementById('mov-cuenta-nota').textContent =
    lista.length >= LIMITE_MOVIMIENTOS ? `Se muestran los últimos ${LIMITE_MOVIMIENTOS} movimientos.` : '';

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Esta cuenta no tiene movimientos desde la fecha de su saldo inicial.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(m => {
    const tipo = TIPOS_MOV[m.tipo] || { texto: m.tipo, clase: 'badge-light' };
    const monto = Number(m.monto);

    // Acciones:
    //   - transferencias y ajustes manuales: botón Anular (si el día no está cerrado)
    //   - los ajustes que generó un cierre de caja: etiqueta "auto" (se deshacen anulando ese cierre)
    //   - cobros, gastos, pagos y retiros: sin botón (se anulan en su propia pantalla)
    let acciones = '';
    if (m.origen === 'MOVIMIENTO') {
      if (m.automatico) {
        acciones = '<span class="badge badge-light border" title="Lo generó un cierre de caja">auto</span>';
      } else if (m.id_cierre) {
        acciones = '<i class="fas fa-lock text-muted" title="El día ya está cerrado"></i>';
      } else {
        acciones = `<button class="btn btn-accion btn-accion-peligro" title="Anular"
                            data-action="anular-movimiento-cuenta" data-id="${m.id_origen}">
                      <i class="fas fa-ban"></i> Anular
                    </button>`;
      }
    } else if (m.id_cierre) {
      acciones = '<i class="fas fa-lock text-muted" title="El día ya está cerrado"></i>';
    }

    return `
      <tr>
        <td>${formatearFechaAR(m.fecha)}</td>
        <td><span class="badge ${tipo.clase}">${esc(tipo.texto)}</span></td>
        <td>${esc(m.detalle)}</td>
        <td class="text-right font-weight-bold ${monto < 0 ? 'text-danger' : 'text-success'}">${monto < 0 ? '-' : '+'}$${formatearMoneda(Math.abs(monto))}</td>
        <td class="text-center">${acciones}</td>
      </tr>`;
  }).join('');
}


// -----------------------------------------------------------------------------
// anularMovimientoCuenta
//   Anula una transferencia o un ajuste manual (pide un motivo). Si era una transferencia,
//   se recalculan los saldos de las DOS cuentas. La base rechaza los días con la caja cerrada.
//   Recibe: idMovimiento -> número del movimiento (id_origen de la fila).
// -----------------------------------------------------------------------------
export async function anularMovimientoCuenta(idMovimiento) {
  const motivo = await confirmarAccion({
    titulo: 'Anular movimiento',
    mensaje: 'Se va a anular este movimiento y los saldos se recalculan (si es una transferencia, en las dos cuentas). Indicá el motivo (obligatorio).',
    pedirMotivo: true,
    textoConfirmar: 'Anular',
    peligro: true
  });
  if (!motivo) return;   // canceló: no se anula nada

  const { error } = await supabaseAdmin.rpc('anular_movimiento_cuenta', {
    p_id: idMovimiento,
    p_motivo: motivo
  });

  if (error) {
    mostrarNotificacion(mensajeErrorFuncion(error, 'movimiento'), 'danger');
    return;
  }

  mostrarNotificacion('Movimiento anulado.');
  // Primero se refrescan los saldos de la pantalla y después la lista (que muestra el saldo actual).
  await cargarCuentas();
  await cargarMovimientosCuenta();
}
