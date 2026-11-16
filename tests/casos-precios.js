// =============================================================================
// tests/casos-precios.js  ·  CASOS DE PRUEBA de precios, descuento por docena y formato de importes
// =============================================================================
//
// Es una lista de casos con su resultado ESPERADO. Los valores esperados están escritos a mano
// (a partir de la regla documentada), NO salen de llamar a las funciones: así, si alguien rompe
// una fórmula, el caso falla en lugar de "aprobar" un resultado equivocado.
//
// Lo usan dos corredores que comparten estos mismos casos:
//   - tests/precios.html        -> se abre en el navegador (sin instalar nada)
//   - tests/precios.test.mjs    -> se ejecuta con Node:  node --test
//
// Para agregar un caso: sumá una fila a CASOS_RESUMEN (pedidos completos), CASOS_PRECIO (búsqueda de
// precio), CASOS_SUBTOTAL o CASOS_FORMATO, con el resultado que DEBERÍA dar según el negocio.
// =============================================================================

// --- Catálogo de ejemplo (mismos precios que los casos de referencia del proyecto) ---
// Lista 1 (minorista): empanada $1.500 / docena $17.000, con la bondiola con precio propio ($1.600 / $18.000);
//                      pizza $9.500 sin precio de docena.
// Lista 2 (mayorista): empanada $1.400 / docena $16.000.
export const PRECIOS = [
  { id_lista_precio: 1, id_categoria: 1, id_producto: null, precio_unidad: 1500, precio_docena: 17000 },
  { id_lista_precio: 1, id_categoria: 1, id_producto: 20,   precio_unidad: 1600, precio_docena: 18000 },
  { id_lista_precio: 1, id_categoria: 1, id_producto: 70,   precio_unidad: 2000, precio_docena: null },    // precio propio sin docena
  { id_lista_precio: 1, id_categoria: 2, id_producto: null, precio_unidad: 9500, precio_docena: 0 },
  { id_lista_precio: 1, id_categoria: 3, id_producto: null, precio_unidad: 1000, precio_docena: 0 },       // sin precio de docena
  { id_lista_precio: 1, id_categoria: 4, id_producto: null, precio_unidad: 1550, precio_docena: 17000 },   // da fracciones
  { id_lista_precio: 1, id_categoria: 5, id_producto: null, precio_unidad: 1000, precio_docena: 13000 },   // docena MÁS cara que 12 sueltas
  { id_lista_precio: 2, id_categoria: 1, id_producto: null, precio_unidad: 1400, precio_docena: 16000 }
];

// Productos de ejemplo: [id, categoría, ¿permite docena?]
const CARNE      = { id: 1,  cat: 1, docena: true  };
const BONDIOLA   = { id: 20, cat: 1, docena: true  };
const PIZZA      = { id: 30, cat: 2, docena: false };
const CANASTITA  = { id: 40, cat: 3, docena: true  };   // permite docena pero sin precio de docena
const ESPECIAL   = { id: 50, cat: 4, docena: true  };
const CARA       = { id: 60, cat: 5, docena: true  };

// Pedidos: cada ítem es [producto, cantidad]. "lista" = id de la lista de precios.
export const CASOS_RESUMEN = [
  // ---- los 4 casos de referencia del proyecto ----
  { nombre: '12 carne = $17.000',                       items: [[CARNE, 12]],                    lista: 1, esperado: { unidades: 12, subtotal: 18000, docenas: 1, descuento: 1000, total: 17000 } },
  { nombre: '13 carne = $18.500',                       items: [[CARNE, 13]],                    lista: 1, esperado: { unidades: 13, subtotal: 19500, docenas: 1, descuento: 1000, total: 18500 } },
  { nombre: '6 bondiola + 6 carne = $17.500',           items: [[BONDIOLA, 6], [CARNE, 6]],      lista: 1, esperado: { unidades: 12, subtotal: 18600, docenas: 1, descuento: 1100, total: 17500 } },
  { nombre: '12 carne + 3 bondiola = $21.760',          items: [[CARNE, 12], [BONDIOLA, 3]],     lista: 1, esperado: { unidades: 15, subtotal: 22800, docenas: 1, descuento: 1040, total: 21760 } },
  // ---- bordes de la regla ----
  { nombre: '12 carne + 1 bondiola: el descuento lleva centavos ($1.015,38)', items: [[CARNE, 12], [BONDIOLA, 1]], lista: 1, esperado: { unidades: 13, subtotal: 19600, docenas: 1, descuento: 1015.38, total: 18584.62 } },
  { nombre: '11 carne: no completa docena, sin descuento', items: [[CARNE, 11]],                 lista: 1, esperado: { unidades: 11, subtotal: 16500, docenas: 0, descuento: 0, total: 16500 } },
  { nombre: '24 carne: dos docenas = $34.000',          items: [[CARNE, 24]],                    lista: 1, esperado: { unidades: 24, subtotal: 36000, docenas: 2, descuento: 2000, total: 34000 } },
  { nombre: '12 pizzas: no permiten docena, sin descuento', items: [[PIZZA, 12]],                lista: 1, esperado: { unidades: 12, subtotal: 114000, docenas: 0, descuento: 0, total: 114000 } },
  { nombre: '6 carne + 12 pizzas: las pizzas no cuentan para la docena', items: [[CARNE, 6], [PIZZA, 12]], lista: 1, esperado: { unidades: 18, subtotal: 123000, docenas: 0, descuento: 0, total: 123000 } },
  { nombre: '6 carne + 6 canastitas (sin precio de docena): cuentan las unidades, ahorra solo la carne', items: [[CARNE, 6], [CANASTITA, 6]], lista: 1, esperado: { unidades: 12, subtotal: 15000, docenas: 1, descuento: 500, total: 14500 } },
  { nombre: 'lista mayorista: 12 carne = $16.000',      items: [[CARNE, 12]],                    lista: 2, esperado: { unidades: 12, subtotal: 16800, docenas: 1, descuento: 800, total: 16000 } },
  { nombre: '13 unidades a $1.550 (docena $17.000): descuento exacto $1.600', items: [[ESPECIAL, 13]], lista: 1, esperado: { unidades: 13, subtotal: 20150, docenas: 1, descuento: 1600, total: 18550 } },
  { nombre: 'docena más cara que 12 sueltas: el descuento nunca es negativo', items: [[CARA, 12]],  lista: 1, esperado: { unidades: 12, subtotal: 12000, docenas: 1, descuento: 0, total: 12000 } },
  { nombre: 'pedido vacío',                             items: [],                               lista: 1, esperado: { unidades: 0, subtotal: 0, docenas: 0, descuento: 0, total: 0 } },
  { nombre: 'una línea con cantidad 0',                 items: [[CARNE, 0]],                     lista: 1, esperado: { unidades: 0, subtotal: 0, docenas: 0, descuento: 0, total: 0 } }
];

// Búsqueda de precio: [nombre, lista de precios, id producto, id categoría, id lista, esperado {unidad, docena}]
export const CASOS_PRECIO = [
  { nombre: 'precio de la categoría (carne, lista 1)',            args: [PRECIOS, 1, 1, 1],       esperado: { unidad: 1500, docena: 17000 } },
  { nombre: 'el precio propio del producto gana al de su categoría (bondiola)', args: [PRECIOS, 20, 1, 1], esperado: { unidad: 1600, docena: 18000 } },
  { nombre: 'lista 2: la bondiola no tiene precio propio, usa el de la categoría', args: [PRECIOS, 20, 1, 2], esperado: { unidad: 1400, docena: 16000 } },
  { nombre: 'sin precio de docena: la docena vale 12 unidades (pizza)', args: [PRECIOS, 30, 2, 1], esperado: { unidad: 9500, docena: 114000 } },
  { nombre: 'producto con precio propio y sin precio de docena: la docena vale 12 unidades', args: [PRECIOS, 70, 1, 1], esperado: { unidad: 2000, docena: 24000 } },
  { nombre: 'sin ningún precio: 0 y 0',                          args: [PRECIOS, 999, 99, 1],    esperado: { unidad: 0, docena: 0 } },
  { nombre: 'sin lista elegida: toma la primera coincidencia',   args: [PRECIOS, 1, 1, null],    esperado: { unidad: 1500, docena: 17000 } },
  { nombre: 'catálogo de precios vacío: 0 y 0',                  args: [[], 1, 1, 1],            esperado: { unidad: 0, docena: 0 } },
  { nombre: 'acepta los nombres alternativos de columna (precio / id_lista)', args: [[{ id_lista: 3, id_categoria: 7, id_producto: null, precio: 2000 }], 5, 7, 3], esperado: { unidad: 2000, docena: 24000 } },
  // OBSERVACIÓN (comportamiento actual, no necesariamente deseado): si la lista elegida NO tiene ninguna fila, se
  // usan los precios de las demás listas en lugar de mostrar 0. Este caso fija ese comportamiento para notar si cambia.
  { nombre: 'lista sin filas (la 9): hoy cae a los precios de otras listas', args: [PRECIOS, 1, 1, 9], esperado: { unidad: 1500, docena: 17000 } },
  // F2 · modo estricto (lo usa el POS): una lista sin filas NO usa los precios de otra lista.
  { nombre: 'sinRespaldo: lista sin filas (la 9) da 0 y 0',        args: [PRECIOS, 1, 1, 9, { sinRespaldo: true }],    esperado: { unidad: 0, docena: 0 } },
  { nombre: 'sinRespaldo: una lista con filas busca igual que siempre', args: [PRECIOS, 20, 1, 1, { sinRespaldo: true }], esperado: { unidad: 1600, docena: 18000 } },
  { nombre: 'sinRespaldo: la lista 2 sigue usando su precio de categoría', args: [PRECIOS, 20, 1, 2, { sinRespaldo: true }], esperado: { unidad: 1400, docena: 16000 } },
  { nombre: 'sinRespaldo sin lista elegida: toma la primera coincidencia', args: [PRECIOS, 1, 1, null, { sinRespaldo: true }], esperado: { unidad: 1500, docena: 17000 } }
];

// ¿La lista tiene al menos una fila de precios? (F2: avisar y no dejar cargar el pedido con una lista vacía)
export const CASOS_LISTA_TIENE_PRECIOS = [
  { nombre: 'lista 1 con filas: sí',                       args: [PRECIOS, 1],        esperado: true },
  { nombre: 'lista 2 con filas: sí',                       args: [PRECIOS, 2],        esperado: true },
  { nombre: 'lista 9 sin filas: no',                       args: [PRECIOS, 9],        esperado: false },
  { nombre: 'catálogo vacío: no',                          args: [[], 1],             esperado: false },
  { nombre: 'sin catálogo (null): no',                     args: [null, 1],           esperado: false },
  { nombre: 'sin lista elegida: alcanza con que haya filas', args: [PRECIOS, null],   esperado: true },
  { nombre: 'acepta el nombre alternativo de columna (id_lista)', args: [[{ id_lista: 3, id_categoria: 7, id_producto: null, precio: 2000 }], 3], esperado: true }
];

// Subtotal de una línea con docenas por separado: [nombre, cantidad, precios, permite docena, esperado]
export const CASOS_SUBTOTAL = [
  { nombre: '13 con docena = 1 docena + 1 suelta',   args: [13, { unidad: 1500, docena: 17000 }, true],  esperado: 18500 },
  { nombre: '13 sin permitir docena = 13 sueltas',   args: [13, { unidad: 1500, docena: 17000 }, false], esperado: 19500 },
  { nombre: '11 = todas sueltas',                    args: [11, { unidad: 1500, docena: 17000 }, true],  esperado: 16500 },
  { nombre: 'precio de docena 0 = todas sueltas',    args: [12, { unidad: 1500, docena: 0 }, true],      esperado: 18000 }
];

// Formato de importes en pantalla (utils.js, formatearPesos). El espacio entre $ y el número es "no cortable" (U+00A0).
export const CASOS_FORMATO = [
  { nombre: '43000 -> "$ 43.000"',          valor: 43000,   esperado: '$\u00A043.000' },
  { nombre: '1500 -> "$ 1.500"',            valor: 1500,    esperado: '$\u00A01.500' },
  { nombre: '1234,5 -> "$ 1.234,50" (decimales solo si los hay)', valor: 1234.5, esperado: '$\u00A01.234,50' },
  { nombre: '-2000 -> "-$ 2.000"',          valor: -2000,   esperado: '-$\u00A02.000' },
  { nombre: '0 -> "$ 0"',                   valor: 0,       esperado: '$\u00A00' },
  { nombre: 'vacío o inválido -> "$ 0"',    valor: null,    esperado: '$\u00A00' },
  { nombre: '-0,004 se redondea a "$ 0" (no "-$ 0")', valor: -0.004, esperado: '$\u00A00' }
];

// -----------------------------------------------------------------------------
// ejecutarTodo
//   Corre todos los casos con las funciones que se le pasan y devuelve una lista:
//   [{ grupo, nombre, ok, esperado, obtenido }]. No lanza errores: informa cada resultado.
// -----------------------------------------------------------------------------
// Importes: se exige el valor EXACTO (la diferencia admitida, 0,000001, solo cubre el error de la coma flotante).
// Así un descuento sin redondear a centavos (1015,3846 en vez de 1015,38) se detecta como falla.
const casiIgual = (a, b) => Math.abs(a - b) < 0.000001;

export function ejecutarTodo({ buscarPrecio, calcularSubtotalItem, resumirPedido, formatearPesos, listaTienePrecios }) {
  const resultados = [];
  const sumar = (grupo, nombre, ok, esperado, obtenido) => resultados.push({ grupo, nombre, ok, esperado, obtenido });

  CASOS_RESUMEN.forEach(c => {
    // Arma las líneas igual que el panel del pedido: precio de la lista + si el producto permite docena.
    const lineas = c.items.map(([prod, cantidad]) => {
      const precio = buscarPrecio(PRECIOS, prod.id, prod.cat, c.lista);
      return { cantidad, precioUnidad: precio.unidad, precioDocena: precio.docena, permiteDocena: prod.docena };
    });
    const r = resumirPedido(lineas);
    const obtenido = { unidades: r.unidades, subtotal: r.subtotal, docenas: r.docenasCompletas, descuento: r.descuentoTotal, total: r.total };
    const ok = Object.keys(c.esperado).every(k => casiIgual(obtenido[k], c.esperado[k]));
    sumar('Pedido completo', c.nombre, ok, c.esperado, obtenido);
  });

  CASOS_PRECIO.forEach(c => {
    const obtenido = buscarPrecio(...c.args);
    sumar('Búsqueda de precio', c.nombre, casiIgual(obtenido.unidad, c.esperado.unidad) && casiIgual(obtenido.docena, c.esperado.docena), c.esperado, obtenido);
  });

  CASOS_SUBTOTAL.forEach(c => {
    const obtenido = calcularSubtotalItem(...c.args);
    sumar('Subtotal de una línea', c.nombre, casiIgual(obtenido, c.esperado), c.esperado, obtenido);
  });

  // listaTienePrecios es nueva: si el corredor (precios.html / precios.test.mjs) todavía no la pasa, se marca una
  // falla visible en lugar de saltear los casos en silencio.
  if (typeof listaTienePrecios !== 'function') {
    sumar('Lista con precios', 'el corredor no le pasó listaTienePrecios a ejecutarTodo', false, 'una función', typeof listaTienePrecios);
  } else {
    CASOS_LISTA_TIENE_PRECIOS.forEach(c => {
      const obtenido = listaTienePrecios(...c.args);
      sumar('Lista con precios', c.nombre, obtenido === c.esperado, c.esperado, obtenido);
    });
  }

  CASOS_FORMATO.forEach(c => {
    const obtenido = formatearPesos(c.valor);
    sumar('Formato de importes', c.nombre, obtenido === c.esperado, c.esperado, obtenido);
  });

  return resultados;
}
