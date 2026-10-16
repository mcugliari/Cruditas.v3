// =============================================================================
// auth.js  ·  LOGIN DEL POS
// =============================================================================
//
// QUÉ HACE
//   Antes de mostrar el POS, comprueba si hay un usuario con la sesión iniciada.
//   Si no la hay, tapa la pantalla con un formulario de email y contraseña y
//   espera. Recién cuando el usuario ingresa bien, deja que el POS siga cargando.
//
// CÓMO SE USA (desde main.js)
//   import { asegurarSesion } from './auth.js';
//   await asegurarSesion();   // no avanza hasta que haya una sesión válida
//
// CON QUÉ SE CONECTA
//   - config.js:  de ahí sale supabaseClient, la "conexión" a Supabase.
//   - index.html: el botón "Salir" (id="btn-cerrar-sesion") y el contenedor
//                 principal de la página (clase "wrapper").
//
// Los usuarios no se crean en este archivo: se crean en el panel de Supabase
// (Authentication > Users).
//
// ORDEN DE LECTURA RECOMENDADO
//   Este archivo tiene 3 funciones. Leelas de abajo hacia arriba:
//   1) asegurarSesion  (la que se usa desde afuera, es el "director")
//   2) mostrarLogin    (dibuja el formulario y espera el ingreso)
//   3) prepararSalir   (deja andando el botón "Salir")
// =============================================================================


// IMPORT: trae algo que otro archivo "exportó" para poder usarlo acá.
// Las llaves { } indican el nombre exacto de lo que se importa.
// Acá traemos la conexión a Supabase que se creó en config.js.
import { supabaseClient } from './config.js';


// "let" declara una variable cuyo valor puede cambiar más adelante.
// (Con "const", en cambio, el valor no se puede reasignar.)
// Esta variable recuerda si ya dejamos configurado el botón "Salir".
// Está afuera de las funciones, así que "vive" mientras la página esté abierta.
let salirListo = false;


// -----------------------------------------------------------------------------
// prepararSalir
//   Deja funcionando el botón "Salir" y avisa a la app si la sesión se cierra.
//   Recibe: nada.   Devuelve: nada.
// -----------------------------------------------------------------------------
function prepararSalir() {
  // "Cláusula de guarda": si ya lo hicimos antes, salimos de inmediato con
  // "return". Sirve para no registrar los mismos eventos dos veces.
  if (salirListo) return;
  salirListo = true;

  // document.getElementById busca en la página el elemento con ese id.
  //
  // El "?." se llama "encadenamiento opcional": significa "si el elemento
  // existe, seguí; si no existe (null), no hagas nada y no tires error".
  //
  // addEventListener('click', función) dice: "cuando hagan clic en este
  // elemento, ejecutá esta función".
  //
  // "async () => { ... }" es una función flecha (una forma corta de escribir
  // una función). "async" indica que adentro va a esperar respuestas lentas
  // (como las de internet), y "await" significa "pausá acá hasta que llegue
  // la respuesta, y recién después seguí".
  document.getElementById('btn-cerrar-sesion')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
  });

  // Supabase nos avisa cada vez que cambia el estado de la sesión
  // (alguien ingresa, sale, la sesión vence, o se cierra en otra pestaña).
  // "evento" es un texto que dice qué pasó.
  // "===" compara que sean exactamente iguales.
  // window.location.reload() recarga la página; como ya no hay sesión,
  // asegurarSesion va a mostrar de nuevo el login.
  supabaseClient.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') window.location.reload();
  });
}


// -----------------------------------------------------------------------------
// mostrarLogin
//   Dibuja el formulario de ingreso y espera hasta que el usuario entre bien.
//   Recibe: nada.
//   Devuelve: una Promise que se "cumple" cuando el login fue exitoso.
// -----------------------------------------------------------------------------
function mostrarLogin() {
  // Una Promise (promesa) representa algo que va a terminar más adelante.
  // Acá la usamos para poder "esperar" el login con await desde afuera.
  // "resolve" es una función que llamamos cuando el login terminó bien:
  // eso cumple la promesa y hace que el "await mostrarLogin()" de
  // asegurarSesion continúe con la siguiente línea.
  return new Promise((resolve) => {

    // ---- 1. CREAR LA PANTALLA DE LOGIN ----
    // document.createElement crea un elemento HTML (un <div>) en memoria.
    // Todavía no se ve: falta agregarlo a la página.
    const overlay = document.createElement('div');
    overlay.id = 'overlay-login';

    // style.cssText escribe estilos CSS en una sola línea.
    // Estos hacen que el div ocupe TODA la pantalla (position:fixed con los
    // cuatro bordes en 0), quede por encima de todo (z-index alto) y centre
    // el formulario. El "+" une dos textos en uno solo.
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;background:#111;' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';

    // innerHTML pone HTML adentro del elemento.
    // Los acentos graves ` ` permiten escribir texto en varias líneas
    // ("plantilla de texto"). Con ${...} se podrían insertar variables,
    // pero acá es HTML fijo, sin datos de usuarios, por eso es seguro.
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

    // appendChild agrega el elemento a la página: recién ahora se ve.
    document.body.appendChild(overlay);

    // ---- 2. GUARDAR REFERENCIAS A LOS ELEMENTOS ----
    // querySelector busca un elemento usando un selector de CSS.
    // "#algo" significa "el elemento con id='algo'".
    // Buscamos dentro de "overlay" (no en toda la página) porque es donde
    // acabamos de crearlos. Guardamos cada uno en una constante para usarlo
    // después sin buscarlo de nuevo.
    const form = overlay.querySelector('#form-login');
    const inputEmail = overlay.querySelector('#login-email');
    const inputPass = overlay.querySelector('#login-password');
    const errorBox = overlay.querySelector('#login-error');
    const btn = overlay.querySelector('#login-btn');

    // focus() pone el cursor en el campo de email, listo para escribir.
    inputEmail.focus();

    // ---- 3. QUÉ PASA AL ENVIAR EL FORMULARIO ----
    // El evento "submit" ocurre al apretar el botón "Ingresar" o la tecla Enter.
    // "e" es un objeto con información del evento.
    form.addEventListener('submit', async (e) => {

      // Por defecto, enviar un formulario recarga la página. Con
      // preventDefault() lo evitamos para manejar el ingreso nosotros.
      e.preventDefault();

      // Desactivamos el botón para que no se pueda apretar dos veces seguidas.
      btn.disabled = true;

      // textContent escribe TEXTO PLANO (no interpreta HTML, por eso es más
      // seguro que innerHTML para mostrar mensajes). Acá borra el error anterior.
      errorBox.textContent = '';

      // try / catch: "intentá esto; si ocurre un error inesperado (por ejemplo,
      // se cortó internet), saltá al bloque catch en lugar de romper todo".
      try {

        // signInWithPassword pregunta a Supabase si el email y la contraseña
        // son correctos. Devuelve un objeto con dos partes: { data, error }.
        //
        // "const { error } = ..." se llama DESESTRUCTURACIÓN: de ese objeto
        // sacamos solo la parte "error" (si todo salió bien, vale null).
        //
        // .value es lo que el usuario escribió en el campo.
        // .trim() borra los espacios sobrantes al principio y al final.
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: inputEmail.value.trim(),
          password: inputPass.value
        });

        // Si hubo error (datos incorrectos), avisamos, reactivamos el botón
        // y salimos con "return": el formulario queda en pantalla para reintentar.
        // No decimos si falló el email o la contraseña (a propósito): así no
        // se le da pistas a quien intente adivinar usuarios.
        if (error) {
          errorBox.textContent = 'Email o contraseña incorrectos.';
          btn.disabled = false;
          return;
        }

        // Ingreso correcto: sacamos la pantalla de login...
        overlay.remove();

        // ...y cumplimos la promesa. Esto "despierta" al await que está
        // esperando en asegurarSesion.
        // Pasamos la sesión recién creada a quien esté esperando (asegurarSesion),
        // así puede mostrar el usuario sin volver a consultarla.
        resolve(data?.session || null);

      } catch (err) {
        // Error inesperado (sin conexión, por ejemplo).
        // console.error escribe en la consola del navegador (tecla F12):
        // ahí se ve el detalle técnico, útil para detectar problemas.
        console.error('Error de login:', err);
        errorBox.textContent = 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.';
        btn.disabled = false;
      }
    });
  });
}


// -----------------------------------------------------------------------------
// asegurarSesion   (esta es la única función que usa el resto de la app)
//   Se asegura de que haya un usuario con sesión; si no, muestra el login.
//   Recibe: nada.
//   Devuelve: una Promise que se cumple cuando ya hay sesión.
//
// "export" la hace disponible para otros archivos: por eso main.js puede
// escribir "import { asegurarSesion } from './auth.js'".
// Las otras dos funciones no tienen "export": son internas de este archivo.
// -----------------------------------------------------------------------------
export async function asegurarSesion() {

  // querySelector con un punto busca por CLASE: ".wrapper" es el contenedor
  // principal del POS en index.html (el menú, las pantallas, todo).
  const wrapper = document.querySelector('.wrapper');

  // Empezamos suponiendo que no hay sesión (null significa "nada").
  let session = null;

  try {
    // getSession() lee la sesión guardada en el navegador (si el usuario ya
    // había ingresado antes y no venció).
    const resultado = await supabaseClient.auth.getSession();

    // resultado.data?.session: igual que antes, "?." evita el error si "data"
    // no existiera. El "||" significa "o": si lo de la izquierda no existe,
    // usá lo de la derecha (null). Así "session" queda con la sesión o con null.
    session = resultado.data?.session || null;
  } catch (err) {
    console.error('No se pudo leer la sesión:', err);
  }

  // "!session" se lee "no hay sesión".
  if (!session) {
    // Escondemos el POS mientras se muestra el login, para que no se vea
    // por detrás ni un instante (visibility = 'hidden' lo oculta pero
    // mantiene su lugar en la página).
    if (wrapper) wrapper.style.visibility = 'hidden';

    // Mostramos el login y ESPERAMOS (await) hasta que el usuario ingrese bien.
    // Mientras tanto, el resto de main.js queda pausado: por eso el POS no
    // carga ningún dato antes de tiempo.
    // Guardamos lo que devuelve el login: antes, "session" seguía en null
    // después de ingresar y por eso no se mostraba el usuario.
    session = await mostrarLogin();

    // Ya hay sesión: volvemos a mostrar el POS. Una cadena vacía '' le dice
    // al navegador "volvé al valor normal".
    if (wrapper) wrapper.style.visibility = '';
  }

  // Dejamos listo el botón "Salir" y el aviso de sesión cerrada.
  prepararSalir();

  // NUEVO: Mostrar el usuario (email) en la barra superior
  // Mostrar el usuario (la parte del email antes de la @) en la barra superior.
  const userEmail = session?.user?.email;
  if (userEmail) {
    const spanUser = document.getElementById('nav-usuario-conectado');
    if (spanUser) {
      // Ponemos el ícono con innerHTML (es HTML fijo, nuestro)...
      spanUser.innerHTML = '<i class="far fa-user mr-1"></i> ';
      // ...y el nombre como "nodo de texto": el navegador lo muestra siempre
      // como texto, sin interpretarlo como HTML. Así no hace falta escaparlo.
      spanUser.appendChild(document.createTextNode(userEmail.split('@')[0]));
    }
  }
  
}
