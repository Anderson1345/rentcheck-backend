import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { firmarTolerante } from '../common/firma-tolerante';
import {
  EstadoContrato,
  Momento,
  Prisma,
  RolSolicitante,
} from '@prisma/client';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { contratoVinculadoDelInquilino } from '../common/contrato-vinculado-inquilino';
import {
  calcularEstadoCuenta,
  construirRespuestaEstadoCuenta,
  PeriodoEstadoCuenta,
} from '../common/estado-cuenta.util';
import { diasEntreUTC } from '../common/fechas-contrato.util';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { resolverIdContratoDelInquilino } from '../common/resolver-contrato-inquilino';
import {
  fechaFinParaEstadoCuenta,
  resumenTerminacion,
} from '../common/terminacion.util';
import { resumenAvisoNoRenovacion } from '../common/aviso-no-renovacion.util';
import { AvisoNoRenovacionService } from '../contrato/aviso-no-renovacion.service';
import { DocumentoContratoService } from '../contrato/documento-contrato.service';
import { TerminacionAnticipadaService } from '../contrato/terminacion-anticipada.service';
import { VinculacionContratoService } from '../contrato/vinculacion-contrato.service';
import { PrismaService } from '../prisma/prisma.service';

const SELECT_CONTRATO_PORTAL = {
  id: true,
  estado: true,
  canon_centavos: true,
  dia_pago: true,
  forma_pago: true,
  deposito_centavos: true,
  datos_recaudo: true,
  fecha_inicio: true,
  fecha_fin: true,
  pdf_contrato_ruta: true,
  terminacionAnticipadaSolicitada: true,
  terminacionAnticipadaSolicitadaPor: true,
  terminacionAnticipadaSolicitadaEn: true,
  terminacionAnticipadaMotivo: true,
  terminacionAnticipadaConfirmadaEn: true,
  terminacion_fecha_efectiva: true,
  terminacion_confirmada_por: true,
  incrementos_ipc: { orderBy: { fecha_aplicacion: 'asc' } },
  fotos_inventario: true,
  aviso_no_renovacion: true,
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
} as const satisfies Prisma.ContratoSelect;

const SELECT_CONTRATO_LISTA = {
  id: true,
  estado: true,
  canon_centavos: true,
  dia_pago: true,
  fecha_inicio: true,
  fecha_fin: true,
  creado_en: true,
  terminacionAnticipadaConfirmadaEn: true,
  terminacion_fecha_efectiva: true,
  incrementos_ipc: { orderBy: { fecha_aplicacion: 'asc' } },
  pagos: { select: { periodo: true, estado: true, monto_centavos: true } },
  unidad: {
    select: {
      nombre: true,
      tipo: true,
      inmueble: { select: { direccion: true, ciudad: true } },
    },
  },
} as const satisfies Prisma.ContratoSelect;

type EstadoPagoPortal = 'al_dia' | 'en_mora' | 'pendiente';

export interface PanelContratoActivo {
  contrato_id: string;
  estado: EstadoContrato;
  fecha_fin: Date;
  dias_restantes: number;
  canon_vigente_centavos: number;
  estado_pago: EstadoPagoPortal;
  proximo_periodo: {
    periodo: Date;
    fecha_limite: Date;
    monto_centavos: number;
    estado: PeriodoEstadoCuenta['estado'];
  } | null;
  periodos_vencidos: { cantidad: number; total_pendiente_centavos: number };
}

export type PanelContrato =
  | PanelContratoActivo
  | {
      contratoFinalizado: false;
      programado: true;
      estado: EstadoContrato;
      fecha_inicio: Date;
      fecha_fin: Date;
    }
  | { contratoFinalizado: true; estado: EstadoContrato };

const RANGO_ESTADO_LISTA: Partial<Record<EstadoContrato, number>> = {
  [EstadoContrato.ACTIVO]: 0,
  [EstadoContrato.PROGRAMADO]: 1,
};

@Injectable()
export class InquilinoPanelService {
  private readonly logger = new Logger(InquilinoPanelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly terminacion: TerminacionAnticipadaService,
    private readonly aviso: AvisoNoRenovacionService,
    private readonly vinculacion: VinculacionContratoService,
    private readonly documentos: DocumentoContratoService,
  ) {}

  // ------------------------------------------------------------------
  // Rutas por id de contrato
  // ------------------------------------------------------------------

  /**
   * Contratos vinculados y no cancelados del inquilino: primero el ACTIVO,
   * luego los PROGRAMADOS por fecha de inicio y al final el resto, del más
   * reciente al más antiguo.
   */
  async listarContratos(inquilinoId: string) {
    const contratos = await this.prisma.contrato.findMany({
      where: {
        inquilino_id: inquilinoId,
        vinculado_en: { not: null },
        estado: { not: EstadoContrato.CANCELADO },
      },
      select: SELECT_CONTRATO_LISTA,
    });
    const hoy = hoyEnBogota();

    const ordenados = [...contratos].sort((a, b) => {
      const rangoA = RANGO_ESTADO_LISTA[a.estado] ?? 2;
      const rangoB = RANGO_ESTADO_LISTA[b.estado] ?? 2;
      if (rangoA !== rangoB) {
        return rangoA - rangoB;
      }
      if (a.estado === EstadoContrato.PROGRAMADO) {
        return a.fecha_inicio.getTime() - b.fecha_inicio.getTime();
      }
      return b.creado_en.getTime() - a.creado_en.getTime();
    });

    return ordenados.map((contrato) => ({
      id: contrato.id,
      estado: contrato.estado,
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin,
      unidad: { nombre: contrato.unidad.nombre, tipo: contrato.unidad.tipo },
      inmueble: {
        direccion: contrato.unidad.inmueble.direccion,
        ciudad: contrato.unidad.inmueble.ciudad,
      },
      estado_pago:
        contrato.estado === EstadoContrato.ACTIVO
          ? construirRespuestaEstadoCuenta(
              this.periodosDe(contrato as ContratoConCuenta, hoy),
            ).estadoPago
          : null,
    }));
  }

  async obtenerPanel(
    inquilinoId: string,
    contratoId: string,
  ): Promise<PanelContrato> {
    const contrato = await contratoVinculadoDelInquilino(
      this.prisma,
      inquilinoId,
      contratoId,
      SELECT_CONTRATO_PORTAL,
    );

    // Un contrato PROGRAMADO aún no empieza: no está finalizado ni muestra
    // datos de recaudo.
    if (contrato.estado === EstadoContrato.PROGRAMADO) {
      return {
        contratoFinalizado: false,
        programado: true,
        estado: contrato.estado,
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: contrato.fecha_fin,
      };
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      return { contratoFinalizado: true, estado: contrato.estado };
    }

    const hoy = hoyEnBogota();
    const periodos = this.periodosDe(contrato, hoy);
    const enMora = periodos.filter(
      (p) => p.estado === 'VENCIDO' || p.estado === 'PARCIAL',
    );
    const proximo = periodos.find((p) => p.estado !== 'PAGADO');

    return {
      contrato_id: contrato.id,
      estado: contrato.estado,
      fecha_fin: contrato.fecha_fin,
      dias_restantes: Math.max(0, diasEntreUTC(hoy, contrato.fecha_fin)),
      canon_vigente_centavos: contrato.canon_centavos,
      estado_pago: construirRespuestaEstadoCuenta(periodos).estadoPago,
      proximo_periodo: proximo
        ? {
            periodo: proximo.periodo,
            fecha_limite: proximo.fecha_limite,
            monto_centavos: proximo.canon_vigente_centavos,
            estado: proximo.estado,
          }
        : null,
      periodos_vencidos: {
        cantidad: enMora.length,
        total_pendiente_centavos: enMora.reduce(
          (suma, p) =>
            suma +
            Math.max(0, p.canon_vigente_centavos - p.monto_aprobado_centavos),
          0,
        ),
      },
    };
  }

  async obtenerContrato(inquilinoId: string, contratoId: string) {
    const contrato = await contratoVinculadoDelInquilino(
      this.prisma,
      inquilinoId,
      contratoId,
      SELECT_CONTRATO_PORTAL,
    );

    const fotosEntrega = contrato.fotos_inventario.filter(
      (f) => f.momento === Momento.ENTREGA,
    );
    const fotosDevolucion = contrato.fotos_inventario.filter(
      (f) => f.momento === Momento.DEVOLUCION,
    );

    return {
      contratoId: contrato.id,
      estado: contrato.estado,
      programado: contrato.estado === EstadoContrato.PROGRAMADO,
      canon_centavos: contrato.canon_centavos,
      dia_pago: contrato.dia_pago,
      forma_pago: contrato.forma_pago,
      deposito_centavos: contrato.deposito_centavos,
      datos_recaudo:
        contrato.estado === EstadoContrato.ACTIVO
          ? contrato.datos_recaudo
          : null,
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin,
      // OBSOLETO: usar `documentos` (CONTRATO_ORIGINAL v1 + otrosíes).
      pdf_contrato_url: await firmarTolerante(
        this.almacenamiento,
        contrato.pdf_contrato_ruta,
        this.logger,
        `el PDF heredado del contrato ${contrato.id}`,
      ),
      documentos: await this.documentos.listarDeContrato(contrato.id),
      incrementos_ipc: contrato.incrementos_ipc,
      terminacion_anticipada: resumenTerminacion(
        contrato,
        RolSolicitante.INQUILINO,
      ),
      aviso_no_renovacion: resumenAvisoNoRenovacion(
        contrato.aviso_no_renovacion,
        contrato,
        RolSolicitante.INQUILINO,
      ),
      fotos_entrega: await Promise.all(
        fotosEntrega.map((f) => this.exponerUrlFirmada(f)),
      ),
      fotos_devolucion: await Promise.all(
        fotosDevolucion.map((f) => this.exponerUrlFirmada(f)),
      ),
    };
  }

  async obtenerEstadoCuenta(inquilinoId: string, contratoId: string) {
    const contrato = await contratoVinculadoDelInquilino(
      this.prisma,
      inquilinoId,
      contratoId,
      SELECT_CONTRATO_PORTAL,
    );
    return construirRespuestaEstadoCuenta(
      this.periodosDe(contrato, hoyEnBogota()),
    );
  }

  async listarDocumentos(inquilinoId: string, contratoId: string) {
    await contratoVinculadoDelInquilino(this.prisma, inquilinoId, contratoId, {
      id: true,
    });
    return this.documentos.listarDeContrato(contratoId);
  }

  async solicitarTerminacionAnticipada(
    inquilinoId: string,
    contratoId: string,
    motivo: string,
    fechaEfectiva: Date,
  ) {
    await this.exigirContrato(inquilinoId, contratoId);
    return this.terminacion.solicitar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
      motivo,
      fechaEfectiva,
    );
  }

  async confirmarTerminacionAnticipada(
    inquilinoId: string,
    contratoId: string,
  ) {
    await this.exigirContrato(inquilinoId, contratoId);
    return this.terminacion.confirmar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  async cancelarTerminacionAnticipada(inquilinoId: string, contratoId: string) {
    await this.exigirContrato(inquilinoId, contratoId);
    return this.terminacion.cancelar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  async darAvisoNoRenovacion(
    inquilinoId: string,
    contratoId: string,
    motivo?: string,
  ) {
    await this.exigirContrato(inquilinoId, contratoId);
    return this.aviso.dar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
      motivo,
    );
  }

  async cancelarAvisoNoRenovacion(inquilinoId: string, contratoId: string) {
    await this.exigirContrato(inquilinoId, contratoId);
    return this.aviso.cancelar(
      contratoId,
      { inquilino_id: inquilinoId },
      RolSolicitante.INQUILINO,
    );
  }

  vincularContrato(inquilinoId: string, codigo: string) {
    return this.vinculacion.vincular(inquilinoId, codigo);
  }

  // ------------------------------------------------------------------
  // Alias OBSOLETOS `mi-*` (se retiran en B0.5): el contrato "actual" del
  // inquilino y el mismo servicio de las rutas por id.
  // ------------------------------------------------------------------

  /** Conserva la forma antigua del panel (`proximoPago`, `estadoPago`, `diasRestantes`). */
  async obtenerMiPanel(inquilinoId: string) {
    const panel = await this.obtenerPanel(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
    if (!('proximo_periodo' in panel)) {
      return panel;
    }
    return {
      proximoPago: panel.proximo_periodo
        ? {
            monto_centavos: panel.proximo_periodo.monto_centavos,
            fecha: panel.proximo_periodo.fecha_limite,
          }
        : null,
      estadoPago: panel.estado_pago,
      diasRestantes: panel.dias_restantes,
    };
  }

  async obtenerMiContrato(inquilinoId: string) {
    return this.obtenerContrato(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
  }

  async obtenerMiEstadoCuenta(inquilinoId: string) {
    return this.obtenerEstadoCuenta(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
  }

  async solicitarTerminacionMiContrato(
    inquilinoId: string,
    motivo: string,
    fechaEfectiva: Date,
  ) {
    return this.solicitarTerminacionAnticipada(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
      motivo,
      fechaEfectiva,
    );
  }

  async confirmarTerminacionMiContrato(inquilinoId: string) {
    return this.confirmarTerminacionAnticipada(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
  }

  async cancelarTerminacionMiContrato(inquilinoId: string) {
    return this.cancelarTerminacionAnticipada(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
  }

  async darAvisoMiContrato(inquilinoId: string, motivo?: string) {
    return this.darAvisoNoRenovacion(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
      motivo,
    );
  }

  async cancelarAvisoMiContrato(inquilinoId: string) {
    return this.cancelarAvisoNoRenovacion(
      inquilinoId,
      await this.resolverContratoActual(inquilinoId),
    );
  }

  // ------------------------------------------------------------------

  private async resolverContratoActual(inquilinoId: string): Promise<string> {
    const id = await resolverIdContratoDelInquilino(this.prisma, {
      inquilino_id: inquilinoId,
    });
    if (!id) {
      throw new NotFoundException(
        'El inquilino autenticado no tiene ningún contrato.',
      );
    }
    return id;
  }

  private async exigirContrato(inquilinoId: string, contratoId: string) {
    await contratoVinculadoDelInquilino(this.prisma, inquilinoId, contratoId, {
      id: true,
    });
  }

  private periodosDe(
    contrato: ContratoConCuenta,
    hoy: Date,
  ): PeriodoEstadoCuenta[] {
    return calcularEstadoCuenta(
      {
        fecha_inicio: contrato.fecha_inicio,
        fecha_fin: fechaFinParaEstadoCuenta({
          estado: contrato.estado,
          fecha_fin: contrato.fecha_fin,
          terminacionAnticipadaConfirmadaEn:
            contrato.terminacionAnticipadaConfirmadaEn,
          terminacion_fecha_efectiva: contrato.terminacion_fecha_efectiva,
        }),
        dia_pago: contrato.dia_pago,
        canon_centavos: contrato.canon_centavos,
      },
      contrato.incrementos_ipc,
      contrato.pagos,
      hoy,
    );
  }

  private async exponerUrlFirmada<
    T extends { id: string; foto_ruta: string | null },
  >(foto: T): Promise<Omit<T, 'foto_ruta'> & { foto_url: string | null }> {
    const { foto_ruta, ...resto } = foto;
    return {
      ...resto,
      foto_url: await firmarTolerante(
        this.almacenamiento,
        foto_ruta,
        this.logger,
        `la foto de inventario ${foto.id}`,
      ),
    };
  }
}

/** Lo que `calcularEstadoCuenta` necesita de un contrato del portal. */
type ContratoConCuenta = Pick<
  Prisma.ContratoGetPayload<{ select: typeof SELECT_CONTRATO_PORTAL }>,
  | 'estado'
  | 'fecha_inicio'
  | 'fecha_fin'
  | 'dia_pago'
  | 'canon_centavos'
  | 'terminacionAnticipadaConfirmadaEn'
  | 'terminacion_fecha_efectiva'
  | 'incrementos_ipc'
  | 'pagos'
>;
