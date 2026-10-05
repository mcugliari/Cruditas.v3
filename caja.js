import { supabaseClient } from './config.js';

// -----------------------------------------------------------------------------
// 1. Cargar el resumen de ventas del día agrupado por Medio de Pago
// -----------------------------------------------------------------------------
export async function cargarResumenVentasDia() {
  const contenedor = document.getElementById('contenedor-resumen-cierre');
  if (!contenedor) return;

  contenedor.innerHTML = `
    <div class="text-center py-3">
      <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
      Cargando totales del día...
    </div>
  `;

  // Fecha actual en formato YYYY-MM-DD
  const hoy = new Date().toISOString().split('T')[0];

  try {
    const { data: pedidos, error } = await supabaseClient
      .from('TB_TPEDIDOS')
      .select('importe_total, TB_BMEDIO_PAGO(nombre)')
      .eq('fecha', hoy)
      .neq('estado', 'CANCELADO');

    if (error) throw error;

    if (!pedidos || pedidos.length === 0) {
      contenedor.innerHTML = `
        <div class="alert alert-warning text-center mb-0">
          No hay ventas registradas en la fecha de hoy (${hoy}).
        </div>
      `;
      return;
    }

    // Agrupar totales por medio de pago
    const totalesPorMedio = {};
    let totalGeneral = 0;

    pedidos.forEach(p => {
      const medio = p.TB_BMEDIO_PAGO?.nombre || 'Efectivo';
      const monto = Number(p.importe_total || 0);

      totalesPorMedio[medio] = (totalesPorMedio[medio] || 0) + monto;
      totalGeneral += monto;
    });

    // Renderizar desglose
    let html = '<div class="list-group mb-2">';
    Object.entries(totalesPorMedio).forEach(([medio, total]) => {
      html += `
        <div class="list-group-item d-flex justify-content-between align-items-center py-2">
          <span><strong>${medio}</strong></span>
          <span class="font-weight-bold text-dark">$${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
        </div>
      `;
    });

    html += `
        <div class="list-group-item d-flex justify-content-between align-items-center bg-light py-2">
          <span class="h6 mb-0 text-uppercase">TOTAL GENERAL:</span>
          <span class="h6 mb-0 text-success font-weight-bold">$${totalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    `;

    contenedor.innerHTML = html;

  } catch (err) {
    console.error('Error al obtener resumen de caja:', err);
    contenedor.innerHTML = `
      <div class="alert alert-danger mb-0">
        Error al obtener los datos de ventas.
      </div>
    `;
  }
}

// -----------------------------------------------------------------------------
// 2. Eventos del Modal y Guardado del Cierre
// -----------------------------------------------------------------------------
export function inicializarCierreCaja() {
  // Al abrir el modal, cargamos automáticamente los datos frescos
  $('#modalCierreCaja').on('show.bs.modal', function () {
    cargarResumenVentasDia();
  });

  const btnConfirmar = document.getElementById('btn-confirmar-cierre');
  if (btnConfirmar) {
    btnConfirmar.addEventListener('click', async () => {
      const obs = document.getElementById('cierre-observaciones')?.value || '';
      const hoy = new Date().toISOString().split('T')[0];

      if (!confirm('¿Estás seguro de efectuar el Cierre de Caja del día de hoy?')) {
        return;
      }

      btnConfirmar.disabled = true;
      btnConfirmar.innerText = 'Guardando cierre...';

      try {
        // Ejemplo de inserción en tabla de cierres (si la tenés) o log de estado
        const { error } = await supabaseClient
          .from('TB_TCIERRE_CAJA')
          .insert([{
            fecha: hoy,
            observaciones: obs,
            created_at: new Date().toISOString()
          }]);

        if (error) throw error;

        alert('¡Cierre de caja realizado con éxito!');
        $('#modalCierreCaja').modal('hide');

      } catch (err) {
        console.error('Error al guardar cierre de caja:', err);
        alert('Error al registrar el cierre de caja.');
      } finally {
        btnConfirmar.disabled = false;
        btnConfirmar.innerText = 'CONFIRMAR Y CERRAR CAJA';
      }
    });
  }
}