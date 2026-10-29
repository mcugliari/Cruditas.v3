// =============================================================================
// menuMas.js  ·  BOTÓN "MÁS" DE LAS TABLAS (menú desplegable de acciones)
// =============================================================================
//
// QUÉ HACE
//   Abre, ubica y cierra el menú que aparece al tocar "Más ▾" en una fila de tabla
//   (Gestión de Pedidos y Cuentas y Saldos). Se importa desde main.js, así queda
//   registrado para toda la página.
//
// CÓMO FUNCIONA
//   - Cada fila trae su propio menú (<div class="menu-mas">) justo después del botón.
//   - El menú tiene position: fixed (ver styles.css), así el scroll de la tabla no lo recorta.
//   - Este archivo SOLO abre / ubica / cierra el menú. Lo que hace cada opción lo resuelven
//     los escuchadores de siempre (main.js con data-action, y el de impresión en pedidos.js).
//
// PARA USARLO EN OTRA PANTALLA
//   1) Armar el HTML igual que en pedidos.js o cuentas.js (botón .btn-accion-mas + .menu-mas).
//   2) Nada más: el escuchador de este archivo ya atiende toda la página.
//
// EXPORTA dos ayudantes para armar botones (los textos y clases son fijos; no meter acá
// datos escritos por usuarios sin pasarlos por esc()).
// =============================================================================

// Botón visible de la fila (con ícono y texto).
export function btnFila(clase, icono, texto, atributos) {
  return `<button type="button" class="btn btn-accion ${clase}" ${atributos}><i class="fas ${icono}"></i> ${texto}</button>`;
}

// Opción del menú "Más".
export function itemMenuMas(icono, texto, atributos, claseExtra = '') {
  return `<button type="button" class="menu-mas-item ${claseExtra}" role="menuitem" ${atributos}><i class="fas ${icono}"></i> ${texto}</button>`;
}

function cerrarMenusMas() {
  document.querySelectorAll('.menu-mas.show').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.btn-accion-mas[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}

// Abre el menú pegado al botón: hacia abajo y, si no entra, hacia arriba.
function abrirMenuMas(btn) {
  const menu = btn.nextElementSibling;
  if (!menu) return;
  menu.style.visibility = 'hidden';   // se muestra fuera de la vista solo para medirlo
  menu.classList.add('show');
  const r = btn.getBoundingClientRect();
  const ancho = menu.offsetWidth;
  const alto = menu.offsetHeight;
  let arriba = r.bottom + 4;
  if (arriba + alto > window.innerHeight - 8) arriba = Math.max(8, r.top - alto - 4);
  const izquierda = Math.min(Math.max(8, r.right - ancho), window.innerWidth - ancho - 8);
  menu.style.top = `${arriba}px`;
  menu.style.left = `${izquierda}px`;
  menu.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
}

// Un solo escuchador para toda la página: si se toca "Más" se abre (o se cierra si ya
// estaba abierto); cualquier otro toque, incluso una opción del menú, lo cierra.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-accion-mas');
  if (btn) {
    const eraEste = btn.nextElementSibling?.classList.contains('show');
    cerrarMenusMas();
    if (!eraEste) abrirMenuMas(btn);
    return;
  }
  cerrarMenusMas();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarMenusMas(); });
document.addEventListener('scroll', cerrarMenusMas, true);   // true: también el scroll de la tabla
window.addEventListener('resize', cerrarMenusMas);
