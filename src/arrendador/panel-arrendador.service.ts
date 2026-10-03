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
      inmuebles,
      unidades,
      comprobantesPendientes,
      solicitudes,
      ipc,
    ] = await Promise.all([
      // Todos los contratos con sus incrementos y sus pagos PENDIENTE y APROBADO (los únicos que
      // cuentan para períodos e ingresos): una lectura por tabla, no una por contrato.
      this.prisma.contrato.findMany({
        where: { arrendador_id: arrendadorId },
        select: {
          id: true,
          unidad_id: true,
          inquilino_nombre: true,
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
            select: {
              nombre: true,
              inmueble: { select: { id: true, direccion: true } },
            },
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
      // B0.7-B: todos los inmuebles (también sin unidades) y todas las unidades, para el bloque por
      // inmueble y el estado de cada unidad. La dirección de la unidad se toma del inmueble ya leído.
      this.prisma.inmueble.findMany({
        where: { arrendador_id: arrendadorId },
        select: { id: true, direccion: true },
      }),
      this.prisma.unidad.findMany({
        where: { inmueble: { arrendador_id: arrendadorId } },
        select: { id: true, nombre: true, inmueble_id: true },
      }),
      this.prisma.pago.count({
        where: { arrendador_id: arrendadorId, estado: EstadoPago.PENDIENTE },
      }),
      // Solicitudes abiertas contadas por estado y urgencia en una sola consulta (de aquí salen también
      // los mantenimientos PENDIENTE de siempre).
      this.prisma.solicitudMantenimiento.groupBy({
        by: ['estado', 'urgencia'],
        where: {
          arrendador_id: arrendadorId,
          estado: {
            in: [
              EstadoSolicitudMantenimiento.PENDIENTE,
              EstadoSolicitudMantenimiento.EN_PROCESO,
            ],
          },
        },
        _count: { _all: true },
      }),
      // El IPC es global (no es del arrendador): solo se pregunta si existe el que usaría un incremento.
      this.prisma.configuracionIpc.findUnique({
        where: { anio: anioIpcParaIncremento(hoy) },
        select: { id: true },
      }),
    ]);

    const direccionDe = new Map(inmuebles.map((i) => [i.id, i.direccion]));
    const paraElPanel: ContratoParaPanel[] = contratos.map((c) => ({
      id: c.id,
      unidad_id: c.unidad_id,
      unidad: c.unidad.nombre,
      inmueble_id: c.unidad.inmueble.id,
      inmueble: c.unidad.inmueble.direccion,
      inquilino_nombre: c.inquilino_nombre,
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
        inmuebles,
        unidades: unidades.map((u) => ({
          id: u.id,
          nombre: u.nombre,
          inmueble_id: u.inmueble_id,
          inmueble_direccion: direccionDe.get(u.inmueble_id) ?? '',
        })),
        comprobantes_pendientes: comprobantesPendientes,
        solicitudes: solicitudes.map((s) => ({
          estado: s.estado,
          urgencia: s.urgencia,
          cantidad: s._count._all,
        })),
        ipc_configurado: ipc !== null,
      },
      hoy,
    );
  }
}
