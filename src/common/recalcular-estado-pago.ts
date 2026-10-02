import { Prisma } from '@prisma/client';
import {
  calcularEstadoCuenta,
  derivarEstadoPagoContrato,
  EstadoPagoContratoDerivado,
  PeriodoEstadoCuenta,
} from './estado-cuenta.util';
import { hoyEnBogota } from './hoy-bogota.util';
import { fechaFinParaEstadoCuenta } from './terminacion.util';

export const SELECT_PARA_ESTADO_CUENTA = {
  estado: true,
  terminacionAnticipadaConfirmadaEn: true,
  terminacion_fecha_efectiva: true,
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

type ContratoParaEstadoCuenta = Prisma.ContratoGetPayload<{
  select: typeof SELECT_PARA_ESTADO_CUENTA;
}>;

/**
 * Períodos de un contrato con `calcularEstadoCuenta` y la fecha_fin efectiva de la terminación
 * (`fechaFinParaEstadoCuenta`): todo llamador del cálculo debe pasar por aquí o replicar eso.
 */
export function periodosDelContrato(
  contrato: ContratoParaEstadoCuenta,
  hoy: Date = hoyEnBogota(),
): PeriodoEstadoCuenta[] {
  return calcularEstadoCuenta(
    {
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: fechaFinParaEstadoCuenta(contrato),
      dia_pago: contrato.dia_pago,
      canon_centavos: contrato.canon_centavos,
    },
    contrato.incrementos_ipc,
    contrato.pagos,
    hoy,
  );
}

/**
 * Los períodos de VARIOS contratos con una sola lectura (no una por contrato ni por pago): la
 * consulta de contratos, y la de sus incrementos y la de sus pagos (en lote). Los contratos que no
 * existan simplemente no aparecen en el mapa.
 */
export async function periodosPorContrato(
  cliente: Prisma.TransactionClient,
  contratoIds: string[],
  hoy: Date = hoyEnBogota(),
): Promise<Map<string, PeriodoEstadoCuenta[]>> {
  const mapa = new Map<string, PeriodoEstadoCuenta[]>();
  if (contratoIds.length === 0) {
    return mapa;
  }
  const contratos = await cliente.contrato.findMany({
    where: { id: { in: contratoIds } },
    select: { id: true, ...SELECT_PARA_ESTADO_CUENTA },
  });
  for (const contrato of contratos) {
    mapa.set(contrato.id, periodosDelContrato(contrato, hoy));
  }
  return mapa;
}

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

  const periodos = periodosDelContrato(contrato, hoy);

  const estadoPago = derivarEstadoPagoContrato(periodos);

  if (estadoPago !== contrato.estado_pago) {
    await tx.contrato.update({
      where: { id: contratoId },
      data: { estado_pago: estadoPago },
    });
  }

  return { estadoPago, periodos };
}
