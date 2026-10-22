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
  dia_cerrado:          'La caja de ese día ya está cerrada: no se pueden registrar cobros, pagos ni gastos en ese día. Si hace falta, anulá primero el cierre de caja.',
  cobro_en_dia_cerrado: 'Este pedido fue cobrado en un día con la caja cerrada, así que no se puede modificar. Anulá primero el cierre de caja de ese día.',
  caja_ya_cerrada:      'La caja de ese día ya está cerrada.',
  sin_movimientos:      'No hay ventas cobradas ni egresos para cerrar la caja de ese día.',
  efectivo_invalido:    'El efectivo contado no es válido.',
  cierre_inexistente:   'El cierre de caja no existe.',
  cierre_ya_anulado:    'Ese cierre de caja ya estaba anulado.',
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
  egreso_cerrado:       'El movimiento pertenece a un día con la caja cerrada: no se puede anular.',
  cuenta_invalida:      'La cuenta no existe o está inactiva.',
  cuenta_incompatible:  'La cuenta no corresponde al medio de pago (el efectivo va a la cuenta Efectivo; la transferencia, a una cuenta bancaria o billetera).',
  cuenta_requerida:     'Elegí a qué cuenta corresponde el movimiento.',
  medio_requerido:      'Para cobrar hay que elegir el medio de pago.'
};

export function mensajeErrorFuncion(error, entidad = 'registro') {
  const texto = error?.message || '';
  // Object.keys(...) da la lista de códigos; .find() devuelve el primero que
  // aparece dentro del texto del error (o undefined si ninguno).
  const codigo = Object.keys(MENSAJES_FUNCIONES).find(c => texto.includes(c));
  return codigo ? MENSAJES_FUNCIONES[codigo] : mensajeErrorBD(error, entidad);
}

// -----------------------------------------------------------------------------
// llenarSelectCuentas: arma las opciones de un desplegable de cuentas.
// Solo muestra cuentas que NO son de efectivo: el efectivo no se elige, va solo
// a la cuenta Efectivo. Si hay una sola, queda elegida; si hay varias, queda el
// texto "Elegí la cuenta" para obligar a decidir.
//   select           -> el elemento <select> a llenar
//   cuentas          -> lista de cuentas [{ id, nombre, tipo }]
//   idPreseleccion   -> (opcional) cuenta que debe quedar elegida
// -----------------------------------------------------------------------------
export function llenarSelectCuentas(select, cuentas, idPreseleccion = null) {
  const lista = cuentas.filter(c => c.tipo !== 'EFECTIVO');
  select.innerHTML =
    '<option value="">— Elegí la cuenta —</option>' +
    lista.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');

  // .some() responde si ALGÚN elemento cumple la condición
  if (idPreseleccion && lista.some(c => Number(c.id) === Number(idPreseleccion))) {
    select.value = idPreseleccion;
  } else if (lista.length === 1) {
    select.value = lista[0].id;
  }
}


// =============================================================================
// confirmarAccion: ventana propia de confirmación (reemplaza a confirm() y prompt())
// =============================================================================
// ¿Por qué? Las ventanas del navegador (confirm, prompt, alert) no se pueden
// estilar: se ven distintas en cada navegador y no combinan con el sistema.
// Esta función arma una ventana de Bootstrap con el estilo del sistema.
//
// Recibe un objeto con opciones (todas son opcionales):
//   titulo          encabezado (por defecto 'Confirmar')
//   mensaje         texto principal
//   textoConfirmar  texto del botón principal (por defecto 'Aceptar')
//   textoCancelar   texto del botón secundario (por defecto 'Cancelar')
//   peligro         true = botón rojo e ícono de advertencia (acciones que borran o anulan)
//   pedirMotivo     true = agrega un cuadro de texto OBLIGATORIO
//
// Devuelve una PROMESA (un valor que llega más tarde; se espera con "await"):
//   sin pedirMotivo -> true si aceptó, false si canceló
//   con pedirMotivo -> el texto escrito, o null si canceló
//
// Ejemplo:  if (!(await confirmarAccion({ mensaje: '¿Seguro?' }))) return;
// =============================================================================
export function confirmarAccion({
  titulo = 'Confirmar', mensaje = '', textoConfirmar = 'Aceptar', textoCancelar = 'Cancelar',
  peligro = false, pedirMotivo = false
} = {}) {
  // new Promise((resolve) => ...): "resolve" es la función que entrega la respuesta
  // cuando la ventana se cierra. Quien llamó con "await" queda esperando hasta entonces.
  return new Promise((resolve) => {
    // Por si quedó una ventana de una vez anterior.
    document.getElementById('modal-confirmar')?.remove();

    // Si se cierra sin aceptar (Cancelar o la tecla Esc), se devuelve este valor.
    let resultado = pedirMotivo ? null : false;

    const modal = document.createElement('div');
    modal.id = 'modal-confirmar';
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('data-backdrop', 'static');   // no se cierra al tocar afuera
    // Por encima de cualquier otra ventana que esté abierta (por ejemplo, el detalle de una compra).
    modal.style.zIndex = 1070;
    modal.innerHTML = `
      <div class="modal-dialog modal-dialog-centered" role="document" style="max-width: 420px;">
        <div class="modal-content">
          <div class="modal-header border-0 pb-0">
            <h5 class="modal-title font-weight-bold">
              <i class="fas ${peligro ? 'fa-exclamation-triangle text-danger' : 'fa-question-circle text-warning'} mr-2"></i>${esc(titulo)}
            </h5>
          </div>
          <div class="modal-body">
            <p class="mb-0">${esc(mensaje)}</p>
            ${pedirMotivo ? `
            <div class="form-group mt-3 mb-0">
              <textarea class="form-control" id="confirmar-motivo" rows="2" maxlength="300" placeholder="Escribí el motivo..."></textarea>
              <div class="invalid-feedback">El motivo es obligatorio.</div>
            </div>` : ''}
          </div>
          <div class="modal-footer border-0 pt-0">
            <button type="button" class="btn btn-light" data-dismiss="modal">${esc(textoCancelar)}</button>
            <button type="button" class="btn ${peligro ? 'btn-danger' : 'btn-success'} font-weight-bold" id="confirmar-aceptar">${esc(textoConfirmar)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('confirmar-aceptar').addEventListener('click', () => {
      if (pedirMotivo) {
        const caja = document.getElementById('confirmar-motivo');
        const motivo = caja.value.trim();
        if (!motivo) {                      // sin motivo no se puede continuar
          caja.classList.add('is-invalid');
          caja.focus();
          return;
        }
        resultado = motivo;
      } else {
        resultado = true;
      }
      $(modal).modal('hide');
    });

    // Al empezar a escribir, se saca el aviso de error.
    document.getElementById('confirmar-motivo')?.addEventListener('input', (e) => e.target.classList.remove('is-invalid'));

    $(modal).on('shown.bs.modal', () => {
      // Bootstrap 4 pone el fondo oscuro de la segunda ventana debajo de la primera: lo subimos.
      $('.modal-backdrop').last().css('z-index', 1065);
      // El foco va al cuadro de texto (si hay) o al botón principal (Enter confirma).
      (document.getElementById('confirmar-motivo') || document.getElementById('confirmar-aceptar')).focus();
    });

    $(modal).on('hidden.bs.modal', () => {
      modal.remove();
      // Si había otra ventana abierta debajo, Bootstrap le sacó el bloqueo de scroll: se lo devolvemos.
      if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
      resolve(resultado);
    });

    $(modal).modal('show');
  });
}