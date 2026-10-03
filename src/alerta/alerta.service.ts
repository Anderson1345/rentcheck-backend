import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { codificarCursor, decodificarCursor } from './alerta-cursor.util';
import { derivarRecurso } from './alerta-recurso.util';
import { ClienteAlerta, crearAlerta, DatosAlerta } from './crear-alerta';
import { AlertaDto, FeedAlertasDto } from './dto/alerta-respuesta.dto';
import { LIMITE_FEED_POR_DEFECTO } from './dto/feed-alertas-query.dto';
import { ListarAlertasQueryDto } from './dto/listar-alertas-query.dto';

/** De quién son las alertas: siempre sale del token, nunca de la petición. */
export type DestinatarioAlerta =
  { arrendador_id: string } | { inquilino_id: string };

const SELECT_ALERTA = {
  id: true,
  tipo: true,
  mensaje: true,
  leida: true,
  creado_en: true,
  contrato_id: true,
  solicitud_mantenimiento_id: true,
  pago_id: true,
  periodo: true,
} satisfies Prisma.AlertaSelect;

type FilaAlerta = Prisma.AlertaGetPayload<{ select: typeof SELECT_ALERTA }>;

/** Lo que las rutas antiguas del arrendador nunca devolvieron (se agregó en B0.6-B1 y B0.7-A). */
const OMITIR_CAMPOS_NUEVOS = {
  inquilino_id: true,
  pago_id: true,
  periodo: true,
  push_enviado_en: true,
  leida_en: true,
} satisfies Prisma.AlertaOmit;

/** B-80 (D-13): una alerta leída deja de verse en el feed a los 7 días de leída. */
export const DIAS_VISIBLES_LEIDAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Qué alertas muestra el feed (B-80): por defecto las no leídas (de cualquier edad) y las leídas en los
 * últimos `DIAS_VISIBLES_LEIDAS` días; `leida=false`, solo las no leídas; `leida=true`, solo esas leídas
 * recientes. Una leída sin `leida_en` (no debería existir: toda lectura lo escribe) no se muestra.
 */
function filtroVisibles(
  leida: boolean | undefined,
  ahora: Date,
): Prisma.AlertaWhereInput {
  const leidaReciente: Prisma.AlertaWhereInput = {
    leida: true,
    leida_en: {
      gte: new Date(ahora.getTime() - DIAS_VISIBLES_LEIDAS * DIA_MS),
    },
  };
  if (leida === false) {
    return { leida: false };
  }
  if (leida === true) {
    return leidaReciente;
  }
  return { OR: [{ leida: false }, leidaReciente] };
}

function aAlertaDto(fila: FilaAlerta): AlertaDto {
  return {
    id: fila.id,
    tipo: fila.tipo,
    mensaje: fila.mensaje,
    leida: fila.leida,
    creado_en: fila.creado_en,
    recurso: derivarRecurso(fila),
  };
}

@Injectable()
export class AlertaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una alerta con el cliente de Prisma o el `tx` que se le pase (ver `crearAlerta`). Los
   * servicios de negocio que ya viven dentro de una transacción usan `crearAlerta` directamente,
   * sin necesidad de inyectar este servicio.
   */
  crear(datos: DatosAlerta, db: ClienteAlerta = this.prisma) {
    return crearAlerta(db, datos);
  }

  /**
   * Feed por cursor, más recientes primero (`creado_en` y `id` descendentes: el `id` desempata las
   * alertas con la misma hora). Una página cuesta dos consultas sin importar cuántas alertas haya.
   */
  async feed(
    destinatario: DestinatarioAlerta,
    opciones: { leida?: boolean; limite?: number; cursor?: string },
  ): Promise<FeedAlertasDto> {
    const limite = opciones.limite ?? LIMITE_FEED_POR_DEFECTO;
    let posicion: ReturnType<typeof decodificarCursor> = null;
    if (opciones.cursor !== undefined) {
      posicion = decodificarCursor(opciones.cursor);
      if (!posicion) {
        throw new BadRequestException({
          codigo: 'VALIDACION',
          mensaje: 'Los datos enviados no son válidos.',
          detalles: ['cursor no es válido'],
        });
      }
    }

    const where: Prisma.AlertaWhereInput = {
      ...destinatario,
      AND: [
        filtroVisibles(opciones.leida, new Date()),
        ...(posicion
          ? [
              {
                OR: [
                  { creado_en: { lt: posicion.creado_en } },
                  { creado_en: posicion.creado_en, id: { lt: posicion.id } },
                ],
              },
            ]
          : []),
      ],
    };

    const [filas, noLeidas] = await Promise.all([
      this.prisma.alerta.findMany({
        where,
        select: SELECT_ALERTA,
        orderBy: [{ creado_en: 'desc' }, { id: 'desc' }],
        take: limite + 1,
      }),
      this.contar(destinatario),
    ]);

    const hayMas = filas.length > limite;
    const pagina = hayMas ? filas.slice(0, limite) : filas;
    const ultima = pagina[pagina.length - 1];
    return {
      items: pagina.map(aAlertaDto),
      siguiente_cursor:
        hayMas && ultima
          ? codificarCursor({ creado_en: ultima.creado_en, id: ultima.id })
          : null,
      no_leidas: noLeidas,
    };
  }

  async contar(destinatario: DestinatarioAlerta): Promise<number> {
    return this.prisma.alerta.count({
      where: { ...destinatario, leida: false },
    });
  }

  /** 404 si no existe o no es de este destinatario; idempotente si ya estaba leída. */
  async marcarLeida(
    destinatario: DestinatarioAlerta,
    id: string,
  ): Promise<AlertaDto> {
    const alerta = await this.prisma.alerta.findFirst({
      where: { id, ...destinatario },
      select: SELECT_ALERTA,
    });
    if (!alerta) {
      throw new NotFoundException('Alerta no encontrada.');
    }
    if (alerta.leida) {
      return aAlertaDto(alerta);
    }
    // Condicionada al destinatario también al escribir, y a que siga sin leer: una lectura simultánea
    // no le cambia la fecha de lectura a la otra.
    await this.prisma.alerta.updateMany({
      where: { id, ...destinatario, leida: false },
      data: { leida: true, leida_en: new Date() },
    });
    return aAlertaDto({ ...alerta, leida: true });
  }

  /** Solo las del destinatario y solo las que seguían sin leer (las ya leídas conservan su `leida_en`). */
  async marcarTodasLeidas(
    destinatario: DestinatarioAlerta,
  ): Promise<{ marcadas: number }> {
    const resultado = await this.prisma.alerta.updateMany({
      where: { ...destinatario, leida: false },
      data: { leida: true, leida_en: new Date() },
    });
    return { marcadas: resultado.count };
  }

  // ---- Rutas antiguas del arrendador (obsoletas; misma forma de respuesta que siempre) ----

  listar(arrendadorId: string, query: ListarAlertasQueryDto) {
    return this.prisma.alerta.findMany({
      where: {
        arrendador_id: arrendadorId,
        ...(query.leida !== undefined ? { leida: query.leida } : {}),
      },
      orderBy: { creado_en: 'desc' },
      omit: OMITIR_CAMPOS_NUEVOS,
    });
  }

  async marcarComoLeida(id: string, arrendadorId: string) {
    const alerta = await this.prisma.alerta.findFirst({
      where: { id, arrendador_id: arrendadorId },
      select: { id: true },
    });
    if (!alerta) {
      throw new NotFoundException(
        'Alerta no encontrada o no pertenece al arrendador autenticado.',
      );
    }
    // B-80: escribe la fecha de lectura solo si seguía sin leer (volver a marcarla no la cambia).
    await this.prisma.alerta.updateMany({
      where: { id: alerta.id, leida: false },
      data: { leida: true, leida_en: new Date() },
    });
    return this.prisma.alerta.findUniqueOrThrow({
      where: { id: alerta.id },
      omit: OMITIR_CAMPOS_NUEVOS,
    });
  }
}
