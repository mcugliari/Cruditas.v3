// =============================================================================
// RELOJ DE LA BARRA SUPERIOR  ->  "Lun 2 Nov 2026  |  14:32"
// Siempre en hora de Argentina (Buenos Aires), aunque el equipo tenga mal la zona horaria.
// Se actualiza solo; no consulta nada a la base ni depende de la sesión.
// =============================================================================
const ZONA = 'America/Argentina/Buenos_Aires';
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const formateador = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function leerAhora() {
  const p = {};
  formateador.formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  const anio = Number(p.year), mes = Number(p.month), dia = Number(p.day);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return {
    fecha: `${DIAS[diaSemana]} ${dia} ${MESES[mes - 1]} ${anio}`,
    hora: `${p.hour.padStart(2, '0')}:${p.minute.padStart(2, '0')}`
  };
}

function pintarReloj() {
  const elFecha = document.getElementById('nav-fecha');
  const elHora = document.getElementById('nav-hora');
  if (!elFecha || !elHora) return;
  const { fecha, hora } = leerAhora();
  if (elFecha.textContent !== fecha) elFecha.textContent = fecha;
  if (elHora.textContent !== hora) elHora.textContent = hora;
}

let temporizadorReloj = null;
export function iniciarReloj() {
  pintarReloj();
  clearInterval(temporizadorReloj);
  temporizadorReloj = setInterval(pintarReloj, 5000);   // alcanza para que el minuto cambie a tiempo
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pintarReloj(); });
}
