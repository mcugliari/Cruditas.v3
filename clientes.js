import { supabaseAdmin } from './config.js';

export async function cargarClientes() {
  const tbody = document.getElementById('tabla-clientes-body');
  const { data: clientes, error } = await supabaseAdmin
    .from('TB_BCLIENTES')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">Error: ${error.message}</td></tr>`;
    return;
  }
  if (!clientes || clientes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay clientes registrados aún.</td></tr>`;
    return;
  }

    tbody.innerHTML = clientes.map(cli => `
    <tr>
        <td><span class="badge badge-secondary">#${cli.id}</span></td>
        <td class="font-weight-bold">${cli.nombre}</td>
        <td>${cli.telefono || '-'}</td>
        <td>${cli.direccion || '-'}</td>
        <td class="text-center">
        <button class="btn btn-sm btn-warning mr-1" data-action="editar-cliente" data-id="${cli.id}" data-nombre="${cli.nombre}" data-telefono="${cli.telefono || ''}" data-direccion="${cli.direccion || ''}">
            <i class="fas fa-edit"></i>
        </button>
        <button class="btn btn-sm btn-danger" data-action="eliminar-cliente" data-id="${cli.id}" data-nombre="${cli.nombre}">
            <i class="fas fa-trash-alt"></i>
        </button>
        </td>
    </tr>
    `).join('');
}

export async function guardarCliente(event) {
  event.preventDefault();
  const nombre = document.getElementById('cli-nombre').value;
  const telefono = document.getElementById('cli-telefono').value;
  const direccion = document.getElementById('cli-direccion').value;

  const { error } = await supabaseAdmin.from('TB_BCLIENTES').insert([{ nombre, telefono, direccion }]);
  if (error) alert('Error al guardar: ' + error.message);
  else {
    document.getElementById('form-cliente').reset();
    cargarClientes();
  }
}

export function abrirModalEditar(id, nombre, telefono, direccion) {
  document.getElementById('edit-cli-id').value = id;
  document.getElementById('edit-cli-nombre').value = nombre;
  document.getElementById('edit-cli-telefono').value = telefono;
  document.getElementById('edit-cli-direccion').value = direccion;
  $('#modal-editar-cliente').modal('show');
}

export async function guardarEdicionCliente(event) {
  event.preventDefault();
  const id = document.getElementById('edit-cli-id').value;
  const nombre = document.getElementById('edit-cli-nombre').value;
  const telefono = document.getElementById('edit-cli-telefono').value;
  const direccion = document.getElementById('edit-cli-direccion').value;

  const { error } = await supabaseAdmin.from('TB_BCLIENTES').update({ nombre, telefono, direccion }).eq('id', id);
  if (error) alert('Error al actualizar cliente: ' + error.message);
  else {
    $('#modal-editar-cliente').modal('hide');
    cargarClientes();
  }
}

export async function eliminarCliente(id, nombre) {
  if (confirm(`¿Estás seguro de que querés eliminar a ${nombre}?`)) {
    const { error } = await supabaseAdmin.from('TB_BCLIENTES').delete().eq('id', id);
    if (error) alert('Error al eliminar: ' + error.message);
    else cargarClientes();
  }
}

export async function inicializarCrudClienteLista() {
  await cargarSelectsAsociacion();
  await listarAsociacionesClienteLista();
}

async function cargarSelectsAsociacion() {
  const { data: clientes } = await supabaseAdmin.from('TB_BCLIENTES').select('id, nombre').order('nombre');
  const { data: listas } = await supabaseAdmin.from('TB_TLISTA_PRECIOS').select('id, nombre');

  const selectCli = document.getElementById('asoc-select-cliente');
  const selectLis = document.getElementById('asoc-select-lista');

  if (selectCli && clientes) selectCli.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  if (selectLis && listas) selectLis.innerHTML = listas.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');
}

export async function listarAsociacionesClienteLista() {
  const tbody = document.getElementById('tabla-asoc-cliente-lista');
  if (!tbody) return;

  const { data, error } = await supabaseAdmin
    .from('TB_ACLIENTE_LISTA_PRECIOS')
    .select('id, id_cliente, id_lista_precio, m_predeterminada, TB_BCLIENTES(nombre), TB_TLISTA_PRECIOS(nombre)')
    .order('id_cliente');

  if (error) return;

    tbody.innerHTML = data.map(item => `
    <tr>
      <td class="font-weight-bold">${item.TB_BCLIENTES?.nombre || 'N/A'}</td>
      <td>${item.TB_TLISTA_PRECIOS?.nombre || 'N/A'}</td>
      <td class="text-center">
        ${item.m_predeterminada ? '<span class="badge badge-success px-2 py-1">Sí</span>' : '<span class="badge badge-secondary px-2 py-1">No</span>'}
      </td>
      <td class="text-right">
        <button class="btn btn-sm btn-outline-info mr-1" data-action="editar-asoc" data-id="${item.id}" data-cliente="${item.id_cliente}" data-lista="${item.id_lista_precio}" data-predeterminada="${item.m_predeterminada}">Editar</button>
        <button class="btn btn-sm btn-danger" data-action="eliminar-asoc" data-id="${item.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

export async function guardarAsociacionClienteLista(event) {
  event.preventDefault();
  const id = document.getElementById('asoc-id').value;
  const idCliente = parseInt(document.getElementById('asoc-select-cliente').value);
  const idLista = parseInt(document.getElementById('asoc-select-lista').value);
  const esPredeterminada = document.getElementById('asoc-predeterminada').checked;

  if (esPredeterminada) {
    await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').update({ m_predeterminada: false }).eq('id_cliente', idCliente);
  }

  const payload = { id_cliente: idCliente, id_lista_precio: idLista, m_predeterminada: esPredeterminada };
  let res = id 
    ? await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').update(payload).eq('id', id)
    : await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').insert([payload]);

  if (res.error) alert('Error al guardar: ' + res.error.message);
  else {
    resetearFormAsociacion();
    await listarAsociacionesClienteLista();
  }
}

export function editarAsociacion(id, idCliente, idLista, esPredeterminada) {
  document.getElementById('asoc-id').value = id;
  document.getElementById('asoc-select-cliente').value = idCliente;
  document.getElementById('asoc-select-lista').value = idLista;
  document.getElementById('asoc-predeterminada').checked = esPredeterminada;
}

export async function eliminarAsociacion(id) {
  if (!confirm('¿Eliminar esta asociación?')) return;
  const { error } = await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').delete().eq('id', id);
  if (error) alert('Error al eliminar: ' + error.message);
  else await listarAsociacionesClienteLista();
}

function resetearFormAsociacion() {
  document.getElementById('asoc-id').value = '';
  document.getElementById('asoc-predeterminada').checked = false;
}