import { supabaseAdmin } from './config.js';
import { cacheCategorias, setCacheCategorias } from './state.js';

export async function cargarCategoriasSelect() {
  if (cacheCategorias && cacheCategorias.length > 0) {
    const select = document.getElementById('prod-categoria');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Categoría --</option>' + 
        cacheCategorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    }
    return;
  }

  const { data: categorias, error } = await supabaseAdmin.from('TB_BCATEGORIAS').select('*').order('nombre', { ascending: true });
  if (!error && categorias) {
    setCacheCategorias(categorias);
    const select = document.getElementById('prod-categoria');
    if (select) {
      select.innerHTML = '<option value="">-- Seleccionar Categoría --</option>' + 
        categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    }
  }
}

export async function cargarProductos() {
  await cargarCategoriasSelect();
  const tbody = document.getElementById('tabla-productos-body');

  const { data: productos, error } = await supabaseAdmin
    .from('TB_BPRODUCTOS')
    .select('id, nombre, m_permite_docena, id_categoria, TB_BCATEGORIAS ( nombre )')
    .order('id_categoria', { ascending: true })
    .order('nombre', { ascending: true });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!productos || productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay productos registrados.</td></tr>`;
    return;
  }

    tbody.innerHTML = productos.map(prod => `
    <tr>
        <td><span class="badge badge-secondary">#${prod.id}</span></td>
        <td><span class="badge badge-info">${prod.TB_BCATEGORIAS ? prod.TB_BCATEGORIAS.nombre : 'Sin Cat.'}</span></td>
        <td class="font-weight-bold">${prod.nombre}</td>
        <td class="text-center">
        ${prod.m_permite_docena 
            ? '<span class="badge badge-success"><i class="fas fa-check mr-1"></i>Sí</span>' 
            : '<span class="badge badge-light border"><i class="fas fa-times mr-1 text-muted"></i>No</span>'}
        </td>
        <td class="text-center">
        <button class="btn btn-sm btn-warning mr-1" data-action="editar-producto" data-id="${prod.id}" data-nombre="${prod.nombre}" data-categoria="${prod.id_categoria}" data-docena="${prod.m_permite_docena}">
            <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-sm btn-danger" data-action="eliminar-producto" data-id="${prod.id}" data-nombre="${prod.nombre}">
            <i class="fas fa-trash-alt"></i>
        </button>
        </td>
    </tr>
    `).join('');
}

export function abrirModalNuevoProducto() {
  document.getElementById('prod-id').value = '';
  document.getElementById('form-producto').reset();
  document.getElementById('modal-producto-title').innerText = 'Nuevo Producto';
  $('#modal-producto').modal('show');
}

export function abrirModalEditarProducto(id, nombre, id_categoria, permiteDocena) {
  document.getElementById('prod-id').value = id;
  document.getElementById('prod-nombre').value = nombre;
  document.getElementById('prod-categoria').value = id_categoria;
  document.getElementById('prod-permite-docena').checked = permiteDocena;
  document.getElementById('modal-producto-title').innerText = 'Editar Producto';
  $('#modal-producto').modal('show');
}

export async function guardarProducto(event) {
  event.preventDefault();
  const id = document.getElementById('prod-id').value;
  const nombre = document.getElementById('prod-nombre').value;
  const id_categoria = document.getElementById('prod-categoria').value;
  const m_permite_docena = document.getElementById('prod-permite-docena').checked;

  const payload = { nombre, id_categoria, m_permite_docena };
  let result = id 
    ? await supabaseAdmin.from('TB_BPRODUCTOS').update(payload).eq('id', id)
    : await supabaseAdmin.from('TB_BPRODUCTOS').insert([payload]);

  if (result.error) alert('Error al guardar producto: ' + result.error.message);
  else {
    $('#modal-producto').modal('hide');
    cargarProductos();
  }
}

export async function eliminarProducto(id, nombre) {
  if (confirm(`¿Estás seguro de borrar "${nombre}"?`)) {
    const { error } = await supabaseAdmin.from('TB_BPRODUCTOS').delete().eq('id', id);
    if (error) alert('Error al eliminar: ' + error.message);
    else cargarProductos();
  }
}