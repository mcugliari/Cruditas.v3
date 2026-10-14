// =============================================================================
// compraForm.js  ·  FORMULARIO PARA CARGAR UNA COMPRA NUEVA
// =============================================================================
//
// QUÉ HACE
//   Abre una ventana (modal) donde se carga una compra a un proveedor:
//     - datos generales: proveedor, fecha, comprobante, vencimiento, observaciones
//     - líneas de insumos: qué insumo, cuánto y a qué precio (se pueden agregar y
//       quitar líneas, y el total se calcula en vivo)
//     - pago opcional: "Registrar un pago ahora" (contado o pago parcial)
//
// CÓMO SE GUARDA
//   El navegador NO guarda nada directo en las tablas. Arma un paquete de datos
//   y llama a la función de la base "registrar_compra" (script 04), que:
//     - valida todo en el servidor,
//     - calcula el total ella misma (el total de la pantalla es solo informativo),
//     - guarda la compra, sus líneas y el pago en UNA sola operación: o se guarda
//       todo o no se guarda nada.
//
// IDEA CLAVE DE ESTE ARCHIVO: "el estado vive en una lista"
//   Las líneas de la compra se guardan en una lista en memoria (la variable
//   "lineas"). La pantalla se dibuja A PARTIR de esa lista, y cada vez que el
//   usuario escribe algo, se actualiza la lista. Así la lista es siempre la
//   "fuente de la verdad" y la pantalla es solo un reflejo.
//
// CÓMO SE CONECTA: index.html (modal-compra), main.js, compras.js, utils.js, config.js.
// =============================================================================

import { supabaseAdmin } from './config.js';
import {
  mostrarNotificacion, esc, mensajeErrorBD, mensajeErrorFuncion,
  formatearMoneda, obtenerFechaActualISO
} from './utils.js';
import { cargarCompras } from './compras.js';


// Insumos activos (para los desplegables de las líneas).
let insumosActivos = [];

// LA LISTA DE LÍNEAS. Cada línea es un objeto con 3 datos; empiezan como texto
// vacío porque así llegan los valores de los campos del formulario.
// Ejemplo de una línea completa: { id_insumo: '3', cantidad: '2.5', precio_unitario: '4000' }
let lineas = [];


// -----------------------------------------------------------------------------
// lineaVacia / subtotalLinea  (ayudantes internos)
// -----------------------------------------------------------------------------
// ¿La línea está totalmente sin completar? Las líneas así se ignoran al guardar.
function lineaVacia(l) {
  return l.id_insumo === '' && l.cantidad === '' && l.precio_unitario === '';
}

// Calcula cantidad × precio de una línea (solo para mostrar en pantalla).
function subtotalLinea(l) {
  // parseFloat convierte un texto en número con decimales ('2.5' -> 2.5).
  // Si el texto está vacío o no es un número, devuelve NaN ("Not a Number").
  const cantidad = parseFloat(l.cantidad);
  const precio = parseFloat(l.precio_unitario);
  if (isNaN(cantidad) || isNaN(precio)) return 0;
  // Math.round redondea al entero más cercano. Multiplicando por 100 antes y
  // dividiendo por 100 después, redondeamos a 2 decimales (centavos).
  return Math.round(cantidad * precio * 100) / 100;
}


// -----------------------------------------------------------------------------
// actualizarTotal  (interna)
//   Suma los subtotales de todas las líneas y lo muestra.
// -----------------------------------------------------------------------------
function actualizarTotal() {
  // .reduce() acumula un valor recorriendo la lista (ver compras.js).
  const total = lineas.reduce((acc, l) => acc + subtotalLinea(l), 0);

  document.getElementById('compra-total').innerText = formatearMoneda(total);

  // El campo "monto a pagar" muestra el total como pista ("placeholder").
  const inputMonto = document.getElementById('compra-pago-monto');
  if (inputMonto) {
    inputMonto.placeholder = `Vacío = pagar el total ($${formatearMoneda(total)})`;
  }
}


// -----------------------------------------------------------------------------
// renderizarLineas  (interna)
//   Dibuja las filas de la tabla de líneas a partir de la lista "lineas".
//   Se llama al abrir el modal y al agregar o quitar una línea.
//   (NO se llama al escribir en un campo: ver alCambiarLinea.)
// -----------------------------------------------------------------------------
function renderizarLineas() {
  const tbody = document.getElementById('tabla-lineas-compra-body');
  if (!tbody) return;

  // .map((l, i) => ...): además de la línea "l", recibe su posición "i"
  // (0 para la primera, 1 para la segunda...). La usamos para saber, cuando el
  // usuario escribe en un campo, a qué línea de la lista corresponde.
  // Los atributos data-campo y data-index quedan guardados en cada campo.
  tbody.innerHTML = lineas.map((l, i) => `
    <tr>
      <td style="min-width: 220px">
        <select class="form-control form-control-sm" data-campo="id_insumo" data-index="${i}">
          <option value="">-- Insumo --</option>
          ${insumosActivos.map(ins => `
            <option value="${ins.id}" ${String(ins.id) === String(l.id_insumo) ? 'selected' : ''}>
              ${esc(ins.nombre)} (${esc(ins.unidad_medida)})
            </option>`).join('')}
        </select>
      </td>
      <td style="width: 130px">
        <input type="number" class="form-control form-control-sm" data-campo="cantidad" data-index="${i}"
               min="0.001" step="0.001" placeholder="Cantidad" value="${esc(l.cantidad)}">
      </td>
      <td style="width: 150px">
        <input type="number" class="form-control form-control-sm" data-campo="precio_unitario" data-index="${i}"
               min="0" step="0.01" placeholder="Precio unit." value="${esc(l.precio_unitario)}">
      </td>
      <td class="text-right font-weight-bold" style="width: 130px" data-subtotal="${i}">
        $${formatearMoneda(subtotalLinea(l))}
      </td>
      <td class="text-center" style="width: 50px">
        <button type="button" class="btn btn-sm btn-outline-danger" title="Quitar línea"
                data-action="quitar-linea" data-index="${i}">
          <i class="fas fa-times"></i>
        </button>
      </td>
    </tr>
  `).join('');

  // ${...} dentro de otro ${...}: el primero arma la lista de <option> del
  // desplegable de cada fila (con un map anidado). El atributo "selected" deja
  // elegido el insumo que ya estaba cargado en esa línea.
  actualizarTotal();
}


// -----------------------------------------------------------------------------
// alCambiarLinea
//   Se ejecuta cada vez que el usuario escribe o cambia un campo de las líneas.
//   Actualiza la lista y recalcula, SIN volver a dibujar toda la tabla
//   (si se redibujara, el cursor se saldría del campo mientras se escribe).
//   Recibe: e -> el evento; e.target es el campo que cambió.
// -----------------------------------------------------------------------------
export function alCambiarLinea(e) {
  const campo = e.target.dataset.campo;   // 'id_insumo', 'cantidad' o 'precio_unitario'
  if (!campo) return;                      // si cambió otra cosa, no hacemos nada

  const i = Number(e.target.dataset.index);
  lineas[i][campo] = e.target.value;       // actualizamos la lista

  // Buscamos la celda del subtotal de ESA fila y la actualizamos.
  // querySelector con [data-subtotal="2"] busca el elemento que tenga ese atributo.
  const celda = document.querySelector(`[data-subtotal="${i}"]`);
  if (celda) celda.textContent = `$${formatearMoneda(subtotalLinea(lineas[i]))}`;

  actualizarTotal();
}


// -----------------------------------------------------------------------------
// agregarLinea / quitarLinea
// -----------------------------------------------------------------------------
export function agregarLinea() {
  // .push() agrega un elemento al final de la lista.
  lineas.push({ id_insumo: '', cantidad: '', precio_unitario: '' });
  renderizarLineas();
}

export function quitarLinea(indice) {
  // .splice(posición, cantidad) elimina elementos de la lista.
  lineas.splice(indice, 1);
  // Siempre dejamos al menos una línea en pantalla.
  if (lineas.length === 0) lineas.push({ id_insumo: '', cantidad: '', precio_unitario: '' });
  renderizarLineas();
}


// -----------------------------------------------------------------------------
// alCambiarPagarAhora
//   Muestra u oculta el bloque de pago según el casillero "Registrar un pago ahora".
// -----------------------------------------------------------------------------
export function alCambiarPagarAhora() {
  const marcado = document.getElementById('compra-pagar-ahora').checked;
  // classList.toggle('d-none', true) oculta; con false muestra (ver compras.js).
  document.getElementById('bloque-pago-compra').classList.toggle('d-none', !marcado);
}


// -----------------------------------------------------------------------------
// abrirModalNuevaCompra
//   Carga los datos necesarios (proveedores, insumos, medios de pago), prepara el
//   formulario en blanco y abre la ventana.
// -----------------------------------------------------------------------------
export async function abrirModalNuevaCompra() {
  // Tres consultas en paralelo. Solo proveedores e insumos ACTIVOS (.eq('activo', true)).
  const [resProv, resIns, resMedios] = await Promise.all([
    supabaseAdmin.from('TB_BPROVEEDORES').select('id, nombre').eq('activo', true).order('nombre', { ascending: true }),
    supabaseAdmin.from('TB_BINSUMOS').select('id, nombre, unidad_medida').eq('activo', true).order('nombre', { ascending: true }),
    supabaseAdmin.from('TB_BMEDIO_PAGO').select('id, nombre').order('id', { ascending: true })
  ]);

  const errorCarga = resProv.error || resIns.error || resMedios.error;
  if (errorCarga) {
    mostrarNotificacion(mensajeErrorBD(errorCarga), 'danger');
    return;
  }

  const proveedores = resProv.data || [];
  insumosActivos = resIns.data || [];
  const medios = resMedios.data || [];

  // Sin proveedores o sin insumos no se puede cargar una compra: avisamos qué falta.
  if (proveedores.length === 0) {
    mostrarNotificacion('Primero cargá al menos un proveedor activo (Configuración > Proveedores).', 'warning');
    return;
  }
  if (insumosActivos.length === 0) {
    mostrarNotificacion('Primero cargá al menos un insumo activo (Configuración > Insumos).', 'warning');
    return;
  }

  // ---- Preparar el formulario ----
  document.getElementById('form-compra').reset();

  document.getElementById('compra-proveedor').innerHTML =
    '<option value="">-- Seleccionar proveedor --</option>' +
    proveedores.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('');

  document.getElementById('compra-pago-medio').innerHTML =
    '<option value="">-- Seleccionar medio --</option>' +
    medios.map(m => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('');

  // La fecha propone hoy y no deja elegir una fecha futura (atributo "max").
  const hoy = obtenerFechaActualISO();
  const inputFecha = document.getElementById('compra-fecha');
  inputFecha.value = hoy;
  inputFecha.max = hoy;

  // Una sola línea en blanco para empezar, y el bloque de pago oculto.
  lineas = [{ id_insumo: '', cantidad: '', precio_unitario: '' }];
  renderizarLineas();
  alCambiarPagarAhora();

  $('#modal-compra').modal('show');
}


// -----------------------------------------------------------------------------
// guardarCompra
//   Se ejecuta al enviar el formulario: valida, arma el paquete de datos y llama
//   a la función "registrar_compra" de la base.
// -----------------------------------------------------------------------------
export async function guardarCompra(event) {
  event.preventDefault();

  const boton = document.getElementById('btn-guardar-compra');

  // ---- 1. Leer los datos generales ----
  const idProveedor = document.getElementById('compra-proveedor').value;
  const fecha = document.getElementById('compra-fecha').value;
  const comprobante = document.getElementById('compra-comprobante').value.trim();
  const vencimiento = document.getElementById('compra-vencimiento').value;
  const observaciones = document.getElementById('compra-observaciones').value.trim();

  if (idProveedor === '') {
    mostrarNotificacion('Elegí un proveedor.', 'warning');
    return;
  }

  // ---- 2. Validar y armar las líneas ----
  // Se ignoran las líneas totalmente vacías y se controla que el resto esté
  // completo. Este control es para avisar rápido y claro; la base vuelve a
  // validar todo, así que no depende solo de esto.
  const lineasCompletas = lineas.filter(l => !lineaVacia(l));
  if (lineasCompletas.length === 0) {
    mostrarNotificacion('Cargá al menos una línea con insumo, cantidad y precio.', 'warning');
    return;
  }

  const items = [];
  // for...of recorre la lista elemento por elemento; .entries() además da la
  // posición ("n"), que usamos para decir en qué línea está el problema.
  for (const [n, l] of lineasCompletas.entries()) {
    const cantidad = parseFloat(l.cantidad);
    const precio = parseFloat(l.precio_unitario);

    if (l.id_insumo === '' || isNaN(cantidad) || cantidad <= 0 || isNaN(precio) || precio < 0) {
      mostrarNotificacion(`Revisá la línea ${n + 1}: falta el insumo, la cantidad o el precio.`, 'warning');
      return;
    }
    items.push({ id_insumo: Number(l.id_insumo), cantidad, precio_unitario: precio });
  }

  // ---- 3. Armar el pago opcional ----
  // Si no se marca "Registrar un pago ahora", queda en null: la compra queda a crédito.
  let pago = null;
  if (document.getElementById('compra-pagar-ahora').checked) {
    const medio = document.getElementById('compra-pago-medio').value;
    if (medio === '') {
      mostrarNotificacion('Elegí el medio de pago.', 'warning');
      return;
    }
    pago = { id_medio_pago: Number(medio) };

    // Si el monto se deja vacío, no se envía y la función paga el total.
    const monto = document.getElementById('compra-pago-monto').value;
    if (monto !== '') pago.monto = parseFloat(monto);
  }

  // ---- 4. Llamar a la función de la base ----
  // Los nombres a la izquierda deben ser EXACTAMENTE los parámetros de
  // registrar_compra en el script 04. "|| null" convierte un texto vacío en
  // null (vacío real).
  //
  // try / catch / finally:
  //   try     -> intenta lo que sigue
  //   catch   -> se ejecuta si ocurre un error inesperado (por ejemplo, se cortó
  //              internet): avisamos en lugar de fallar en silencio
  //   finally -> se ejecuta SIEMPRE al terminar, haya salido bien o mal. Lo usamos
  //              para volver a habilitar el botón en cualquier caso.
  // Mientras se guarda, el botón queda deshabilitado para evitar un doble clic
  // que cargaría la compra dos veces.
  boton.disabled = true;
  try {
    const { data, error } = await supabaseAdmin.rpc('registrar_compra', {
      p_id_proveedor: Number(idProveedor),
      p_fecha: fecha || null,
      p_nro_comprobante: comprobante || null,
      p_fecha_vencimiento: vencimiento || null,
      p_observaciones: observaciones || null,
      p_items: items,
      p_pago: pago
    });

    if (error) {
      mostrarNotificacion(mensajeErrorFuncion(error, 'compra'), 'danger');
      return;
    }

    // "data" es lo que devuelve la función: { id_compra, total, id_egreso, pagado, saldo }.
    // El total que cuenta es el que calculó el servidor.
    $('#modal-compra').modal('hide');
    const detallePago = data.id_egreso
      ? ` Pagado $${formatearMoneda(data.pagado)}${data.saldo > 0 ? `, queda a pagar $${formatearMoneda(data.saldo)}` : ''}.`
      : ' Queda a pagar (compra a crédito).';
    mostrarNotificacion(`Compra #${data.id_compra} por $${formatearMoneda(data.total)}.${detallePago}`);

    await cargarCompras();
  } catch (err) {
    console.error('Error al guardar la compra:', err);
    mostrarNotificacion('No se pudo guardar la compra. Revisá tu conexión e intentá de nuevo.', 'danger');
  } finally {
    boton.disabled = false;
  }
}
