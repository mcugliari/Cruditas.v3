import { supabaseAdmin } from './config.js';

export async function inicializarModuloListas() {
  const select = document.getElementById('select-lista-activa');
  if (select.children.length > 1 && select.value !== '') return;

  const { data: listas, error } = await supabaseAdmin.from('TB_TLISTA_PRECIOS').select('*').order('id', { ascending: true });
  if (!error && listas && listas.length > 0) {
    select.innerHTML = listas.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');
    cargarMatrizPrecios();
  }
}

export async function cargarMatrizPrecios() {
  const idLista = document.getElementById('select-lista-activa').value;
  if (!idLista) return;

  const { data: categorias } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('id', { ascending: true });
  const { data: preciosExistentes } = await supabaseAdmin.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', idLista);

  const tbodyCat = document.getElementById('tabla-precios-categorias-body');
  tbodyCat.innerHTML = categorias.map(cat => {
    const p = preciosExistentes.find(x => x.id_categoria == cat.id && x.id_producto === null) || {};
    const un = p.precio_unidad ?? '';
    const doc = p.precio_docena ?? '';

    return `
      <tr>
        <td class="font-weight-bold">${cat.nombre}</td>
        <td><input type="number" step="0.01" class="form-control form-control-sm text-right" id="cat-un-${cat.id}" value="${un}" placeholder="0.00"></td>
        <td><input type="number" step="0.01" class="form-control form-control-sm text-right" id="cat-doc-${cat.id}" value="${doc}" placeholder="-"></td>
        <td class="text-center">
          <button class="btn btn-sm btn-success" data-action="guardar-precio-cat" data-cat="${cat.id}" data-detalle="${p.id || 'null'}">
            <i class="fas fa-save"></i>
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
  const { data: productos } = await supabaseAdmin.from('TB_BPRODUCTOS').select('id, nombre').in('id', idsProds);

  tbodyProd.innerHTML = preciosProd.map(p => {
    const prod = productos.find(x => x.id == p.id_producto) || { nombre: 'Producto #' + p.id_producto };
    return `
      <tr>
        <td class="font-weight-bold">${prod.nombre}</td>
        <td class="text-right font-weight-bold text-success">$${p.precio_unidad || 0}</td>
        <td class="text-right">${p.precio_docena ? '$' + p.precio_docena : '-'}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger" data-action="eliminar-precio-prod" data-id="${p.id}">
            <i class="fas fa-trash-alt"></i>
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

  if (res.error) alert('Error: ' + res.error.message);
  else cargarMatrizPrecios();
}

export async function abrirModalPrecioEspecial() {
  const { data: prods } = await supabaseAdmin.from('TB_BPRODUCTOS').select('id, nombre').order('nombre');
  const select = document.getElementById('modal-especial-producto');
  select.innerHTML = '<option value="">-- Seleccionar Producto --</option>' + 
    prods.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');

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
  if (error) alert('Error: ' + error.message);
  else {
    $('#modal-precio-especial').modal('hide');
    cargarMatrizPrecios();
  }
}

export async function eliminarPrecioEspecial(idDetalle) {
  if (confirm('¿Eliminar precio especial? El producto volverá a tomar el precio base de su categoría.')) {
    await supabaseAdmin.from('TB_DLISTA_PRECIOS').delete().eq('id', idDetalle);
    cargarMatrizPrecios();
  }
}