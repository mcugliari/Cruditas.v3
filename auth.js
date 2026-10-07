import { supabaseClient } from './config.js';

// Login del POS con Supabase Auth (email + contraseña).
// Los usuarios se crean en el panel de Supabase: Authentication > Users.
// Uso: await asegurarSesion();  -> no retorna hasta que haya una sesión válida.

let salirListo = false;

function prepararSalir() {
  if (salirListo) return;
  salirListo = true;

  document.getElementById('btn-cerrar-sesion')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  });

  // Si la sesión se cierra (botón, otra pestaña o sesión vencida), vuelve al login
  supabaseClient.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') window.location.reload();
  });
}

function mostrarLogin() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'overlay-login';
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;background:#111;' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `
      <form id="form-login" class="card p-4 shadow" style="width:100%;max-width:360px;border-top:4px solid #ffc107;">
        <h5 class="text-center font-weight-bold mb-3">🍕 CRUDITAS 🥟</h5>
        <div class="form-group">
          <label class="small font-weight-bold" for="login-email">Email</label>
          <input id="login-email" type="email" class="form-control" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label class="small font-weight-bold" for="login-password">Contraseña</label>
          <input id="login-password" type="password" class="form-control" autocomplete="current-password" required>
        </div>
        <div id="login-error" class="text-danger small mb-2" style="min-height:1.2em;"></div>
        <button id="login-btn" type="submit" class="btn btn-warning btn-block font-weight-bold">Ingresar</button>
      </form>`;
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#form-login');
    const inputEmail = overlay.querySelector('#login-email');
    const inputPass = overlay.querySelector('#login-password');
    const errorBox = overlay.querySelector('#login-error');
    const btn = overlay.querySelector('#login-btn');
    inputEmail.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      errorBox.textContent = '';

      try {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: inputEmail.value.trim(),
          password: inputPass.value
        });

        if (error) {
          errorBox.textContent = 'Email o contraseña incorrectos.';
          btn.disabled = false;
          return;
        }

        overlay.remove();
        resolve();
      } catch (err) {
        console.error('Error de login:', err);
        errorBox.textContent = 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.';
        btn.disabled = false;
      }
    });
  });
}

export async function asegurarSesion() {
  const wrapper = document.querySelector('.wrapper');

  let session = null;
  try {
    const resultado = await supabaseClient.auth.getSession();
    session = resultado.data?.session || null;
  } catch (err) {
    console.error('No se pudo leer la sesión:', err);
  }

  if (!session) {
    if (wrapper) wrapper.style.visibility = 'hidden';
    await mostrarLogin();
    if (wrapper) wrapper.style.visibility = '';
  }

  prepararSalir();
}
