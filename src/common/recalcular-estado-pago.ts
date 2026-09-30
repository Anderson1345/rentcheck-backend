import { Prisma } from '@prisma/client';
import {
  calcularEstadoCuenta,
  derivarEstadoPagoContrato,
  EstadoPagoContratoDerivado,
  PeriodoEstadoCuenta,
} from './estado-cuenta.util';
import { hoyEnBogota } from './hoy-bogota.util';

const SELECT_PARA_ESTADO_CUENTA = {
  fecha_inicio: true,
  fecha_fin: true,
  dia_pago: true,
  canon_centavos: true,
  estado_pago: true,
  incrementos_ipc: {
    select: {
      fecha_aplicacion: true,
      canon_anterior_centavos: true,
      canon_nuevo_centavos: true,
    },
  },
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
} as const satisfies Prisma.ContratoSelect;

/**
 * Única implementación del recálculo de `Contrato.estado_pago`: lee el
 * contrato con sus incrementos y pagos actuales, deriva el estado con
 * `calcularEstadoCuenta` + `derivarEstadoPagoContrato` y lo guarda solo si
 * cambió. Nunca se asigna a mano. Úsala dentro de la misma transacción que
 * cambia los pagos, el canon o la fecha de fin (o con el cliente normal en el
 * cron). Devuelve el estado derivado y los períodos calculados.
 */
export async function recalcularEstadoPagoContrato(
  tx: Prisma.TransactionClient,
  contratoId: string,
  hoy: Date = hoyEnBogota(),
): Promise<{
  estadoPago: EstadoPagoContratoDerivado;
  periodos: PeriodoEstadoCuenta[];
}> {
  const contrato = await tx.contrato.findUniqueOrThrow({
    where: { id: contratoId },
    select: SELECT_PARA_ESTADO_CUENTA,
  });

  const periodos = calcularEstadoCuenta(
    {
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin,
      dia_pago: contrato.dia_pago,
      canon_centavos: contrato.canon_centavos,
    },
    contrato.incrementos_ipc,
    contrato.pagos,
    hoy,
  );

  const estadoPago = derivarEstadoPagoContrato(periodos);

  if (estadoPago !== contrato.estado_pago) {
    await tx.contrato.update({
      where: { id: contratoId },
      data: { estado_pago: estadoPago },
    });
  }

  return { estadoPago, periodos };
}
