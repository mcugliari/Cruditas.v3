import { supabaseClient } from './config.js';

export async function obtenerPedidoParaImprimir(idPedido) {
  const { data: pedido, error } = await supabaseClient
    .from('TB_TPEDIDOS')
    .select('*, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_DPEDIDOS(cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(nombre, TB_BCATEGORIAS(nombre)))')
    .eq('id', idPedido)
    .single();

  if (error || !pedido) {
    console.error('Error al obtener pedido para imprimir:', error);
    return null;
  }
  return pedido;
}

export function imprimirComprobante(pedido, esComandaCocina = false) {
  if (!pedido) return;

  let ticketElem = document.getElementById('ticket-impresion');
  if (!ticketElem) {
    ticketElem = document.createElement('div');
    ticketElem.id = 'ticket-impresion';
    document.body.appendChild(ticketElem);
  }

  const formatearMoneda = (val) => Number(val || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const clienteNombre = pedido.nombre_referencia || pedido.TB_BCLIENTES?.nombre || 'Consumidor Final';
  
  // Formatear hora de creación
  const horaPedido = pedido.created_at 
    ? new Date(pedido.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const items = pedido.TB_DPEDIDOS || [];

  const filasHTML = items.map(item => {
    const esDocena = item.cantidad >= 12 && (item.cantidad % 12 === 0);
    const cantTexto = esDocena ? `${item.cantidad / 12} doc.` : `${item.cantidad} u.`;
    const nombreProd = `${item.TB_BPRODUCTOS?.TB_BCATEGORIAS?.nombre || ''} ${item.TB_BPRODUCTOS?.nombre || 'Producto'}`;
    
    if (esComandaCocina) {
      return `
        <div class="linea-item">
          <span class="cant">${cantTexto}</span>
          <span class="nombre">${nombreProd}</span>
        </div>
      `;
    }

    return `
      <div class="linea-item">
        <span class="cant">${cantTexto}</span>
        <span class="nombre">${nombreProd}</span>
        <span class="precio">$${formatearMoneda(item.subTotal)}</span>
      </div>
    `;
  }).join('');

  ticketElem.innerHTML = `
    <div class="ticket-wrapper">
      <div class="encabezado">
        <h2>🍕 CRUDITAS 🥟</h2>
        <p class="subtitulo">${esComandaCocina ? '*** COMANDA COCINA ***' : 'COMPROBANTE DE VENTA'}</p>
        <hr class="dashed">
        <p><strong>Pedido #${pedido.id}</strong> | ${horaPedido} hs</p>
        <p><strong>Cliente:</strong> ${clienteNombre}</p>
        ${!esComandaCocina ? `<p><strong>Pago:</strong> ${pedido.TB_BMEDIO_PAGO?.nombre || 'Efectivo'}</p>` : ''}
      </div>
      
      <hr class="dashed">
      
      <div class="cuerpo-items">
        ${filasHTML}
      </div>
      
      <hr class="dashed">
      
      ${!esComandaCocina ? `
        <div class="total-linea">
          <span>TOTAL:</span>
          <strong>$${formatearMoneda(pedido.importe_total)}</strong>
        </div>
        <hr class="dashed">
        <p class="pie-pagina">¡Muchas gracias por su compra!</p>
      ` : ''}
    </div>
  `;

  // Disparar la impresión nativa (se puede guardar como PDF para probar)
  window.print();
}