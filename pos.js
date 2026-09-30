import { supabaseClient } from './config.js';
import { 
  carrito, setCarrito, 
  cacheProductos, setCacheProductos, 
  cachePrecios, setCachePrecios, 
  cacheCategorias, setCacheCategorias, 
  pedidoEditandoId, setPedidoEditandoId 
} from './state.js';
import { mostrarNotificacion } from './utils.js';

export async function inicializarPOS() {
  await cargarSelectsPOS();
  await cargarPOS();
}

export async function cargarSelectsPOS() {
  const { data: clientes } = await supabaseClient.from('TB_BCLIENTES').select('*').order('nombre');
  const { data: listas } = await supabaseClient.from('TB_TLISTA_PRECIOS').select('*');
  const { data: medios } = await supabaseClient.from('TB_BMEDIO_PAGO').select('*');

  const selectCli = document.getElementById('select-cliente-pedido');
  if (selectCli && clientes) selectCli.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

  const selectLis = document.getElementById('select-lista-pedido');
  if (selectLis && listas) selectLis.innerHTML = listas.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');

  const selectMed = document.getElementById('select-medio-pago');
  if (selectMed && medios) selectMed.innerHTML = medios.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');

  await alCambiarCliente();
}

export async function alCambiarCliente() {
  const selectCli = document.getElementById('select-cliente-pedido');
  if (!selectCli || !selectCli.value) return;

  const idCliente = selectCli.value;
  const inputRef = document.getElementById('input-ref-cliente');

  // Supongamos que el ID de Consumidor Final es 1 (o podés verificar por el texto)
  const esConsumidorFinal = idCliente === '1' || selectCli.options[selectCli.selectedIndex]?.text.toLowerCase().includes('Consumidor Final');

  if (inputRef) {
    if (!esConsumidorFinal) {
      // Si eligen un cliente registrado, limpiamos la referencia opcional
      inputRef.value = '';
    }
  }

  // Buscar la lista de precios predeterminada del cliente
  const { data } = await supabaseClient
    .from('TB_ACLIENTE_LISTA_PRECIOS')
    .select('id_lista_precio')
    .eq('id_cliente', selectCli.value)
    .eq('m_predeterminada', true)
    .maybeSingle();

  if (data && data.id_lista_precio) {
    document.getElementById('select-lista-pedido').value = data.id_lista_precio;
  }
  
  await cargarPOS();
}

export async function cargarPOS() {
  const selectLis = document.getElementById('select-lista-pedido');
  const idLista = selectLis && selectLis.value ? parseInt(selectLis.value) : 1;

  const { data: categorias } = await supabaseClient.from('TB_BCATEGORIAS').select('*').order('id');
  const { data: productos } = await supabaseClient.from('TB_BPRODUCTOS').select('*').order('id');
  const { data: precios } = await supabaseClient.from('TB_DLISTA_PRECIOS').select('*').eq('id_lista_precio', idLista);

  setCacheCategorias(categorias || []);
  setCacheProductos(productos || []);
  setCachePrecios(precios || []);

  renderizarGrillaPOS();
}

export function renderizarGrillaPOS() {
  const contenedor = document.getElementById('contenedor-menu-productos');
  if (!contenedor) return;

  if (!Array.isArray(cacheCategorias) || !Array.isArray(cacheProductos)) {
    contenedor.innerHTML = '<p class="text-muted text-center my-3">Cargando menú...</p>';
    return;
  }

  const paletaColores = ['primary', 'success', 'warning', 'danger', 'info', 'secondary'];
  let htmlCompleto = '';

  cacheCategorias.forEach((cat, index) => {
    const prodsCat = cacheProductos.filter(p => Number(p.id_categoria || p.idCategoria) === Number(cat.id));
    if (prodsCat.length === 0) return;

    const colorCat = paletaColores[index % paletaColores.length];

    htmlCompleto += `
      <div class="pos-cat-header mb-2 mt-2">${cat.nombre}</div>
      <div class="row">
    `;

    prodsCat.forEach(p => {
      const cant = carrito[p.id] || 0;
      const idCatProd = p.id_categoria || p.idCategoria;
      const precios = obtenerPrecioProducto(p.id, idCatProd);
      const claseActiva = cant > 0 ? 'pos-card-activa' : '';

      htmlCompleto += `
        <div class="col-6 col-sm-4 col-md-3 col-lg-2 mb-3">
          <div class="card h-100 pos-card-producto border-0 border-left-${colorCat} ${claseActiva}">
            <strong class="pos-prod-title" title="${p.nombre}">${p.nombre}</strong>
            <span class="pos-prod-price mb-3">$${precios.unidad.toLocaleString('es-AR')}</span>
            
            <div class="pos-qty-pill mb-2">
              <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="-1">-</button>
              <span class="pos-cant-num" id="cant-prod-${p.id}">${cant}</span>
              <button type="button" class="btn btn-pos-sq" data-action="alterar-cant" data-id="${p.id}" data-delta="1">+</button>
            </div>

            <div class="d-flex justify-content-between gap-1">
              <button type="button" class="btn btn-docena-pill flex-fill mr-1" data-action="alterar-cant" data-id="${p.id}" data-delta="-12">-12 u.</button>
              <button type="button" class="btn btn-docena-pill flex-fill" data-action="alterar-cant" data-id="${p.id}" data-delta="12">+12 u.</button>
            </div>
          </div>
        </div>
      `;
    });

    htmlCompleto += `</div>`;
  });

  contenedor.innerHTML = htmlCompleto;
  actualizarResumenCarrito();
}

export function obtenerPrecioProducto(idProd, idCat, idLista = null) {
  if (!cachePrecios || cachePrecios.length === 0) return { unidad: 0, docena: 0 };

  const idP = Number(idProd);
  const idC = Number(idCat);
  const idL = idLista ? Number(idLista) : Number(document.getElementById('select-lista-pedido')?.value || 0);

  const preciosFiltrados = cachePrecios.filter(p => !idL || Number(p.id_lista_precio || p.id_lista) === idL);
  const listaABuscar = preciosFiltrados.length > 0 ? preciosFiltrados : cachePrecios;

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

export function calcularSubtotalItem(cantidad, precios, permiteDocena = true) {
  if (!permiteDocena || !precios.docena) {
    return cantidad * precios.unidad;
  }
  const docenas = Math.floor(cantidad / 12);
  const sueltas = cantidad % 12;

  return (docenas * precios.docena) + (sueltas * precios.unidad);
}

export function alterarCantidad(idProducto, delta) {
  const actual = carrito[idProducto] || 0;
  const nueva = Math.max(0, actual + delta);
  
  if (nueva === 0) {
    delete carrito[idProducto];
  } else {
    carrito[idProducto] = nueva;
  }

  // Buscar el elemento contador en el DOM
  const elCant = document.getElementById(`cant-prod-${idProducto}`);
  
  if (elCant) {
    elCant.innerText = nueva;
    // Encontrar la tarjeta contenedora
    const tarjeta = elCant.closest('.pos-card-producto');
    if (tarjeta) {
      if (nueva > 0) {
        tarjeta.classList.add('pos-card-activa');
      } else {
        tarjeta.classList.remove('pos-card-activa');
      }
    }
  } else {
    // Si no está el elemento específico, re-renderizar la grilla completa
    renderizarGrillaPOS();
  }

  actualizarResumenCarrito();
}

export function actualizarResumenCarrito() {
  const contenedorItems = document.getElementById('resumen-carrito-items');
  const keys = Object.keys(carrito);

  if (keys.length === 0) {
    if (contenedorItems) contenedorItems.innerHTML = `<p class="text-center text-muted small my-3">El carrito está vacío</p>`;
    document.getElementById('cant-docenas').innerText = '0 u.';
    document.getElementById('cant-total-items').innerText = '0';
    document.getElementById('monto-total-pedido').innerText = '$0';
    return;
  }

  let totalItems = 0;
  let montoTotal = 0;
  let html = '<ul class="list-group list-group-flush small">';

  keys.forEach(idProd => {
    const p = cacheProductos.find(x => x.id == idProd);
    if (!p) return;

    const cant = carrito[idProd];
    const idCatProd = p.id_categoria;
    const cat = cacheCategorias.find(c => Number(idCatProd) === Number(c.id));
    const nombreCat = cat ? cat.nombre : '';
    const textoProducto = nombreCat ? `${nombreCat} ${p.nombre}` : p.nombre;
    
    const precios = obtenerPrecioProducto(p.id, idCatProd);
    const subtotal = calcularSubtotalItem(cant, precios, p.m_permite_docena);

    totalItems += cant;
    montoTotal += subtotal;

    let detalleTexto = `${cant} u. x $${precios.unidad}`;
    if (p.m_permite_docena && precios.docena && cant >= 12) {
      const doc = Math.floor(cant / 12);
      const ult = cant % 12;
      detalleTexto = `${doc} doc. ($${precios.docena})` + (ult > 0 ? ` + ${ult} u. ($${precios.unidad})` : '');
    }

    html += `
      <li class="list-group-item d-flex justify-content-between align-items-center p-2 bg-transparent border-bottom">
        <div>
          <strong class="d-block">${textoProducto}</strong>
          <small class="text-muted">${detalleTexto}</small>
        </div>
        <span class="font-weight-bold">$${subtotal.toLocaleString('es-AR')}</span>
      </li>
    `;
  });

  html += '</ul>';
  if (contenedorItems) contenedorItems.innerHTML = html;

  const totalDocenas = (totalItems / 12).toFixed(1);
  document.getElementById('cant-docenas').innerText = `${totalDocenas} doc.`;
  document.getElementById('cant-total-items').innerText = totalItems;
  document.getElementById('monto-total-pedido').innerText = `$${montoTotal.toLocaleString('es-AR')}`;
}

export function resetearPedido() {
  const inputRef = document.getElementById('input-ref-cliente');
  if (inputRef) inputRef.value = '';

  setPedidoEditandoId(null);
  setCarrito({});
  renderizarGrillaPOS();
}

export function vaciarCarrito() {
  resetearPedido();
}

export async function guardarPedido(estadoInicial) {
  const keys = Object.keys(carrito);
  if (keys.length === 0) {
    mostrarNotificacion('Agregá al menos un producto al carrito.', 'warning');
    return;
  }

  const idCliente = document.getElementById('select-cliente-pedido').value;
  const idLista = document.getElementById('select-lista-pedido').value;
  const selectMedio = document.getElementById('select-medio-pago');
  const idMedio = selectMedio ? selectMedio.value : null;

  // CAPTURAR LA REFERENCIA DE TEXTO LIBRE
  const inputRef = document.getElementById('input-ref-cliente');
  const nombreReferencia = inputRef ? inputRef.value.trim() : null;

  let montoTotal = 0;
  const detalles = [];

  keys.forEach(idProd => {
    const p = cacheProductos.find(x => Number(x.id) === Number(idProd));
    if (!p) return;

    const cantidadTotal = Number(carrito[idProd]) || 0;
    if (cantidadTotal <= 0) return;

    const precios = obtenerPrecioProducto(p.id, p.id_categoria || p.idCategoria, idLista);
    const precioUnidad = precios.unidad || 0;
    const precioDocena = precios.docena || (precioUnidad * 12);
    const permiteDocena = Boolean(p.m_permite_docena);

    if (permiteDocena && cantidadTotal >= 12) {
      const cantDocenas = Math.floor(cantidadTotal / 12);
      const unidadesSueltas = cantidadTotal % 12;

      detalles.push({
        id_pedido: null,
        id_producto: p.id,
        cantidad: cantDocenas * 12,
        precio: precioDocena * cantDocenas
      });
      montoTotal += cantDocenas * precioDocena;

      if (unidadesSueltas > 0) {
        detalles.push({
          id_pedido: null,
          id_producto: p.id,
          cantidad: unidadesSueltas,
          precio: precioUnidad * unidadesSueltas
        });
        montoTotal += unidadesSueltas * precioUnidad;
      }
    } else {
      detalles.push({
        id_pedido: null,
        id_producto: p.id,
        cantidad: cantidadTotal,
        precio: precioUnidad
      });
      montoTotal += cantidadTotal * precioUnidad;
    }
  });
  
  let idPedidoFinal = pedidoEditandoId;

  if (pedidoEditandoId) {
    const { error: errUpdate } = await supabaseClient
      .from('TB_TPEDIDOS')
      .update({
        id_cliente: idCliente,
        nombre_referencia: nombreReferencia,
        id_lista_precio: idLista,
        id_medio_pago: idMedio,
        estado: estadoInicial,
        importe_total: montoTotal
      })
      .eq('id', pedidoEditandoId);

    if (errUpdate) {
      mostrarNotificacion('Error al actualizar cabecera: ' + errUpdate.message, 'danger');
      return;
    }

    await supabaseClient.from('TB_DPEDIDOS').delete().eq('id_pedido', pedidoEditandoId);

  } else {
    const { data: pedido, error } = await supabaseClient
      .from('TB_TPEDIDOS')
      .insert([{
        fecha: new Date().toISOString().split('T')[0],
        id_cliente: idCliente,
        nombre_referencia: nombreReferencia,
        id_lista_precio: idLista,
        id_medio_pago: idMedio,
        estado: estadoInicial,
        importe_total: montoTotal
      }])
      .select()
      .single();

    if (error) {
      mostrarNotificacion('Error al guardar el pedido: ' + error.message, 'danger');
      return;
    }
    idPedidoFinal = pedido.id;
  }

  detalles.forEach(d => d.id_pedido = idPedidoFinal);

  const { error: errorDetalle } = await supabaseClient.from('TB_DPEDIDOS').insert(detalles);

  if (errorDetalle) {
    mostrarNotificacion('Error al guardar el detalle: ' + errorDetalle.message, 'danger');
    return;
  }

  mostrarNotificacion(`¡Pedido #${idPedidoFinal} ${pedidoEditandoId ? 'actualizado' : 'registrado'} con éxito!`, 'success');

  // Limpiar campo de referencia tras guardar
  if (inputRef) inputRef.value = '';

  setPedidoEditandoId(null);
  resetearPedido();
}