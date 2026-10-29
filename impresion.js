import { supabaseAdmin } from './config.js';

// Escapa texto antes de insertarlo con innerHTML (evita inyección de HTML/JS).
// nombre_referencia lo escribe un cliente anónimo desde la web.
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export async function obtenerPedidoParaImprimir(idPedido) {
  // Se agregan id, id_categoria e id_producto al SELECT para que el filtro funcione
  const { data: pedido, error } = await supabaseAdmin
    .from('TB_TPEDIDOS')
    .select('*, TB_BCLIENTES(nombre), TB_BMEDIO_PAGO(nombre), TB_DPEDIDOS(id_producto, cantidad, precioUnitario, subTotal, TB_BPRODUCTOS(id, id_categoria, nombre, TB_BCATEGORIAS(nombre)))')
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

  // Función helper para detectar si es el ítem de descuento
  const esItemDescuento = (item) => {
    const idCat = Number(item.TB_BPRODUCTOS?.id_categoria);
    return idCat === 99;
  };

  // FILTRO: Excluir el producto de descuento si es comanda de cocina
  // (en el ticket del cliente también se oculta un renglón de descuento en $0)
  const itemsAImprimir = esComandaCocina 
    ? items.filter(item => !esItemDescuento(item))
    : items.filter(item => !esItemDescuento(item) || Number(item.subTotal) !== 0);

  const filasHTML = itemsAImprimir.map(item => {
    const esDescuento = esItemDescuento(item);

    // Renglón de descuento exclusivo para el comprobante del cliente
    if (esDescuento) {
      return `
        <div class="linea-item text-danger" style="color: #dc3545;">
          <span class="cant">${item.cantidad} doc.</span>
          <span class="nombre">Descuento por Docena</span>
          <span class="precio">-$${formatearMoneda(Math.abs(item.subTotal))}</span>
        </div>
      `;
    }

    const esDocena = item.cantidad >= 12 && (item.cantidad % 12 === 0);
    const cantTexto = esDocena ? `${item.cantidad / 12} doc.` : `${item.cantidad} u.`;
    
    const categoriaNombre = item.TB_BPRODUCTOS?.TB_BCATEGORIAS?.nombre;
    const nombreProd = categoriaNombre 
      ? `${categoriaNombre} ${item.TB_BPRODUCTOS?.nombre || 'Producto'}` 
      : (item.TB_BPRODUCTOS?.nombre || 'Producto');
    
    if (esComandaCocina) {
      return `
        <div class="linea-item">
          <span class="cant">${cantTexto}</span>
          <span class="nombre">${esc(nombreProd)}</span>
        </div>
      `;
    }

    return `
      <div class="linea-item">
        <span class="cant">${cantTexto}</span>
        <span class="nombre">${esc(nombreProd)}</span>
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
        <p><strong>Cliente:</strong> ${esc(clienteNombre)}</p>
        ${!esComandaCocina ? `<p><strong>Pago:</strong> ${esc(pedido.TB_BMEDIO_PAGO?.nombre || 'Sin cobrar')}</p>` : ''}
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

  // Disparar la impresión nativa
  window.print();
}


// =============================================================================
// IMPRESIÓN AUTOMÁTICA AL TOMAR UN PEDIDO (la llama pos.js según las preferencias de
// preferencias.js). Reutiliza obtenerPedidoParaImprimir e imprimirComprobante.
// =============================================================================

// Pausa corta. Sirve para que la 2ª impresión no pise a la 1ª cuando el navegador imprime
// directo (modo kiosco): se espera a que la primera ya haya salido hacia la impresora.
const esperar = (ms) => new Promise(resolver => setTimeout(resolver, ms));

// Lee el pedido ya guardado y manda a imprimir la comanda y/o el ticket.
// Si hay que imprimir los dos, va primero la comanda y después el ticket.
// Devuelve true si imprimió, false si no encontró el pedido.
export async function imprimirAutomatico(idPedido, { comanda = false, ticket = false } = {}) {
  const pedido = await obtenerPedidoParaImprimir(idPedido);
  if (!pedido) return false;

  if (comanda) imprimirComprobante(pedido, true);
  if (comanda && ticket) await esperar(700);
  if (ticket) imprimirComprobante(pedido, false);
  return true;
}

// Imprime una comanda y un ticket de PRUEBA (no toca la base), para comprobar la impresora
// y el ancho del papel. Se usa desde la pantalla "Impresión".
export async function imprimirPrueba() {
  const pedido = {
    id: 'PRUEBA',
    created_at: new Date().toISOString(),
    nombre_referencia: 'Prueba de impresión',
    importe_total: 3000,
    TB_BMEDIO_PAGO: { nombre: 'Efectivo' },
    TB_DPEDIDOS: [
      { cantidad: 12, subTotal: 2400, TB_BPRODUCTOS: { id: 0, id_categoria: 0, nombre: 'Producto de prueba', TB_BCATEGORIAS: { nombre: 'Empanada' } } },
      { cantidad: 1,  subTotal: 600,  TB_BPRODUCTOS: { id: 0, id_categoria: 0, nombre: 'Otro producto',    TB_BCATEGORIAS: { nombre: 'Pizza' } } }
    ]
  };
  imprimirComprobante(pedido, true);
  await esperar(700);
  imprimirComprobante(pedido, false);
}
