import { Injectable } from '@nestjs/common';
import { EstadoPago, EstadoSolicitudMantenimiento } from '@prisma/client';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { anioIpcParaIncremento } from '../common/incremento-disponible.util';
import {
  construirPanel,
  ContratoParaPanel,
  PanelArrendador,
} from '../common/panel-arrendador.util';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Panel del arrendador (B-58): solo lee, por lote, y deja toda la regla a `construirPanel` (función
 * pura). Un número constante de consultas, sin importar cuántos contratos o pagos tenga el
 * arrendador, y todas filtradas por el `arrendador_id` del token. Nunca escribe (no recalcula ni
 * guarda `estado_pago`).
 */
@Injectable()
export class PanelArrendadorService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(arrendadorId: string): Promise<PanelArrendador> {
    const hoy = hoyEnBogota();

    const [
      contratos,
      unidadesTotal,
      comprobantesPendientes,
      mantenimientosPendientes,
      ipc,
    ] = await Promise.all([
      // Todos los contratos con sus incrementos y sus pagos PENDIENTE y APROBADO (los únicos que
      // cuentan para períodos e ingresos): una lectura por tabla, no una por contrato.
      this.prisma.contrato.findMany({
        where: { arrendador_id: arrendadorId },
        select: {
          id: true,
          unidad_id: true,
          estado: true,
          fecha_inicio: true,
          fecha_fin: true,
          dia_pago: true,
          canon_centavos: true,
          terminacionAnticipadaSolicitada: true,
          terminacionAnticipadaSolicitadaPor: true,
          terminacionAnticipadaSolicitadaEn: true,
          terminacionAnticipadaMotivo: true,
          terminacionAnticipadaConfirmadaEn: true,
          terminacion_fecha_efectiva: true,
          terminacion_confirmada_por: true,
          unidad: {
            select: { nombre: true, inmueble: { select: { direccion: true } } },
          },
          incrementos_ipc: {
            select: {
              fecha_aplicacion: true,
              canon_anterior_centavos: true,
              canon_nuevo_centavos: true,
            },
          },
          pagos: {
            where: {
              estado: { in: [EstadoPago.PENDIENTE, EstadoPago.APROBADO] },
            },
            select: {
              periodo: true,
              estado: true,
              monto_centavos: true,
              fecha_reportada: true,
            },
          },
        },
      }),
      this.prisma.unidad.count({
        where: { inmueble: { arrendador_id: arrendadorId } },
      }),
      this.prisma.pago.count({
        where: { arrendador_id: arrendadorId, estado: EstadoPago.PENDIENTE },
      }),
      this.prisma.solicitudMantenimiento.count({
        where: {
          arrendador_id: arrendadorId,
          estado: EstadoSolicitudMantenimiento.PENDIENTE,
        },
      }),
      // El IPC es global (no es del arrendador): solo se pregunta si existe el que usaría un incremento.
      this.prisma.configuracionIpc.findUnique({
        where: { anio: anioIpcParaIncremento(hoy) },
        select: { id: true },
      }),
    ]);

    const paraElPanel: ContratoParaPanel[] = contratos.map((c) => ({
      id: c.id,
      unidad_id: c.unidad_id,
      unidad: c.unidad.nombre,
      inmueble: c.unidad.inmueble.direccion,
      estado: c.estado,
      fecha_inicio: c.fecha_inicio,
      fecha_fin: c.fecha_fin,
      dia_pago: c.dia_pago,
      canon_centavos: c.canon_centavos,
      terminacionAnticipadaSolicitada: c.terminacionAnticipadaSolicitada,
      terminacionAnticipadaSolicitadaPor: c.terminacionAnticipadaSolicitadaPor,
      terminacionAnticipadaSolicitadaEn: c.terminacionAnticipadaSolicitadaEn,
      terminacionAnticipadaMotivo: c.terminacionAnticipadaMotivo,
      terminacionAnticipadaConfirmadaEn: c.terminacionAnticipadaConfirmadaEn,
      terminacion_fecha_efectiva: c.terminacion_fecha_efectiva,
      terminacion_confirmada_por: c.terminacion_confirmada_por,
      incrementos_ipc: c.incrementos_ipc,
      pagos: c.pagos,
    }));

    return construirPanel(
      {
        contratos: paraElPanel,
        unidades_total: unidadesTotal,
        comprobantes_pendientes: comprobantesPendientes,
        mantenimientos_pendientes: mantenimientosPendientes,
        ipc_configurado: ipc !== null,
      },
      hoy,
    );
  }
}
