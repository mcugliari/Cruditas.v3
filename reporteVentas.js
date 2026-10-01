import { supabaseClient } from './config.js';
import { mostrarNotificacion } from './utils.js';

export async function inicializarReporteVentas() {
  await cargarSelectClientesFiltro();

  const hoy = new Date().toISOString().split('T')[0];
  const inputDesde = document.getElementById('filtro-prod-fecha-desde');
  const inputHasta = document.getElementById('filtro-prod-fecha-hasta');

  if (inputDesde && !inputDesde.value) inputDesde.value = hoy;
  if (inputHasta && !inputHasta.value) inputHasta.value = hoy;

  await generarResumenVentasProductos();
}

export async function cargarSelectClientesFiltro() {
  const select = document.getElementById('filtro-prod-cliente');
  if (!select) return;

  const { data: clientes } = await supabaseClient
    .from('TB_BCLIENTES')
    .select('id, nombre')
    .order('nombre');

  if (clientes) {
    select.innerHTML = '<option value="">-- Todos los Clientes --</option>' + 
      clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  }
}

export async function generarResumenVentasProductos() {
  const fDesde = document.getElementById('filtro-prod-fecha-desde')?.value;
  const fHasta = document.getElementById('filtro-prod-fecha-hasta')?.value;
  const idCliente = document.getElementById('filtro-prod-cliente')?.value;

  if (!fDesde || !fHasta) {
    mostrarNotificacion('Seleccioná un rango de fechas válido.', 'warning');
    return;
  }

  const fechaDesdeStr = `${fDesde}T00:00:00`;
  const fechaHastaStr = `${fHasta}T23:59:59`;

  // 1. Consultar pedidos completados
  let queryPedidos = supabaseClient
    .from('TB_TPEDIDOS')
    .select('id')
    .eq('estado', 'COMPLETADO')
    .gte('created_at', fechaDesdeStr)
    .lte('created_at', fechaHastaStr);

  if (idCliente) {
    queryPedidos = queryPedidos.eq('id_cliente', idCliente);
  }

  const { data: pedidos, error: errPed } = await queryPedidos;

  const tbody = document.getElementById('tbody-resumen-productos');
  const tfoot = document.getElementById('tfoot-resumen-productos');

  if (errPed || !pedidos || pedidos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No hay ventas registradas para los filtros seleccionados.</td></tr>`;
    if (tfoot) tfoot.style.display = 'none';
    renderizarTarjetasGrupos({});
    return;
  }

  const idsPedidos = pedidos.map(p => p.id);

  // 2. Traer el detalle usando la columna 'grupo' de la tabla TB_BCATEGORIAS
  const { data: detalles, error: errDet } = await supabaseClient
    .from('TB_DPEDIDOS')
    .select(`
      cantidad,
      subTotal,
      TB_BPRODUCTOS (
        id,
        nombre,
        m_permite_docena,
        TB_BCATEGORIAS ( nombre, grupo )
      )
    `)
    .in('id_pedido', idsPedidos);

  if (errDet) {
    mostrarNotificacion('Error al consultar el detalle: ' + errDet.message, 'danger');
    return;
  }

  // 3. Agrupar por Grupo y por Producto
  const gruposAcumulados = {};
  const productosAgrupados = {};

  detalles.forEach(item => {
    const prod = item.TB_BPRODUCTOS;
    if (!prod) return;

    const cant = Number(item.cantidad || 0);
    const monto = Number(item.subTotal || 0);

    // Leer el nuevo atributo 'grupo' (Ej: "EMPANADAS", "PIZZAS", u "OTROS")
    const grupoNombre = (prod.TB_BCATEGORIAS?.grupo || 'OTROS').toUpperCase().trim();
    const catNombre = prod.TB_BCATEGORIAS?.nombre || 'Sin Categoría';

    // Acumulador de KPI por grupo
    if (!gruposAcumulados[grupoNombre]) {
      gruposAcumulados[grupoNombre] = { unidades: 0, monto: 0 };
    }
    gruposAcumulados[grupoNombre].unidades += cant;
    gruposAcumulados[grupoNombre].monto += monto;

    // Acumulador por producto individual
    const keyProd = prod.id;
    if (!productosAgrupados[keyProd]) {
      productosAgrupados[keyProd] = {
        grupo: grupoNombre,
        categoria: catNombre,
        producto: prod.nombre,
        permiteDocena: Boolean(prod.m_permite_docena),
        unidades: 0,
        montoTotal: 0
      };
    }
    productosAgrupados[keyProd].unidades += cant;
    productosAgrupados[keyProd].montoTotal += monto;
  });

  // 4. Renderizar KPIs visuales superiores
  renderizarTarjetasGrupos(gruposAcumulados);

  // 5. Renderizar Tabla de Detalle
  const listaConsolidada = Object.values(productosAgrupados).sort((a, b) => 
    a.grupo.localeCompare(b.grupo) || a.categoria.localeCompare(b.categoria) || a.producto.localeCompare(b.producto)
  );

  let totalUnidadesGral = 0;
  let totalMontoGral = 0;

  tbody.innerHTML = listaConsolidada.map(row => {
    totalUnidadesGral += row.unidades;
    totalMontoGral += row.montoTotal;

    const textoDocenas = row.permiteDocena 
      ? `${(row.unidades / 12).toFixed(1)} doc.` 
      : '-';

    return `
      <tr>
        <td>
          <span class="badge ${row.grupo === 'EMPANADAS' ? 'badge-warning' : (row.grupo === 'PIZZAS' ? 'badge-danger' : 'badge-secondary')}">
            ${row.grupo}
          </span>
          <small class="text-muted ml-1">(${row.categoria})</small>
        </td>
        <td class="font-weight-bold">${row.producto}</td>
        <td class="text-center">${row.unidades} u.</td>
        <td class="text-center text-muted">${textoDocenas}</td>
        <td class="text-right font-weight-bold">$${row.montoTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');

  if (tfoot) {
   tfoot.style.display = 'table-footer-group';
    document.getElementById('total-resumen-unidades').innerText = `${totalUnidadesGral} u.`;
    
    // Opcional: Para el Total General podés mostrar solo las docenas del grupo de Empanadas
    const unidadesEmpanadas = gruposAcumulados['EMPANADAS']?.unidades || 0;
    document.getElementById('total-resumen-docenas').innerText = `${(unidadesEmpanadas / 12).toFixed(1)} doc.`;
    
    document.getElementById('total-resumen-monto').innerText = `$${totalMontoGral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
  }
}

function renderizarTarjetasGrupos(grupos) {
  const cont = document.getElementById('contenedor-kpis-grupos');
  if (!cont) return;

  const emp = grupos['EMPANADAS'] || { unidades: 0, monto: 0 };
  const piz = grupos['PIZZAS'] || { unidades: 0, monto: 0 };
  const otros = grupos['OTROS'] || { unidades: 0, monto: 0 };

  const docenasEmp = (emp.unidades / 12).toFixed(1);

  cont.innerHTML = `
    <div class="row mb-3">
      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-warning text-white" style="font-size: 1.8rem;">🥟</span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Empanadas y Canastitas</span>
            <span class="info-box-number text-dark">${emp.unidades} u. <small class="text-muted">(${docenasEmp} doc.)</small></span>
            <span class="progress-description text-success font-weight-bold">$${emp.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>

      <div class="col-md-4 col-sm-6 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-danger text-white"><i class="fas fa-pizza-slice"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Pizzas</span>
            <span class="info-box-number text-dark">${piz.unidades} u.</span>
            <span class="progress-description text-success font-weight-bold">$${piz.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>

      <div class="col-md-4 col-sm-12 mb-2">
        <div class="info-box bg-light border">
          <span class="info-box-icon bg-info text-white"><i class="fas fa-box"></i></span>
          <div class="info-box-content">
            <span class="info-box-text font-weight-bold">Otros / Varios</span>
            <span class="info-box-number text-dark">${otros.unidades} u.</span>
            <span class="progress-description text-success font-weight-bold">$${otros.monto.toLocaleString('es-AR')}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}