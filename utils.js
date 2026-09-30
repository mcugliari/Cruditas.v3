export function mostrarNotificacion(mensaje, tipo = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 8px;';
    document.body.appendChild(container);
  }

  const colores = { success: '#28a745', danger: '#dc3545', warning: '#ffc107', info: '#17a2b8' };
  const colorFondo = colores[tipo] || colores.success;
  const colorTexto = tipo === 'warning' ? '#212529' : '#ffffff';

  const toast = document.createElement('div');
  toast.innerText = mensaje;
  toast.style.cssText = `
    background-color: ${colorFondo};
    color: ${colorTexto};
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: bold;
    font-size: 0.9rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.25s ease-in-out;
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}