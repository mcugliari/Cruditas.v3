export let pedidoEditandoId = null;
export function setPedidoEditandoId(val) { pedidoEditandoId = val; }

// Estado que tenía el pedido al empezar a editarlo (PREPARACION o PREPARADO). Se usa para
// mostrarlo en el POS y para que "Guardar cambios" no lo cambie.
export let pedidoEditandoEstado = null;
export function setPedidoEditandoEstado(val) { pedidoEditandoEstado = val; }

// Opción B (pedido nuevo con el pago de uno anulado): { id, aDevolver } del pedido anulado cuyo pago se va a traspasar
// al pedido que se está armando en el POS. null = el pedido del POS es uno común.
export let pedidoPagoOrigen = null;
export function setPedidoPagoOrigen(val) { pedidoPagoOrigen = val; }

export let carrito = {};
export function setCarrito(nuevo) { carrito = nuevo; }

export let cacheProductos = [];
export function setCacheProductos(val) { cacheProductos = val; }

export let cachePrecios = [];
export function setCachePrecios(val) { cachePrecios = val; }

export let cacheCategorias = [];
export function setCacheCategorias(val) { cacheCategorias = val; }