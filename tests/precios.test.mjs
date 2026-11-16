// =============================================================================
// tests/precios.test.mjs  ·  CORREDOR PARA NODE
// =============================================================================
// Ejecutar desde la carpeta de la app (la que tiene precios.js):   node --test
// (hace falta Node 18 o más nuevo; no hay que instalar nada).
//
// Carga los módulos como texto y los importa como "data URL": así funcionan aunque el proyecto
// no tenga package.json con "type": "module".
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const carpeta = fileURLToPath(new URL('.', import.meta.url));
const cargar = (ruta) => import('data:text/javascript;base64,' + Buffer.from(readFileSync(carpeta + ruta, 'utf8')).toString('base64'));

const precios = await cargar('../precios.js');
const utils = await cargar('../utils.js');
const casos = await cargar('./casos-precios.js');

const resultados = casos.ejecutarTodo({
  buscarPrecio: precios.buscarPrecio,
  calcularSubtotalItem: precios.calcularSubtotalItem,
  resumirPedido: precios.resumirPedido,
  formatearPesos: utils.formatearPesos,
  listaTienePrecios: precios.listaTienePrecios
});

for (const r of resultados) {
  test(`${r.grupo}: ${r.nombre}`, () => {
    assert.ok(r.ok, `esperado ${JSON.stringify(r.esperado)} y se obtuvo ${JSON.stringify(r.obtenido)}`);
  });
}
