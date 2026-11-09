// =============================================================================
// precios.js  ·  CÁLCULO DE PRECIOS Y DESCUENTO POR DOCENA (funciones PURAS)
// =============================================================================
//
// QUÉ HACE
//   Reúne la matemática del pedido en un solo lugar: qué precio tiene un producto, cuánto
//   cuesta una cantidad y cuánto se descuenta por docenas completas.
//
// POR QUÉ ES UN ARCHIVO APARTE
//   Son funciones "puras": solo usan lo que reciben y devuelven un resultado. No tocan la
//   pantalla, no consultan la base y no importan nada. Por eso se pueden PROBAR solas
//   (carpeta tests/) con los casos de referencia, y por eso pos.js las usa sin tener
//   copias propias del cálculo.
//
// REGLAS (no cambian; vienen del servidor)
//   Descuento por docena (fórmula ponderada):
//     descuento = (unidades en docenas completas / unidades docenables)
//                 x suma de [ cantidad x (precio unitario - precio docena / 12) ]
//   redondeado a centavos y nunca negativo. La FUENTE DE VERDAD es el servidor
//   (guardar_pedido y crear_pedido_cliente): esto solo muestra el valor en pantalla.
//   Es el ÚNICO código del descuento: lo usan el POS (pos.js) y la página del cliente (cliente.js).
//
// CÓMO SE CONECTA: lo importan pos.js (que lo re-exporta donde hacía falta), cliente.js y tests/.
//   Tiene que estar en la MISMA carpeta que cliente.html (cliente.js lo importa con './precios.js').
// =============================================================================


// -----------------------------------------------------------------------------
// buscarPrecio
//   Devuelve { unidad, docena } de un producto para una lista de precios.
//     listaPrecios -> filas de TB_DLISTA_PRECIOS (id_lista_precio, id_categoria, id_producto,
//                     precio_unidad, precio_docena)
//     idLista      -> lista a usar; vacío/0 = sin filtrar por lista
//   Orden de búsqueda: primero el precio propio del producto, después el de su categoría.
//   Sin precio de docena (0/null) la docena vale 12 unidades (o sea: sin ahorro).
//   Sin ningún precio devuelve { unidad: 0, docena: 0 }.
// -----------------------------------------------------------------------------
export function buscarPrecio(listaPrecios, idProducto, idCategoria, idLista = null) {
  if (!listaPrecios || listaPrecios.length === 0) return { unidad: 0, docena: 0 };

  const idP = Number(idProducto);
  const idC = Number(idCategoria);
  const idL = idLista ? Number(idLista) : 0;

  const preciosFiltrados = listaPrecios.filter(p => !idL || Number(p.id_lista_precio || p.id_lista) === idL);
  const listaABuscar = preciosFiltrados.length > 0 ? preciosFiltrados : listaPrecios;

  const pProd = listaABuscar.find(p => p.id_producto !== null && Number(p.id_producto) === idP);
  if (pProd) {
    const un = Number(pProd.precio_unidad ?? pProd.precio ?? 0);
    const doc = pProd.precio_docena ? Number(pProd.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  const pCat = listaABuscar.find(p => Number(p.id_categoria) === idC && (p.id_producto === null || p.id_producto === undefined));
  if (pCat) {
    const un = Number(pCat.precio_unidad ?? pCat.precio ?? 0);
    const doc = pCat.precio_docena ? Number(pCat.precio_docena) : (un * 12);
    return { unidad: un, docena: doc };
  }

  return { unidad: 0, docena: 0 };
}


// -----------------------------------------------------------------------------
// calcularSubtotalItem
//   Costo de UNA línea aplicando docenas por separado: docenas completas al precio de docena
//   y el resto al precio unitario. (El descuento del pedido NO usa esta: usa
//   calcularDescuentoDocena, que junta las unidades de todos los gustos.)
// -----------------------------------------------------------------------------
export function calcularSubtotalItem(cantidad, precios, permiteDocena = true) {
  if (!permiteDocena || !precios.docena) {
    return cantidad * precios.unidad;
  }
  const docenas = Math.floor(cantidad / 12);
  const sueltas = cantidad % 12;

  return (docenas * precios.docena) + (sueltas * precios.unidad);
}


// -----------------------------------------------------------------------------
// calcularDescuentoDocena
//   Recibe las líneas que PERMITEN docena: [{ cantidad, precioUnidad, precioDocena }].
//   Cada gusto ahorra lo que le corresponde según SU precio, y se descuenta solo la parte que
//   entra en docenas completas (las unidades sueltas no se descuentan).
//   Con un precio único da lo mismo que la fórmula simple: 1500 / 17000 -> $1.000 por docena.
//   Sin precio de docena (0) la línea no ahorra, pero sus unidades igual cuentan para completar docenas.
//   Devuelve { docenasCompletas, descuentoTotal } (redondeado a centavos, nunca negativo).
// -----------------------------------------------------------------------------
export function calcularDescuentoDocena(lineas) {
  const unidades = lineas.reduce((suma, l) => suma + l.cantidad, 0);
  const docenasCompletas = Math.floor(unidades / 12);
  if (docenasCompletas === 0) return { docenasCompletas: 0, descuentoTotal: 0 };

  // Ahorro de cada línea. Sin precio de docena (0) no ahorra, pero sus unidades igual cuentan.
  const ahorroTotal = lineas.reduce((suma, l) => (
    l.precioDocena > 0 ? suma + l.cantidad * (l.precioUnidad - l.precioDocena / 12) : suma
  ), 0);

  const descuento = ((docenasCompletas * 12) / unidades) * ahorroTotal;
  // Math.round(x * 100) / 100: redondea a 2 decimales (evita restos como 999,9999999).
  return { docenasCompletas, descuentoTotal: Math.max(0, Math.round(descuento * 100) / 100) };
}


// -----------------------------------------------------------------------------
// resumirPedido
//   Totales del pedido a partir de sus líneas:
//     lineas = [{ cantidad, precioUnidad, precioDocena, permiteDocena }]  (una por producto)
//   Devuelve { unidades, subtotal, docenasCompletas, descuentoTotal, total }.
//   El subtotal es la suma de cantidad x precio unitario de TODAS las líneas; el descuento
//   considera solo las que permiten docena. Es lo que muestra el panel "Pedido Actual".
// -----------------------------------------------------------------------------
export function resumirPedido(lineas) {
  let unidades = 0;
  let subtotal = 0;
  const lineasDocena = [];   // las que permiten docena (para el descuento)

  lineas.forEach(l => {
    unidades += l.cantidad;
    subtotal += l.cantidad * l.precioUnidad;
    if (l.permiteDocena) {
      lineasDocena.push({ cantidad: l.cantidad, precioUnidad: l.precioUnidad, precioDocena: l.precioDocena || 0 });
    }
  });

  const { docenasCompletas, descuentoTotal } = calcularDescuentoDocena(lineasDocena);
  return { unidades, subtotal, docenasCompletas, descuentoTotal, total: subtotal - descuentoTotal };
}
