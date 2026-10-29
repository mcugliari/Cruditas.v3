import { supabaseAdmin } from './config.js';
import { mostrarNotificacion, confirmarAccion, esc } from './utils.js';

export async function cargarClientes() {
  const tbody = document.getElementById('tabla-clientes-body');
  const { data: clientes, error } = await supabaseAdmin
    .from('TB_BCLIENTES')
    .select('*')
    .order('id', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-danger text-center">Error: ${esc(error.message)}</td></tr>`;
    return;
  }
  if (!clientes || clientes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay clientes registrados aún.</td></tr>`;
    return;
  }

    tbody.innerHTML = clientes.map(cli => `
    <tr>
        <td><span class="badge badge-secondary">#${cli.id}</span></td>
        <td class="font-weight-bold">${esc(cli.nombre)}</td>
        <td>${esc(cli.telefono || '-')}</td>
        <td>${esc(cli.direccion || '-')}</td>
        <td class="text-center">
        <button class="btn btn-accion btn-accion-editar mr-1" data-action="editar-cliente" data-id="${cli.id}" data-nombre="${esc(cli.nombre)}" data-telefono="${esc(cli.telefono || '')}" data-direccion="${esc(cli.direccion || '')}">
            <i class="fas fa-edit"></i> Editar
        </button>
        <button class="btn btn-accion btn-accion-peligro" data-action="eliminar-cliente" data-id="${cli.id}" data-nombre="${esc(cli.nombre)}">
            <i class="fas fa-trash-alt"></i> Eliminar
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
  if (error) mostrarNotificacion('Error al guardar: ' + error.message, 'danger');
  else {
    document.getElementById('form-cliente').reset();
    mostrarNotificacion('Cliente creado.');
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
  if (error) mostrarNotificacion('Error al actualizar cliente: ' + error.message, 'danger');
  else {
    $('#modal-editar-cliente').modal('hide');
    mostrarNotificacion('Cliente actualizado.');
    cargarClientes();
  }
}

export async function eliminarCliente(id, nombre) {
  const ok = await confirmarAccion({
    titulo: 'Eliminar cliente',
    mensaje: `¿Estás seguro de que querés eliminar a ${nombre}?`,
    textoConfirmar: 'Sí, eliminar',
    peligro: true
  });
  if (ok) {
    const { error } = await supabaseAdmin.from('TB_BCLIENTES').delete().eq('id', id);
    if (error) mostrarNotificacion('Error al eliminar: ' + error.message, 'danger');
    else {
      mostrarNotificacion('Cliente eliminado.');
      cargarClientes();
    }
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

  if (selectCli && clientes) selectCli.innerHTML = clientes.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  if (selectLis && listas) selectLis.innerHTML = listas.map(l => `<option value="${l.id}">${esc(l.nombre)}</option>`).join('');
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
      <td class="font-weight-bold">${esc(item.TB_BCLIENTES?.nombre || 'N/A')}</td>
      <td>${esc(item.TB_TLISTA_PRECIOS?.nombre || 'N/A')}</td>
      <td class="text-center">
        ${item.m_predeterminada ? '<span class="badge badge-success px-2 py-1">Sí</span>' : '<span class="badge badge-secondary px-2 py-1">No</span>'}
      </td>
      <td class="text-right">
        <button class="btn btn-accion btn-accion-editar mr-1" data-action="editar-asoc" data-id="${item.id}" data-cliente="${item.id_cliente}" data-lista="${item.id_lista_precio}" data-predeterminada="${item.m_predeterminada}">Editar</button>
        <button class="btn btn-accion btn-accion-peligro" data-action="eliminar-asoc" data-id="${item.id}">Eliminar</button>
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

  // Un cliente no puede tener dos veces la misma lista. Se controla ANTES de guardar
  // (la base también lo impide con el script 30; esto da un mensaje claro y evita el viaje).
  // Al editar, se ignora la propia fila (por eso se compara con "id").
  const { data: existentes, error: errExistentes } = await supabaseAdmin
    .from('TB_ACLIENTE_LISTA_PRECIOS')
    .select('id')
    .eq('id_cliente', idCliente)
    .eq('id_lista_precio', idLista);
  if (errExistentes) {
    mostrarNotificacion('No se pudo comprobar la asociación: ' + errExistentes.message, 'danger');
    return;
  }
  if ((existentes || []).some(fila => String(fila.id) !== String(id))) {
    mostrarNotificacion('Ese cliente ya tiene asignada esa lista. Si querés cambiar cuál es la predeterminada, editá la asociación que ya existe.', 'warning');
    return;
  }

  // Primero se guarda esta asociación y recién después se desmarcan las otras como predeterminadas:
  // así, si el guardado falla, el cliente no se queda sin lista predeterminada.
  const payload = { id_cliente: idCliente, id_lista_precio: idLista, m_predeterminada: esPredeterminada };
  const res = id
    ? await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').update(payload).eq('id', id).select('id').single()
    : await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').insert([payload]).select('id').single();

  if (res.error) {
    // 23505 = la base rechazó un duplicado (por ejemplo, dos personas guardando a la vez).
    const mensaje = res.error.code === '23505'
      ? 'Ese cliente ya tiene asignada esa lista.'
      : 'Error al guardar: ' + res.error.message;
    mostrarNotificacion(mensaje, res.error.code === '23505' ? 'warning' : 'danger');
    return;
  }

  if (esPredeterminada) {
    const { error: errOtras } = await supabaseAdmin
      .from('TB_ACLIENTE_LISTA_PRECIOS')
      .update({ m_predeterminada: false })
      .eq('id_cliente', idCliente)
      .neq('id', res.data.id);
    if (errOtras) mostrarNotificacion('La lista se guardó, pero no se pudo desmarcar la predeterminada anterior: ' + errOtras.message, 'warning');
  }

  mostrarNotificacion('Lista asignada al cliente.');
  resetearFormAsociacion();
  await listarAsociacionesClienteLista();
}

export function editarAsociacion(id, idCliente, idLista, esPredeterminada) {
  document.getElementById('asoc-id').value = id;
  document.getElementById('asoc-select-cliente').value = idCliente;
  document.getElementById('asoc-select-lista').value = idLista;
  document.getElementById('asoc-predeterminada').checked = esPredeterminada;
}

export async function eliminarAsociacion(id) {
  const ok = await confirmarAccion({
    titulo: 'Eliminar asociación',
    mensaje: '¿Eliminar esta asociación?',
    textoConfirmar: 'Sí, eliminar',
    peligro: true
  });
  if (!ok) return;
  const { error } = await supabaseAdmin.from('TB_ACLIENTE_LISTA_PRECIOS').delete().eq('id', id);
  if (error) mostrarNotificacion('Error al eliminar: ' + error.message, 'danger');
  else {
    mostrarNotificacion('Asociación eliminada.');
    await listarAsociacionesClienteLista();
  }
}

function resetearFormAsociacion() {
  document.getElementById('asoc-id').value = '';
  document.getElementById('asoc-predeterminada').checked = false;
}