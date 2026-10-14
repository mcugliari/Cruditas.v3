export function mostrarNotificacion(mensaje, tipo = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px;';
    document.body.appendChild(container);
  }

  const colores = { success: '#28a745', danger: '#dc3545', warning: '#ffc107', info: '#17a2b8' };
  const colorFondo = colores[tipo] || colores.success;
  const colorTexto = tipo === 'warning' ? '#212529' : '#ffffff';

  const toast = document.createElement('div');
  toast.innerText = mensaje;
  toast.style.cssText = `
    background-color: ${colorFondo};
    color: ${colorTexto};
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: bold;
    font-size: 0.9rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.25s ease-in-out;
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

export function formatearFechaAR(fechaISO) {
  if (!fechaISO) return '-';
  const soloFecha = fechaISO.split('T')[0];
  const [anio, mes, dia] = soloFecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

export function obtenerFechaActualISO() {
  const hoyObj = new Date();
  const offset = hoyObj.getTimezoneOffset() * 60000;
  return new Date(hoyObj.getTime() - offset).toISOString().split('T')[0];
}

// =============================================================================
// HERRAMIENTAS NUEVAS (módulo de compras)
// =============================================================================

// -----------------------------------------------------------------------------
// esc: "escapa" un texto para poder ponerlo de forma segura dentro de HTML.
//
// ¿Para qué? Cuando armamos una tabla con innerHTML, el texto se interpreta
// como HTML. Si alguien guardara un nombre como <b>hola</b>, se vería en
// negrita; y si fuera algo malicioso, podría ejecutarse como código.
// esc() reemplaza los caracteres especiales (< > & " ') por su versión
// inofensiva, así el texto siempre se muestra TAL CUAL fue escrito.
//
// Recibe: cualquier valor (texto, número, null...).
// Devuelve: un texto seguro ('' si el valor era null o undefined).
// -----------------------------------------------------------------------------
export function esc(valor) {
  // "valor ?? ''" significa: si valor es null o undefined, usá '' (vacío).
  // String(...) lo convierte a texto (por si llega un número).
  // .replace(/[&<>"']/g, ...) busca cada uno de esos 5 caracteres (la "g" final
  // significa "todos, no solo el primero") y los cambia según la tabla de abajo.
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// -----------------------------------------------------------------------------
// mensajeErrorBD: traduce un error de la base de datos a un mensaje claro.
//
// Cuando la base rechaza algo, devuelve un objeto "error" con un código
// (error.code) y un texto técnico (error.message). Este código es del estándar
// de PostgreSQL: por ejemplo 23505 significa "valor repetido en un campo único".
//
// Recibe:  error   -> el objeto de error que devolvió Supabase
//          entidad -> cómo llamar a lo que se guardaba ("proveedor", "insumo"...)
// Devuelve: un texto para mostrarle al usuario.
// -----------------------------------------------------------------------------
export function mensajeErrorBD(error, entidad = 'registro') {
  if (!error) return '';
  const texto = error.message || '';

  if (error.code === '23505') return `Ya existe un ${entidad} con ese nombre.`;
  if (error.code === '23514') return 'Hay un dato inválido (por ejemplo, un nombre vacío).';
  // Este texto lo lanza a propósito un "trigger" de la base (script 05).
  if (texto.includes('unidad_bloqueada')) {
    return 'No se puede cambiar la unidad de un insumo que ya se usó en compras.';
  }
  return 'Ocurrió un error: ' + texto;
}

// =============================================================================
// HERRAMIENTAS NUEVAS (compras y pagos)
// =============================================================================

// -----------------------------------------------------------------------------
// formatearMoneda: da formato argentino a un importe.
// Ejemplo: formatearMoneda(1234.5) -> '1.234,50'
// (No incluye el signo $: se escribe afuera, por ejemplo `$${formatearMoneda(x)}`.)
// toLocaleString('es-AR', ...) usa las reglas de Argentina: punto para los miles
// y coma para los decimales.
// -----------------------------------------------------------------------------
export function formatearMoneda(valor) {
  return Number(valor || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// -----------------------------------------------------------------------------
// sumarDiasISO: suma (o resta, con un número negativo) días a una fecha.
// Recibe y devuelve fechas en formato 'AAAA-MM-DD'.
// Ejemplo: sumarDiasISO('2026-10-13', -30) -> '2026-09-13'
//
// ¿Por qué no se usa new Date('2026-10-13') directamente? Porque JavaScript
// interpreta ese texto como hora UTC y, en Argentina (UTC-3), puede terminar
// mostrando el día anterior. Armando la fecha con new Date(año, mes, día)
// se usa la hora local y se evita ese error.
// -----------------------------------------------------------------------------
export function sumarDiasISO(fechaISO, dias) {
  // .split('-') parte el texto en trozos: ['2026', '10', '13'].
  // .map(Number) convierte cada trozo a número. Los meses de JavaScript
  // empiezan en 0 (enero = 0), por eso se resta 1 al mes.
  // Desestructuración de lista: [anio, mes, dia] toma los 3 valores en orden.
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia + dias); // JavaScript acomoda solo los desbordes de mes/año
  // padStart(2, '0') completa con ceros a la izquierda: '9' -> '09'.
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mm}-${dd}`;
}

// -----------------------------------------------------------------------------
// mensajeErrorFuncion: traduce los códigos de error de las FUNCIONES de la base
// (registrar_compra, registrar_pago_compra, etc.) a mensajes claros.
//
// Las funciones del script 04 rechazan operaciones inválidas con un código corto
// (por ejemplo 'monto_supera_saldo'). Acá está la lista de significados.
// Si el error no es de esta lista, se usa mensajeErrorBD (errores generales).
// -----------------------------------------------------------------------------
const MENSAJES_FUNCIONES = {
  no_autorizado:        'Tu sesión venció. Volvé a ingresar.',
  fecha_invalida:       'La fecha no es válida (no puede ser futura ni anterior a la compra).',
  vencimiento_invalido: 'El vencimiento no puede ser anterior a la fecha de la compra.',
  proveedor_invalido:   'El proveedor no existe o está inactivo.',
  datos_invalidos:      'Hay datos incompletos o inválidos. Revisá el formulario.',
  insumo_invalido:      'Algún insumo no existe o está inactivo.',
  total_invalido:       'El total de la compra debe ser mayor a cero.',
  monto_invalido:       'El monto no es válido (debe ser mayor a cero y no superar el total).',
  medio_invalido:       'El medio de pago no es válido.',
  dia_cerrado:          'La caja de ese día ya está cerrada: no se pueden registrar ni anular pagos en ese día.',
  compra_inexistente:   'La compra no existe.',
  compra_anulada:       'La compra está anulada.',
  compra_ya_anulada:    'La compra ya estaba anulada.',
  compra_ya_pagada:     'La compra ya está totalmente pagada.',
  monto_supera_saldo:   'El monto supera lo que se debe.',
  sin_deuda:            'El proveedor no tiene deuda pendiente.',
  compra_con_pagos:     'La compra tiene pagos activos. Primero anulá los pagos.',
  tipo_invalido:        'El tipo de movimiento no es válido.',
  retiro_solo_efectivo: 'Los retiros solo pueden hacerse en efectivo.',
  categoria_invalida:   'La categoría no existe o está inactiva.',
  motivo_requerido:     'Tenés que indicar un motivo.',
  egreso_inexistente:   'El movimiento no existe.',
  egreso_ya_anulado:    'El movimiento ya estaba anulado.',
  egreso_cerrado:       'El movimiento pertenece a un día con la caja cerrada: no se puede anular.'
};

export function mensajeErrorFuncion(error, entidad = 'registro') {
  const texto = error?.message || '';
  // Object.keys(...) da la lista de códigos; .find() devuelve el primero que
  // aparece dentro del texto del error (o undefined si ninguno).
  const codigo = Object.keys(MENSAJES_FUNCIONES).find(c => texto.includes(c));
  return codigo ? MENSAJES_FUNCIONES[codigo] : mensajeErrorBD(error, entidad);
}
