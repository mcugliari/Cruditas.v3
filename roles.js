// =============================================================================
// roles.js  ·  ROLES DEL POS (etapa 1: solo adapta lo que se VE)
// =============================================================================
//
// QUÉ HACE
//   Pregunta a la base cuál es el rol del usuario que inició sesión
//   (función mi_rol(): EMPLEADO, ENCARGADO o DUENO) y oculta del menú y de los
//   botones lo que ese rol no debe usar.
//
// IMPORTANTE
//   Ocultar es solo comodidad. La protección real (que la base rechace lo que
//   no corresponde) llega en la etapa 2. Hasta entonces, nada de esto bloquea.
//
// CÓMO SE MARCA LO QUE SE OCULTA (en index.html)
//   data-rol-min="ENCARGADO"  ->  lo ve el Encargado y el Dueño.
//   data-rol-min="DUENO"      ->  lo ve solo el Dueño.
//   Sin el atributo, lo ve cualquier rol.
//
// CÓMO SE USA
//   main.js:    if (!(await iniciarRoles())) return;     // después del login
//   pantallas:  aplicarRol(contenedor)                    // si dibujan botones nuevos
//
// SI FALLA LA CONSULTA (por ejemplo, el script SQL aún no se corrió)
//   No se oculta nada y se avisa en la consola (F12): así nadie queda
//   encerrado por un error técnico.
// =============================================================================

import { supabaseClient } from './config.js';

// Orden de menor a mayor permiso. Un rol puede todo lo que puede el anterior.
const RANGO = { EMPLEADO: 1, ENCARGADO: 2, DUENO: 3 };
const NOMBRE = { EMPLEADO: 'Empleado', ENCARGADO: 'Encargado', DUENO: 'Dueño' };

let rol = null;            // rol del usuario, o null si no tiene
let rolConocido = false;   // false = no se pudo consultar (no se oculta nada)

// Devuelve el rol actual ('EMPLEADO' | 'ENCARGADO' | 'DUENO' | null).
export function rolActual() {
  return rol;
}

// ¿El usuario tiene, al menos, el rol indicado? Ej.: puedeAlMenos('ENCARGADO')
export function puedeAlMenos(minimo) {
  if (!rolConocido) return true;        // sin información: no ocultamos
  if (!RANGO[minimo]) return true;      // elemento sin restricción
  return (RANGO[rol] || 0) >= RANGO[minimo];
}

// ¿Puede entrar a esa sección del menú? Se usa desde navegarA (main.js).
export function puedeVerSeccion(seccionId) {
  const link = document.querySelector(`#menu-navegacion [data-section="${seccionId}"]`);
  return !link || puedeAlMenos(link.dataset.rolMin);
}

// Oculta lo que el rol no puede usar. "raiz" permite revisar solo una parte
// de la página (útil para botones que una pantalla dibuja después).
export function aplicarRol(raiz = document) {
  raiz.querySelectorAll('[data-rol-min]').forEach((el) => {
    if (puedeAlMenos(el.dataset.rolMin)) return;
    // Si es un link del menú, se oculta todo su renglón.
    const contenedor = el.closest('li.nav-item') || el;
    contenedor.classList.add('d-none');
  });

  // Un título del menú (PEDIDOS, CAJA...) queda oculto si no le quedó ninguna opción.
  document.querySelectorAll('#menu-navegacion .nav-header').forEach((titulo) => {
    let hermano = titulo.nextElementSibling;
    let hayVisible = false;
    while (hermano && !hermano.classList.contains('nav-header')) {
      if (!hermano.classList.contains('d-none')) hayVisible = true;
      hermano = hermano.nextElementSibling;
    }
    titulo.classList.toggle('d-none', !hayVisible);
  });
}

// Saldos actuales de las cuentas, para mostrarlos en los desplegables de pago.
// Devuelve { idCuenta: saldo } o null si el rol no puede verlos (Empleado) o si falla.
// (La base ya entrega esta vista solo a Encargado y Dueño: acá solo evitamos el pedido inútil.)
export async function cargarSaldosCuentas() {
  if (!puedeAlMenos('ENCARGADO')) return null;
  try {
    const { data, error } = await supabaseClient.from('VW_SALDOS_CUENTAS').select('id, saldo_actual');
    if (error) throw error;
    const saldos = {};
    (data || []).forEach(c => { saldos[c.id] = Number(c.saldo_actual); });
    return saldos;
  } catch (err) {
    console.warn('No se pudieron cargar los saldos de las cuentas:', err);
    return null;
  }
}

// Agrega el rol al lado del nombre de usuario de la barra superior.
function mostrarRolEnBarra() {
  const spanUser = document.getElementById('nav-usuario-conectado');
  if (!spanUser || !rol) return;
  const etiqueta = document.createElement('span');
  etiqueta.className = 'small ml-1';
  etiqueta.style.opacity = '0.8';
  etiqueta.textContent = '· ' + NOMBRE[rol];
  spanUser.appendChild(etiqueta);
}

// Pantalla para quien inició sesión pero no tiene rol asignado.
function mostrarSinRol() {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;background:#111;' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.innerHTML = `
    <div class="card p-4 shadow text-center" style="width:100%;max-width:380px;border-top:4px solid #ffc107;">
      <h5 class="font-weight-bold mb-3">🍕 CRUDITAS 🥟</h5>
      <p class="mb-3">Tu usuario todavía no tiene un rol asignado.<br>
      Pedile al Dueño que te lo asigne y volvé a ingresar.</p>
      <button type="button" class="btn btn-warning btn-block font-weight-bold" id="btn-sin-rol-salir">Salir</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-sin-rol-salir').addEventListener('click', async () => {
    // Al cerrar sesión, auth.js recarga la página y vuelve a mostrar el login.
    await supabaseClient.auth.signOut();
    window.location.reload();
  });
}

// Consulta el rol y adapta la pantalla.
// Devuelve false si el usuario no tiene rol (main.js entonces no carga el POS).
export async function iniciarRoles() {
  try {
    const { data, error } = await supabaseClient.rpc('mi_rol');
    if (error) throw error;
    rol = RANGO[data] ? data : null;
    rolConocido = true;
  } catch (err) {
    console.warn('No se pudo consultar el rol (¿se corrió el script 32?). No se oculta nada.', err);
    rolConocido = false;
    return true;
  }

  if (!rol) {
    mostrarSinRol();
    return false;
  }

  aplicarRol();
  mostrarRolEnBarra();
  return true;
}
