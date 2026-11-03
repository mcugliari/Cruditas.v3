// =============================================================================
// telefono.js  ·  Teléfonos argentinos para WhatsApp (lo usan pedidos.js y ajustes.js)
// =============================================================================

// Pasa un teléfono escrito de cualquier forma al formato que pide wa.me para celulares argentinos:
// 549 + característica + número (sin 0 ni 15). Devuelve '' si no se puede armar con seguridad.
// Acepta: 1122334455, 011 2233-4455, 011 15 2233 4455, +54 9 11 2233 4455, 5491122334455.
export function telefonoParaWhatsApp(texto) {
  let n = String(texto ?? '').replace(/\D/g, '');   // solo dígitos
  n = n.replace(/^0+/, '');                          // 0 de la característica o 00 internacional
  if (n.startsWith('54')) {                          // código de país: se saca (y el 9 de celular, si está)
    n = n.slice(2);
    if (n.startsWith('9') && n.length === 11) n = n.slice(1);
  }
  if (n.length === 12) {                             // con el 15 en el medio: se busca y se saca
    for (const i of [2, 3, 4]) {                     // característica de 2, 3 o 4 dígitos
      if (n.slice(i, i + 2) === '15') { n = n.slice(0, i) + n.slice(i + 2); break; }
    }
  }
  // 10 dígitos y característica válida (11, o empieza con 2 o 3). Si no, no se arriesga un número equivocado.
  if (n.length === 10 && /^(11|[23])/.test(n)) return '549' + n;
  return '';
}
