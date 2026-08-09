export function calcularFechaPagoAnterior(diaPago: number, hoy: Date): Date {
  const anio = hoy.getFullYear();
  const mesActual = hoy.getMonth();
  const diaHoy = hoy.getDate();

  const ultimoDiaDelMes = (anioObjetivo: number, mesObjetivo: number) =>
    new Date(anioObjetivo, mesObjetivo + 1, 0).getDate();

  const mesPago = diaHoy >= diaPago ? mesActual : mesActual - 1;
  const anioPago = anio + Math.floor(mesPago / 12);
  const mesNormalizado = ((mesPago % 12) + 12) % 12;

  const ultimoDia = ultimoDiaDelMes(anioPago, mesNormalizado);
  const diaAjustado = Math.min(diaPago, ultimoDia);

  return new Date(anioPago, mesNormalizado, diaAjustado);
}

export function calcularProximaFechaPago(diaPago: number, hoy: Date): Date {
  const anio = hoy.getFullYear();
  const mesActual = hoy.getMonth();
  const diaHoy = hoy.getDate();

  const ultimoDiaDelMes = (anioObjetivo: number, mesObjetivo: number) =>
    new Date(anioObjetivo, mesObjetivo + 1, 0).getDate();

  const mesPago = diaHoy > diaPago ? mesActual + 1 : mesActual;
  const anioPago = anio + Math.floor(mesPago / 12);
  const mesNormalizado = ((mesPago % 12) + 12) % 12;

  const ultimoDia = ultimoDiaDelMes(anioPago, mesNormalizado);
  const diaAjustado = Math.min(diaPago, ultimoDia);

  return new Date(anioPago, mesNormalizado, diaAjustado);
}
