import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, confirmarAccion, esc } from './utils.js';

// -----------------------------------------------------------------------------
// Categorías de sistema (interna)
//   La categoría "Bonificación" (la del renglón de descuento por docena, producto 999)
//   no es algo que se venda, así que no lleva precio: se oculta de las listas.
//   Se detecta por nombre (sin tildes ni mayúsculas) o por pertenecer al grupo SISTEMA,
//   el mismo criterio que usa reporteVentas.js.
// -----------------------------------------------------------------------------
function sinTildes(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function esCategoriaSistema(cat) {
  return sinTildes(cat?.nombre) === 'bonificacion'
    || String(cat?.grupo || '').toUpperCase().trim() === 'SISTEMA';
}

export async function inicializarModuloListas() {
  const select = document.getElementById('select-lista-activa');
  if (select.children.length > 1 && select.value !== '') return;

  const { data: listas, error } = await supabaseAdmin.from('TB_TLISTA_PRECIOS').select('*').order('id', { ascending: true });
  if (!error && listas && listas.length > 0) {
    select.innerHTML = listas.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
    cargarMatrizPrecios();
  }
}

export async function cargarMatrizPrecios() {
  const idLista = document.getElementById('select-lista-activa').value;
  if (!idLista) return;

  const { data: categoriasTodas } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('id', { ascending: true });
  const { data: preciosExistentes } = await supabaseAdmin.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', idLista);

  // Sin la categoría Bonificación (ver esCategoriaSistema).
  const categorias = (categoriasTodas || []).filter(cat => !esCategoriaSistema(cat));

  const tbodyCat = document.getElementById('tabla-precios-categorias-body');
  tbodyCat.innerHTML = categorias.map(cat => {
    const p = preciosExistentes.find(x => x.id_categoria == cat.id && x.id_producto === null) || {};
    const un = p.precio_unidad ?? '';
    const doc = p.precio_docena ?? '';

    return `
      <tr>
        <td class="font-weight-bold">${esc(cat.nombre)}</td>
        <td><input type="number" step="0.01" class="form-control form-control-sm text-right" id="cat-un-${cat.id}" value="${un}" placeholder="0.00"></td>
        <td><input type="number" step="0.01" class="form-control form-control-sm text-right" id="cat-doc-${cat.id}" value="${doc}" placeholder="-"></td>
        <td class="text-center">
          <button class="btn btn-accion btn-accion-pagar" data-action="guardar-precio-cat" data-cat="${cat.id}" data-detalle="${p.id || 'null'}">
            <i class="fas fa-save"></i> Guardar
          </button>
        </td>
      </tr>
    `;
  }).join('');

  const tbodyProd = document.getElementById('tabla-precios-productos-body');
  const preciosProd = preciosExistentes.filter(x => x.id_producto !== null);

  if (preciosProd.length === 0) {
    tbodyProd.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">No hay precios especiales asignados.</td></tr>`;
    return;
  }

  const idsProds = preciosProd.map(x => x.id_producto);
  // Se trae también la categoría de cada producto para mostrarla debajo del nombre.
  const { data: productos } = await supabaseAdmin
    .from('TB_BPRODUCTOS')
    .select('id, nombre, TB_BCATEGORIAS ( nombre )')
    .in('id', idsProds);

  tbodyProd.innerHTML = preciosProd.map(p => {
    const prod = (productos || []).find(x => x.id == p.id_producto) || { nombre: 'Producto #' + p.id_producto };
    const catNombre = prod.TB_BCATEGORIAS?.nombre;
    return `
      <tr>
        <td class="font-weight-bold">
          ${esc(prod.nombre)}
          ${catNombre ? `<br><small class="text-muted font-weight-normal">${esc(catNombre)}</small>` : ''}
        </td>
        <td class="text-right font-weight-bold text-success">$${p.precio_unidad || 0}</td>
        <td class="text-right">${p.precio_docena ? '$' + p.precio_docena : '-'}</td>
        <td class="text-center">
          <button class="btn btn-accion btn-accion-peligro" data-action="eliminar-precio-prod" data-id="${p.id}">
            <i class="fas fa-trash-alt"></i> Eliminar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

export async function guardarPrecioCategoria(id_categoria, idDetalle) {
  const idLista = document.getElementById('select-lista-activa').value;
  const precio_unidad = document.getElementById(`cat-un-${id_categoria}`).value || null;
  const precio_docena = document.getElementById(`cat-doc-${id_categoria}`).value || null;

  const payload = {
    id_lista_precio: idLista,
    id_categoria: id_categoria,
    id_producto: null,
    precio_unidad: precio_unidad ? parseFloat(precio_unidad) : null,
    precio_docena: precio_docena ? parseFloat(precio_docena) : null
  };

  let res = idDetalle 
    ? await supabaseAdmin.from('TB_DLISTA_PRECIOS').update(payload).eq('id', idDetalle)
    : await supabaseAdmin.from('TB_DLISTA_PRECIOS').insert([payload]);

  if (res.error) mostrarNotificacion('Error: ' + res.error.message, 'danger');
  else cargarMatrizPrecios();
}

export async function abrirModalPrecioEspecial() {
  const { data: prods, error } = await supabaseAdmin
    .from('TB_BPRODUCTOS')
    .select('id, nombre, orden, TB_BCATEGORIAS ( id, nombre, grupo )');

  if (error) {
    mostrarNotificacion('Error al cargar los productos: ' + error.message, 'danger');
    return;
  }

  // Sin la bonificación (categoría de sistema / producto 999), ordenados como el POS:
  // categoría → orden (los que no tienen, al final) → nombre.
  const lista = (prods || [])
    .filter(p => Number(p.id) !== 999 && !esCategoriaSistema(p.TB_BCATEGORIAS))
    .sort((a, b) =>
      (a.TB_BCATEGORIAS?.id ?? Infinity) - (b.TB_BCATEGORIAS?.id ?? Infinity)
      || (a.orden ?? Infinity) - (b.orden ?? Infinity)
      || a.nombre.localeCompare(b.nombre));

  // Un <optgroup> por categoría: el nombre de la categoría se ve como título del grupo.
  const grupos = [];
  lista.forEach(p => {
    const nombreCat = p.TB_BCATEGORIAS?.nombre || 'Sin categoría';
    let g = grupos.find(x => x.nombre === nombreCat);
    if (!g) { g = { nombre: nombreCat, productos: [] }; grupos.push(g); }
    g.productos.push(p);
  });

  const select = document.getElementById('modal-especial-producto');
  select.innerHTML = '<option value="">-- Seleccionar Producto --</option>' +
    grupos.map(g => `
      <optgroup label="${esc(g.nombre)}">
        ${g.productos.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}
      </optgroup>`).join('');

  document.getElementById('form-precio-especial').reset();
  $('#modal-precio-especial').modal('show');
}

export async function guardarPrecioEspecial(e) {
  e.preventDefault();
  const idLista = document.getElementById('select-lista-activa').value;
  const id_producto = document.getElementById('modal-especial-producto').value;
  const precio_unidad = parseFloat(document.getElementById('modal-especial-unidad').value);
  const docVal = document.getElementById('modal-especial-docena').value;
  const precio_docena = docVal ? parseFloat(docVal) : null;

  const payload = { id_lista_precio: idLista, id_categoria: null, id_producto, precio_unidad, precio_docena };

  const { error } = await supabaseAdmin.from('TB_DLISTA_PRECIOS').insert([payload]);
  if (error) mostrarNotificacion('Error: ' + error.message, 'danger');
  else {
    $('#modal-precio-especial').modal('hide');
    cargarMatrizPrecios();
  }
}

export async function eliminarPrecioEspecial(idDetalle) {
  const ok = await confirmarAccion({
    titulo: 'Eliminar precio especial',
    mensaje: '¿Eliminar precio especial? El producto volverá a tomar el precio base de su categoría.',
    textoConfirmar: 'Sí, eliminar',
    peligro: true
  });
  if (ok) {
    await supabaseAdmin.from('TB_DLISTA_PRECIOS').delete().eq('id', idDetalle);
    cargarMatrizPrecios();
  }
}
