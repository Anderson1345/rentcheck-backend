import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoContrato, Prisma } from '@prisma/client';
import { hoyEnBogota } from '../common/hoy-bogota.util';
import { recalcularEstadoPagoContrato } from '../common/recalcular-estado-pago';
import {
  fechaExpiracionCodigo,
  generarCodigoAcceso,
} from '../common/utils/codigo-acceso';
import { normalizarCamposInquilino } from '../common/utils/normalizar-cedula';
import { PrismaService } from '../prisma/prisma.service';
import { ContratoService } from './contrato.service';
import { CorregirContratoDto } from './dto/corregir-contrato.dto';
import { CorregirInquilinoContratoDto } from './dto/corregir-inquilino-contrato.dto';
import { DocumentoContratoService } from './documento-contrato.service';
import {
  bloquearContrato,
  bloquearUnidad,
  esColisionDeCodigoAcceso,
  estadoInicialSegunFecha,
  normalizarDeposito,
  validarDepositoSegunPlantilla,
  validarFinFuturo,
  validarFinPosteriorAInicio,
  verificarTraslapeEnUnidad,
} from './reglas-contrato';

const SELECT_PARA_CORREGIR = {
  id: true,
  unidad_id: true,
  tipo_plantilla: true,
  estado: true,
  vinculado_en: true,
  terminacionAnticipadaSolicitada: true,
  canon_centavos: true,
  dia_pago: true,
  forma_pago: true,
  datos_recaudo: true,
  deposito_centavos: true,
  datos_fiador_o_poliza: true,
  condicionesParticularesTexto: true,
  fecha_inicio: true,
  fecha_fin: true,
  inquilino_id: true,
  inquilino_nombre: true,
  inquilino_cedula: true,
  inquilino_telefono: true,
  _count: {
    select: { incrementos_ipc: true, prorrogas: true, pagos: true },
  },
} as const satisfies Prisma.ContratoSelect;

type ContratoParaCorregir = Prisma.ContratoGetPayload<{
  select: typeof SELECT_PARA_CORREGIR;
}>;

const ESTADOS_EDITABLES: EstadoContrato[] = [
  EstadoContrato.PROGRAMADO,
  EstadoContrato.ACTIVO,
];

const INTENTOS_DE_CODIGO = 5;

/** Día calendario (medianoche UTC) de una fecha recibida. */
function soloDia(fecha: Date): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
  );
}

/**
 * Corrección de un contrato mientras el inquilino no lo haya vinculado (B-35):
 * términos y datos del inquilino escritos en el contrato. Una vez vinculado, o
 * con otrosíes, pagos o una terminación solicitada, un cambio ya no es una
 * corrección.
 *
 * ORDEN DE BLOQUEOS (fijo, para no provocar interbloqueos): primero la fila de
 * la unidad (solo si cambian fechas, porque ahí se valida el traslape) y
 * después la fila del contrato. Las condiciones de edición se verifican DENTRO
 * de la transacción y DESPUÉS de tomar el bloqueo del contrato, así que una
 * vinculación simultánea (que hace UPDATE de la misma fila) o gana antes (y el
 * PATCH responde 409 CONTRATO_YA_VINCULADO) o espera al commit y ve los datos
 * ya corregidos.
 */
@Injectable()
export class CorreccionContratoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contratos: ContratoService,
    private readonly documentos: DocumentoContratoService,
  ) {}

  // ------------------------------------------------------------------
  // PATCH /contratos/:id
  // ------------------------------------------------------------------
  async corregirTerminos(
    id: string,
    arrendadorId: string,
    dto: CorregirContratoDto,
  ) {
    const hoy = hoyEnBogota();
    const cambiaFechas =
      dto.fecha_inicio !== undefined || dto.fecha_fin !== undefined;

    const { cambiaPdf } = await this.ejecutar(async () =>
      this.prisma.$transaction(async (tx) => {
        const actual = await this.bloquearYVerificar(
          tx,
          id,
          arrendadorId,
          cambiaFechas,
        );

        const data: Prisma.ContratoUncheckedUpdateManyInput = {};
        let cambiaPdf = false;
        let cambiaCuenta = false;

        if (dto.canon_centavos !== undefined) {
          if (dto.canon_centavos !== actual.canon_centavos) {
            data.canon_centavos = dto.canon_centavos;
            cambiaPdf = cambiaCuenta = true;
          }
        }
        if (dto.dia_pago !== undefined && dto.dia_pago !== actual.dia_pago) {
          data.dia_pago = dto.dia_pago;
          cambiaPdf = cambiaCuenta = true;
        }
        if (
          dto.forma_pago !== undefined &&
          dto.forma_pago !== actual.forma_pago
        ) {
          data.forma_pago = dto.forma_pago;
          cambiaPdf = true;
        }
        if (
          dto.datos_recaudo !== undefined &&
          dto.datos_recaudo !== actual.datos_recaudo
        ) {
          data.datos_recaudo = dto.datos_recaudo;
          cambiaPdf = true;
        }
        if (dto.deposito_centavos !== undefined) {
          const deposito = normalizarDeposito(dto.deposito_centavos);
          validarDepositoSegunPlantilla(actual.tipo_plantilla, deposito);
          if (deposito !== actual.deposito_centavos) {
            data.deposito_centavos = deposito;
            cambiaPdf = true;
          }
        }
        if (
          dto.datos_fiador_o_poliza !== undefined &&
          dto.datos_fiador_o_poliza !== actual.datos_fiador_o_poliza
        ) {
          data.datos_fiador_o_poliza = dto.datos_fiador_o_poliza;
          cambiaPdf = true;
        }
        if (
          dto.condicionesParticularesTexto !== undefined &&
          dto.condicionesParticularesTexto !==
            actual.condicionesParticularesTexto
        ) {
          data.condicionesParticularesTexto = dto.condicionesParticularesTexto;
          cambiaPdf = true;
        }

        if (cambiaFechas) {
          const inicio = soloDia(dto.fecha_inicio ?? actual.fecha_inicio);
          const fin = soloDia(dto.fecha_fin ?? actual.fecha_fin);
          validarFinPosteriorAInicio(inicio, fin);
          // B-55: la fecha de fin resultante debe ser futura (solo si el PATCH
          // envía alguna fecha; los demás campos no la revalidan).
          validarFinFuturo(fin, hoy);
          const cambianLasFechas =
            inicio.getTime() !== actual.fecha_inicio.getTime() ||
            fin.getTime() !== actual.fecha_fin.getTime();
          if (cambianLasFechas) {
            // Mismas reglas que crear(): estado según la fecha de inicio y
            // sin traslape con el resto de contratos de la unidad (sin contar
            // este mismo contrato).
            const estado = estadoInicialSegunFecha(inicio, hoy);
            await verificarTraslapeEnUnidad(tx, {
              unidadId: actual.unidad_id,
              inicio,
              fin,
              estado,
              excluirContratoId: id,
            });
            data.fecha_inicio = inicio;
            data.fecha_fin = fin;
            if (estado !== actual.estado) {
              data.estado = estado;
            }
            cambiaPdf = cambiaCuenta = true;
          }
        }

        if (Object.keys(data).length === 0) {
          return { cambiaPdf: false };
        }

        await this.aplicarCambios(tx, id, {
          ...data,
          // El PDF vigente ya no refleja los términos: hasta que se genere el
          // nuevo, `pdf_contrato_ruta` queda en NULL (ver DocumentoContratoService).
          ...(cambiaPdf ? { pdf_contrato_ruta: null } : {}),
        });
        if (cambiaCuenta) {
          // El estado de pago se deriva; nunca se asigna a mano (B-50).
          await recalcularEstadoPagoContrato(tx, id, hoy);
        }
        return { cambiaPdf };
      }),
    );

    return this.responder(id, arrendadorId, cambiaPdf, false);
  }

  // ------------------------------------------------------------------
  // PATCH /contratos/:id/inquilino
  // ------------------------------------------------------------------
  async corregirInquilino(
    id: string,
    arrendadorId: string,
    dto: CorregirInquilinoContratoDto,
  ) {
    // Misma normalización y validación que `inquilino_nuevo` al crear.
    const datos = normalizarCamposInquilino(dto);

    const { cambiaPdf, codigoRegenerado } = await this.ejecutar(() =>
      this.prisma.$transaction(async (tx) => {
        const actual = await this.bloquearYVerificar(
          tx,
          id,
          arrendadorId,
          false,
        );

        const nombre = datos.nombre ?? actual.inquilino_nombre;
        const telefono = datos.telefono ?? actual.inquilino_telefono;
        const cedula = datos.cedula ?? actual.inquilino_cedula;
        const cambiaNombre = nombre !== actual.inquilino_nombre;
        const cambiaTelefono = telefono !== actual.inquilino_telefono;
        const cambiaCedula = cedula !== actual.inquilino_cedula;
        if (!cambiaNombre && !cambiaTelefono && !cambiaCedula) {
          return { cambiaPdf: false, codigoRegenerado: false };
        }

        const data: Prisma.ContratoUncheckedUpdateManyInput = {
          inquilino_nombre: nombre,
          inquilino_telefono: telefono,
          inquilino_cedula: cedula,
        };

        if (cambiaCedula) {
          // Identidad global por cédula normalizada (como `inquilino_nuevo`):
          // se crea si no existe y, si existe, se reutiliza SIN modificar su
          // perfil ni devolver nada de ella. `createMany` con skipDuplicates:
          // un create con P2002 dejaría inservible la transacción.
          await tx.inquilino.createMany({
            data: [{ nombre, cedula, telefono, arrendador_id: null }],
            skipDuplicates: true,
          });
          const identidad = await tx.inquilino.findUniqueOrThrow({
            where: { cedula },
            select: { id: true },
          });
          data.inquilino_id = identidad.id;

          // Código nuevo: el anterior deja de servir de inmediato.
          const datosCodigo = {
            codigo: generarCodigoAcceso(),
            expira_en: fechaExpiracionCodigo(),
            inquilino_id: identidad.id,
          };
          const existente = await tx.codigoAcceso.findUnique({
            where: { contrato_id: id },
            select: { id: true },
          });
          if (existente) {
            await tx.codigoAcceso.update({
              where: { id: existente.id },
              data: datosCodigo,
            });
          } else {
            await tx.codigoAcceso.create({
              data: {
                ...datosCodigo,
                contrato_id: id,
                unidad_id: actual.unidad_id,
              },
            });
          }
        }

        // El teléfono no aparece en el PDF: solo nombre y cédula lo cambian.
        const cambiaPdf = cambiaNombre || cambiaCedula;
        await this.aplicarCambios(tx, id, {
          ...data,
          ...(cambiaPdf ? { pdf_contrato_ruta: null } : {}),
        });
        return { cambiaPdf, codigoRegenerado: cambiaCedula };
      }),
    );

    return this.responder(id, arrendadorId, cambiaPdf, codigoRegenerado);
  }

  // ------------------------------------------------------------------
  // Piezas compartidas
  // ------------------------------------------------------------------

  /** Reintenta si el código de acceso nuevo colisiona; traduce el P2002 de la unidad ACTIVA. */
  private async ejecutar<T>(operacion: () => Promise<T>): Promise<T> {
    for (let intento = 1; intento <= INTENTOS_DE_CODIGO; intento += 1) {
      try {
        return await operacion();
      } catch (error) {
        if (esColisionDeCodigoAcceso(error)) {
          if (intento < INTENTOS_DE_CODIGO) {
            continue;
          }
          throw new InternalServerErrorException(
            'No fue posible generar un código de acceso único.',
          );
        }
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          // Índice único de un solo contrato ACTIVO por unidad.
          throw new ConflictException(
            'Esta unidad ya tiene un contrato activo',
          );
        }
        throw error;
      }
    }
    throw new InternalServerErrorException(
      'No fue posible corregir el contrato.',
    );
  }

  /**
   * Bloquea (unidad → contrato) y verifica, con el bloqueo tomado, que el
   * contrato del arrendador sigue siendo editable.
   */
  private async bloquearYVerificar(
    tx: Prisma.TransactionClient,
    id: string,
    arrendadorId: string,
    bloquearLaUnidad: boolean,
  ): Promise<ContratoParaCorregir> {
    const base = await tx.contrato.findFirst({
      where: { id, unidad: { inmueble: { arrendador_id: arrendadorId } } },
      select: { unidad_id: true },
    });
    if (!base) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    // La unidad de un contrato no cambia, así que se puede leer sin bloquear.
    if (bloquearLaUnidad) {
      await bloquearUnidad(tx, base.unidad_id);
    }
    await bloquearContrato(tx, id);

    // Con el bloqueo tomado: lo que se lee ya no cambia hasta el commit.
    const actual = await tx.contrato.findUniqueOrThrow({
      where: { id },
      select: SELECT_PARA_CORREGIR,
    });
    this.verificarEditable(actual);
    return actual;
  }

  private verificarEditable(contrato: ContratoParaCorregir): void {
    if (contrato.vinculado_en !== null) {
      throw new ConflictException({
        codigo: 'CONTRATO_YA_VINCULADO',
        mensaje:
          'El inquilino ya vinculó este contrato: no se puede corregir. Un cambio de canon, día de pago u otro término se hace con un otrosí.',
      });
    }
    const motivo = !ESTADOS_EDITABLES.includes(contrato.estado)
      ? `un contrato en estado ${contrato.estado} no se puede corregir`
      : contrato._count.incrementos_ipc > 0 || contrato._count.prorrogas > 0
        ? 'el contrato ya tiene incrementos o prórrogas (otrosíes)'
        : contrato._count.pagos > 0
          ? 'el contrato ya tiene pagos registrados'
          : contrato.terminacionAnticipadaSolicitada
            ? 'el contrato tiene una terminación anticipada solicitada'
            : null;
    if (motivo) {
      throw new ConflictException({
        codigo: 'CONTRATO_NO_EDITABLE',
        mensaje: `El contrato no se puede corregir: ${motivo}.`,
      });
    }
  }

  /** Escritura condicionada (defensa adicional al bloqueo de la fila). */
  private async aplicarCambios(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.ContratoUncheckedUpdateManyInput,
  ): Promise<void> {
    const resultado = await tx.contrato.updateMany({
      where: { id, vinculado_en: null, estado: { in: ESTADOS_EDITABLES } },
      data,
    });
    if (resultado.count === 0) {
      throw new ConflictException({
        codigo: 'CONTRATO_NO_EDITABLE',
        mensaje:
          'El contrato cambió mientras se corregía; vuelve a intentarlo.',
      });
    }
  }

  /**
   * Respuesta: el contrato con la forma de `GET /contratos/:id` más
   * `documento` (la versión del original generada, o null). El PDF se genera
   * DESPUÉS de confirmar la transacción y fuera de ella; si falla, la
   * corrección queda aplicada y se recupera con `documentos/regenerar`.
   * `codigo_acceso` solo viaja si se regeneró.
   */
  private async responder(
    id: string,
    arrendadorId: string,
    cambiaPdf: boolean,
    codigoRegenerado: boolean,
  ) {
    const documento = cambiaPdf
      ? await this.documentos.generarOriginalTrasCorreccion(id)
      : null;
    const contrato = await this.contratos.encontrarUno(id, arrendadorId);
    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    const { codigo_acceso, ...resto } = contrato;
    return {
      ...resto,
      ...(codigoRegenerado ? { codigo_acceso } : {}),
      documento,
    };
  }
}
