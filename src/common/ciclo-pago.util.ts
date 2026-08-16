export function calcularCicloPagoActual(
  diaPago: number,
  fechaReferencia: Date = new Date(),
): Date {
  const anio = fechaReferencia.getFullYear();
  const mesActual = fechaReferencia.getMonth();
  const diaHoy = fechaReferencia.getDate();

  const ultimoDiaDelMes = (anioObjetivo: number, mesObjetivo: number) =>
    new Date(anioObjetivo, mesObjetivo + 1, 0).getDate();

  const mesPago = diaHoy >= diaPago ? mesActual : mesActual - 1;
  const anioPago = anio + Math.floor(mesPago / 12);
  const mesNormalizado = ((mesPago % 12) + 12) % 12;

  const ultimoDia = ultimoDiaDelMes(anioPago, mesNormalizado);
  const diaAjustado = Math.min(diaPago, ultimoDia);

  return new Date(anioPago, mesNormalizado, diaAjustado);
}
