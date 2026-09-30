import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { firmarTolerante } from '../common/firma-tolerante';
import { Prisma, TipoDocumentoContrato } from '@prisma/client';
import { createHash } from 'crypto';
import PDFDocument from 'pdfkit';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { construirTextoContrato } from './plantillas-contrato';
import { construirTextoOtrosi } from './plantillas-otrosi';
import { terminosOriginales } from './terminos-originales';

const SELECT_CONTRATO_PARA_DOCUMENTOS = {
  id: true,
  tipo_plantilla: true,
  canon_centavos: true,
  deposito_centavos: true,
  dia_pago: true,
  forma_pago: true,
  datos_recaudo: true,
  datos_fiador_o_poliza: true,
  condicionesParticularesTexto: true,
  fecha_inicio: true,
  fecha_fin: true,
  pdf_contrato_ruta: true,
  unidad: {
    select: {
      nombre: true,
      inmueble: { select: { direccion: true, ciudad: true } },
    },
  },
  // El contrato se firma con lo que el arrendador escribió (la copia), no con el perfil global.
  inquilino_nombre: true,
  inquilino_cedula: true,
  arrendador: { select: { nombre: true, cedula: true } },
  incrementos_ipc: {
    select: {
      id: true,
      fecha_aplicacion: true,
      creado_en: true,
      canon_anterior_centavos: true,
      canon_nuevo_centavos: true,
      porcentaje_ipc_aplicado: true,
      ipc_referencia_anio: true,
      ipc_referencia_porcentaje: true,
      documento: { select: { id: true } },
    },
  },
  prorrogas: {
    select: {
      id: true,
      fecha_aplicacion: true,
      creado_en: true,
      fecha_fin_anterior: true,
      fecha_fin_nueva: true,
      meses: true,
      tipo: true,
      documento: { select: { id: true } },
    },
  },
  documentos: {
    select: { id: true, tipo: true, version: true, ruta: true },
  },
} as const satisfies Prisma.ContratoSelect;

type ContratoParaDocumentos = Prisma.ContratoGetPayload<{
  select: typeof SELECT_CONTRATO_PARA_DOCUMENTOS;
}>;

interface VinculoDocumento {
  incremento_id?: string;
  prorroga_id?: string;
}

interface DocumentoPendiente {
  tipo: TipoDocumentoContrato;
  vinculo: VinculoDocumento;
  /** Nueva versión del original tras corregir el contrato sin vincular (B-35). */
  correccion?: boolean;
  construirTexto: (ahora: Date) => string;
}

export interface DocumentoGenerado {
  tipo: TipoDocumentoContrato;
  version: number;
}

export interface ResultadoGeneracion {
  generados: DocumentoGenerado[];
  ya_existian: number;
  /** Error que detuvo la generación; los documentos previos se conservaron. */
  fallo: unknown;
}

const INTENTOS_DE_VERSION = 5;
const ESPERAS_POR_CARRERA_MS = [200, 400, 800];

function esperar(milisegundos: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milisegundos));
}

function esColisionUnica(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/** El almacenamiento rechazó la subida porque la ruta ya existe (upsert=false). */
function esRutaYaExistente(error: unknown): boolean {
  return (
    error instanceof Error && /already exists|duplicate/i.test(error.message)
  );
}

/**
 * Historial inmutable de documentos legales de un contrato: el original y un
 * otrosí por cada incremento y prórroga. Nunca sobrescribe ni borra un
 * documento existente.
 */
@Injectable()
export class DocumentoContratoService {
  private readonly logger = new Logger(DocumentoContratoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  generarPdf(texto: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const documento = new PDFDocument();
      const fragmentos: Buffer[] = [];

      documento.on('data', (fragmento: Buffer) => fragmentos.push(fragmento));
      documento.on('end', () => resolve(Buffer.concat(fragmentos)));
      documento.on('error', reject);

      documento.fontSize(11);
      documento.text(texto);
      documento.end();
    });
  }

  /** Punto único de escritura de la fila; separado para poder probar el fallo. */
  insertarFila(datos: Prisma.DocumentoContratoUncheckedCreateInput) {
    return this.prisma.documentoContrato.create({ data: datos });
  }

  private async eliminarArchivoHuérfano(ruta: string): Promise<void> {
    try {
      await this.almacenamiento.eliminarArchivo(ruta);
    } catch {
      this.logger.warn(
        `No se pudo eliminar el archivo huérfano '${ruta}' del bucket.`,
      );
    }
  }

  private async buscarExistente(
    contratoId: string,
    tipo: TipoDocumentoContrato,
    vinculo: VinculoDocumento,
    correccion = false,
  ) {
    if (correccion) {
      // Corrección del original: ya está hecha cuando el puntero
      // `pdf_contrato_ruta` volvió a apuntar a un original (lo deja en NULL la
      // corrección y lo fija la generación); entonces el existente es el último.
      const contrato = await this.prisma.contrato.findUnique({
        where: { id: contratoId },
        select: { pdf_contrato_ruta: true },
      });
      if (!contrato?.pdf_contrato_ruta) {
        return null;
      }
      return this.prisma.documentoContrato.findFirst({
        where: { contrato_id: contratoId, tipo },
        orderBy: { version: 'desc' },
      });
    }
    if (vinculo.incremento_id) {
      return this.prisma.documentoContrato.findUnique({
        where: { incremento_id: vinculo.incremento_id },
      });
    }
    if (vinculo.prorroga_id) {
      return this.prisma.documentoContrato.findUnique({
        where: { prorroga_id: vinculo.prorroga_id },
      });
    }
    return this.prisma.documentoContrato.findFirst({
      where: { contrato_id: contratoId, tipo },
      orderBy: { version: 'asc' },
    });
  }

  /**
   * Sube el PDF a `contratos/{id}/v{version}-{tipo}.pdf` (sin sobrescribir),
   * calcula su SHA-256 y crea la fila. La subida va fuera de cualquier
   * transacción: si falla no hay fila; si falla la fila se borra el archivo
   * recién subido. La versión es consecutiva por contrato y se reintenta ante
   * colisiones. Si el documento ya existía (o lo creó otra petición al mismo
   * tiempo) devuelve el existente con `creado: false`.
   */
  async registrarDocumento(
    contratoId: string,
    tipo: TipoDocumentoContrato,
    buffer: Buffer,
    vinculo: VinculoDocumento = {},
    correccion = false,
  ) {
    const hash = createHash('sha256').update(buffer).digest('hex');
    let versionMinima = 1;

    for (let intento = 1; intento <= INTENTOS_DE_VERSION; intento += 1) {
      const existente = await this.buscarExistente(
        contratoId,
        tipo,
        vinculo,
        correccion,
      );
      if (existente) {
        return { documento: existente, creado: false };
      }

      const ultima = await this.prisma.documentoContrato.aggregate({
        where: { contrato_id: contratoId },
        _max: { version: true },
      });
      const version = Math.max((ultima._max.version ?? 0) + 1, versionMinima);
      const ruta = `contratos/${contratoId}/v${version}-${tipo}.pdf`;

      try {
        await this.almacenamiento.subirArchivo(
          buffer,
          ruta,
          'application/pdf',
          false,
        );
      } catch (error) {
        if (!esRutaYaExistente(error)) {
          throw error;
        }
        // Otra petición está registrando este mismo documento: se espera a
        // que su fila aparezca; si no aparece, la ruta está ocupada por un
        // archivo huérfano y se prueba con la versión siguiente.
        for (const espera of ESPERAS_POR_CARRERA_MS) {
          await esperar(espera);
          const creadoPorOtra = await this.buscarExistente(
            contratoId,
            tipo,
            vinculo,
            correccion,
          );
          if (creadoPorOtra) {
            return { documento: creadoPorOtra, creado: false };
          }
        }
        versionMinima = version + 1;
        continue;
      }

      try {
        const documento = await this.insertarFila({
          contrato_id: contratoId,
          tipo,
          version,
          ruta,
          hash_sha256: hash,
          incremento_id: vinculo.incremento_id ?? null,
          prorroga_id: vinculo.prorroga_id ?? null,
        });
        return { documento, creado: true };
      } catch (error) {
        await this.eliminarArchivoHuérfano(ruta);
        if (!esColisionUnica(error)) {
          throw error;
        }
        const creadoPorOtra = await this.buscarExistente(
          contratoId,
          tipo,
          vinculo,
          correccion,
        );
        if (creadoPorOtra) {
          return { documento: creadoPorOtra, creado: false };
        }
        // Colisión de (contrato, versión) con otro tipo de documento: se
        // reintenta con la versión siguiente.
      }
    }

    throw new Error(
      `No fue posible asignar una versión al documento ${tipo} del contrato ${contratoId}.`,
    );
  }

  private async asegurarRutaDelContrato(contratoId: string, ruta: string) {
    try {
      await this.prisma.contrato.updateMany({
        where: { id: contratoId, pdf_contrato_ruta: null },
        data: { pdf_contrato_ruta: ruta },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo actualizar pdf_contrato_ruta del contrato ${contratoId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private construirPendientes(
    contrato: ContratoParaDocumentos,
  ): DocumentoPendiente[] {
    const inquilino = {
      nombre: contrato.inquilino_nombre,
      cedula: contrato.inquilino_cedula,
    };
    const datosBase = {
      arrendador: contrato.arrendador,
      inquilino,
      unidad: contrato.unidad,
      fecha_inicio: contrato.fecha_inicio,
    };
    const pendientes: DocumentoPendiente[] = [];

    const hayOriginal = contrato.documentos.some(
      (documento) => documento.tipo === TipoDocumentoContrato.CONTRATO_ORIGINAL,
    );
    // Un original existente con `pdf_contrato_ruta` en NULL es una corrección
    // del contrato (B-35) cuyo PDF nuevo aún no se generó: el original vigente
    // es siempre la última versión, así que hay que generar una nueva.
    const correccionPendiente = hayOriginal && !contrato.pdf_contrato_ruta;
    if (!hayOriginal || correccionPendiente) {
      pendientes.push({
        tipo: TipoDocumentoContrato.CONTRATO_ORIGINAL,
        vinculo: {},
        correccion: correccionPendiente,
        construirTexto: (ahora) =>
          construirTextoContrato(
            { ...contrato, inquilino },
            terminosOriginales(
              contrato,
              contrato.incrementos_ipc,
              contrato.prorrogas,
            ),
            ahora,
          ),
      });
    }

    const hechos: Array<{
      fecha_aplicacion: Date;
      creado_en: Date;
      pendiente: DocumentoPendiente;
    }> = [];

    for (const incremento of contrato.incrementos_ipc) {
      if (incremento.documento) {
        continue;
      }
      hechos.push({
        fecha_aplicacion: incremento.fecha_aplicacion,
        creado_en: incremento.creado_en,
        pendiente: {
          tipo: TipoDocumentoContrato.OTROSI_INCREMENTO,
          vinculo: { incremento_id: incremento.id },
          construirTexto: (ahora) =>
            construirTextoOtrosi(
              'OTROSI_INCREMENTO',
              {
                ...datosBase,
                fecha_aplicacion: incremento.fecha_aplicacion,
                canon_anterior_centavos: incremento.canon_anterior_centavos,
                canon_nuevo_centavos: incremento.canon_nuevo_centavos,
                porcentaje_aplicado:
                  incremento.porcentaje_ipc_aplicado.toNumber(),
                ipc_referencia_anio: incremento.ipc_referencia_anio,
                ipc_referencia_porcentaje:
                  incremento.ipc_referencia_porcentaje?.toNumber() ?? null,
              },
              ahora,
            ),
        },
      });
    }

    for (const prorroga of contrato.prorrogas) {
      if (prorroga.documento) {
        continue;
      }
      hechos.push({
        fecha_aplicacion: prorroga.fecha_aplicacion,
        creado_en: prorroga.creado_en,
        pendiente: {
          tipo: TipoDocumentoContrato.OTROSI_PRORROGA,
          vinculo: { prorroga_id: prorroga.id },
          construirTexto: (ahora) =>
            construirTextoOtrosi(
              'OTROSI_PRORROGA',
              {
                ...datosBase,
                fecha_aplicacion: prorroga.fecha_aplicacion,
                fecha_fin_anterior: prorroga.fecha_fin_anterior,
                fecha_fin_nueva: prorroga.fecha_fin_nueva,
                meses: prorroga.meses,
                tipo_prorroga: prorroga.tipo,
              },
              ahora,
            ),
        },
      });
    }

    // La versión respeta el orden en que ocurrieron los hechos.
    hechos.sort(
      (a, b) =>
        a.fecha_aplicacion.getTime() - b.fecha_aplicacion.getTime() ||
        a.creado_en.getTime() - b.creado_en.getTime(),
    );
    pendientes.push(...hechos.map((hecho) => hecho.pendiente));
    return pendientes;
  }

  /**
   * Genera SOLO lo que falta: el contrato original si no existe y un otrosí
   * por cada incremento o prórroga sin documento. Nunca sobrescribe ni borra.
   * Se detiene en el primer fallo para no romper el orden de las versiones.
   */
  async generarFaltantes(contratoId: string): Promise<ResultadoGeneracion> {
    const contrato = await this.prisma.contrato.findUnique({
      where: { id: contratoId },
      select: SELECT_CONTRATO_PARA_DOCUMENTOS,
    });
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    const pendientes = this.construirPendientes(contrato);
    const esperados =
      1 + contrato.incrementos_ipc.length + contrato.prorrogas.length;
    let yaExistian = esperados - pendientes.length;
    const generados: DocumentoGenerado[] = [];
    let fallo: unknown = null;

    for (const pendiente of pendientes) {
      try {
        const buffer = await this.generarPdf(
          pendiente.construirTexto(new Date()),
        );
        const { documento, creado } = await this.registrarDocumento(
          contrato.id,
          pendiente.tipo,
          buffer,
          pendiente.vinculo,
          pendiente.correccion ?? false,
        );
        if (!creado) {
          yaExistian += 1;
          continue;
        }
        generados.push({ tipo: documento.tipo, version: documento.version });
        if (documento.tipo === TipoDocumentoContrato.CONTRATO_ORIGINAL) {
          await this.asegurarRutaDelContrato(contrato.id, documento.ruta);
        }
      } catch (error) {
        fallo = error;
        this.logger.error(
          `No fue posible generar el documento ${pendiente.tipo} del contrato ${contrato.id}`,
          error instanceof Error ? error.stack : String(error),
        );
        break;
      }
    }

    return { generados, ya_existian: yaExistian, fallo };
  }

  /**
   * Genera lo que falte sin propagar errores: el contrato, el incremento o la
   * prórroga ya están confirmados y el documento queda pendiente de
   * regeneración (POST /contratos/:id/documentos/regenerar).
   */
  async generarSinPropagarErrores(contratoId: string): Promise<void> {
    try {
      await this.generarFaltantes(contratoId);
    } catch (error) {
      this.logger.error(
        `No fue posible generar los documentos del contrato ${contratoId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async encontrarContratoDelArrendador(
    contratoId: string,
    arrendadorId: string,
  ): Promise<void> {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id: contratoId,
        unidad: { inmueble: { arrendador_id: arrendadorId } },
      },
      select: { id: true },
    });
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
  }

  async regenerar(contratoId: string, arrendadorId: string) {
    await this.encontrarContratoDelArrendador(contratoId, arrendadorId);

    const { generados, ya_existian, fallo } =
      await this.generarFaltantes(contratoId);
    if (fallo) {
      throw new InternalServerErrorException({
        codigo: 'DOCUMENTO_NO_GENERADO',
        mensaje:
          'No se pudo generar uno de los documentos. Los ya generados se conservaron; intenta de nuevo.',
        detalles: { generados },
      });
    }
    return { generados, ya_existian };
  }

  private async firmarRuta(ruta: string): Promise<string | null> {
    return firmarTolerante(
      this.almacenamiento,
      ruta,
      this.logger,
      'un documento del contrato',
    );
  }

  async listar(contratoId: string, arrendadorId: string) {
    await this.encontrarContratoDelArrendador(contratoId, arrendadorId);
    return this.listarDeContrato(contratoId);
  }

  /**
   * Documentos de un contrato ya autorizado por quien llama (el arrendador con
   * `listar`, el inquilino con `contratoVinculadoDelInquilino`). Si falla la
   * firma de un documento, ese sale con `url_firmada` nula y el resto se
   * entrega.
   */
  async listarDeContrato(contratoId: string) {
    const documentos = await this.prisma.documentoContrato.findMany({
      where: { contrato_id: contratoId },
      orderBy: { version: 'asc' },
      select: {
        id: true,
        tipo: true,
        version: true,
        ruta: true,
        hash_sha256: true,
        generado_en: true,
      },
    });

    return Promise.all(documentos.map((documento) => this.resumir(documento)));
  }

  private async resumir<T extends { ruta: string }>(documento: T) {
    const { ruta, ...resto } = documento;
    return { ...resto, url_firmada: await this.firmarRuta(ruta) };
  }

  /**
   * Genera el PDF de un contrato recién corregido (B-35), FUERA de la
   * transacción de la corrección: una nueva versión de `CONTRATO_ORIGINAL` con
   * los términos actuales. Devuelve el documento vigente (sin la ruta interna)
   * o null si la generación falló: la corrección ya está aplicada y el PDF se
   * recupera con `POST /contratos/:id/documentos/regenerar`.
   */
  async generarOriginalTrasCorreccion(contratoId: string) {
    try {
      const { fallo } = await this.generarFaltantes(contratoId);
      if (fallo) {
        return null;
      }
      const original = await this.prisma.documentoContrato.findFirst({
        where: {
          contrato_id: contratoId,
          tipo: TipoDocumentoContrato.CONTRATO_ORIGINAL,
        },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          tipo: true,
          version: true,
          ruta: true,
          hash_sha256: true,
          generado_en: true,
        },
      });
      return original ? await this.resumir(original) : null;
    } catch (error) {
      this.logger.error(
        `No fue posible generar el PDF corregido del contrato ${contratoId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }
}
