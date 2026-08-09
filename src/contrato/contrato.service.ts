import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EstadoContrato, Prisma, RolSolicitante } from '@prisma/client';
import { randomInt } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@Injectable()
export class ContratoService {
  private readonly logger = new Logger(ContratoService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async generarPdfContrato(
    contrato: Prisma.ContratoGetPayload<{
      include: {
        unidad: { include: { inmueble: true } };
        inquilino: true;
      };
    }>,
  ): Promise<void> {
    const rutaRelativa = `uploads/contratos/${contrato.id}.pdf`;
    const rutaAbsoluta = join(process.cwd(), rutaRelativa);

    await mkdir(dirname(rutaAbsoluta), { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const documento = new PDFDocument();
      const salida = createWriteStream(rutaAbsoluta);

      salida.on('finish', resolve);
      salida.on('error', reject);
      documento.on('error', reject);
      documento.pipe(salida);

      documento.fontSize(18).text('Contrato de arrendamiento');
      documento.moveDown();
      documento.fontSize(12);
      documento.text(`Inquilino: ${contrato.inquilino.nombre}`);
      documento.text(
        `Dirección del inmueble: ${contrato.unidad.inmueble.direccion}`,
      );
      documento.text(`Unidad: ${contrato.unidad.nombre}`);
      documento.text(`Tipo de plantilla: ${contrato.tipo_plantilla}`);
      documento.text(
        `Canon: $${(contrato.canon_centavos / 100).toLocaleString('es-CO')}`,
      );
      documento.text(`Día de pago: ${contrato.dia_pago}`);
      documento.text(`Forma de pago: ${contrato.forma_pago}`);
      documento.text(
        `Depósito: $${(contrato.deposito_centavos / 100).toLocaleString('es-CO')}`,
      );
      documento.text(
        `Fecha de inicio: ${contrato.fecha_inicio.toISOString().slice(0, 10)}`,
      );
      documento.text(
        `Fecha de fin: ${contrato.fecha_fin.toISOString().slice(0, 10)}`,
      );
      documento.end();
    });
  }

  private async eliminarPdfContrato(rutaRelativa: string): Promise<void> {
    try {
      await unlink(join(process.cwd(), rutaRelativa));
    } catch {
      // La limpieza no debe ocultar el error original de la transacción.
    }
  }

  private generarCodigoAcceso(): string {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const aleatorio = Array.from(
      { length: 4 },
      () => caracteres[randomInt(caracteres.length)],
    ).join('');

    return `RC-${new Date().getFullYear()}-${aleatorio}`;
  }

  private esColisionDeCodigoAcceso(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    return (
      (Array.isArray(target) && target.includes('codigo')) ||
      (typeof target === 'string' && target.includes('CodigoAcceso_codigo_key'))
    );
  }

  async listar(arrendadorId: string) {
    return this.prisma.contrato.findMany({
      where: {
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: {
          select: {
            id: true,
            nombre: true,
            tipo: true,
          },
        },
        inquilino: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { fecha_inicio: 'desc' },
    });
  }

  async encontrarUno(id: string, arrendadorId: string) {
    return this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: true,
        inquilino: true,
        incrementos_ipc: true,
      },
    });
  }

  async renovar(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: { include: { inmueble: true } },
        inquilino: true,
      },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'No se puede renovar un contrato que no está activo.',
      );
    }

    const configuracionIpc = await this.prisma.configuracionIpc.findFirst({
      orderBy: [{ anio: 'desc' }, { actualizadoEn: 'desc' }],
    });
    if (!configuracionIpc) {
      throw new InternalServerErrorException(
        'No hay un valor de IPC configurado para renovar el contrato.',
      );
    }

    const porcentajeIpc = configuracionIpc.porcentaje.toNumber();
    const canonNuevo = Math.round(
      contrato.canon_centavos + (contrato.canon_centavos * porcentajeIpc) / 100,
    );
    const nuevaFechaFin = new Date(contrato.fecha_fin);
    nuevaFechaFin.setFullYear(nuevaFechaFin.getFullYear() + 1);
    const fechaAplicacion = new Date();

    const [contratoActualizado, incrementoIpc] = await this.prisma.$transaction(
      [
        this.prisma.contrato.update({
          where: { id: contrato.id },
          data: {
            canon_centavos: canonNuevo,
            fecha_fin: nuevaFechaFin,
          },
        }),
        this.prisma.incrementoIPC.create({
          data: {
            contrato_id: contrato.id,
            canon_anterior_centavos: contrato.canon_centavos,
            canon_nuevo_centavos: canonNuevo,
            porcentaje_ipc_aplicado: configuracionIpc.porcentaje,
            fecha_aplicacion: fechaAplicacion,
          },
        }),
      ],
    );

    let contratoConPdf = contratoActualizado;
    const pdfContratoUrl = `uploads/contratos/${contrato.id}.pdf`;
    try {
      await this.generarPdfContrato({
        ...contrato,
        canon_centavos: canonNuevo,
        fecha_fin: nuevaFechaFin,
      });
      contratoConPdf = await this.prisma.contrato.update({
        where: { id: contrato.id },
        data: { pdf_contrato_url: pdfContratoUrl },
      });
    } catch (error) {
      this.logger.error(
        `No fue posible regenerar o guardar el PDF del contrato ${contrato.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return { contrato: contratoConPdf, incremento_ipc: incrementoIpc };
  }

  async regenerarCodigo(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: { codigo_acceso: true },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }
    if (!contrato.codigo_acceso) {
      throw new NotFoundException(
        'El contrato no tiene un código de acceso asociado.',
      );
    }

    for (let intento = 1; intento <= 5; intento += 1) {
      try {
        const codigoAcceso = await this.prisma.codigoAcceso.update({
          where: { id: contrato.codigo_acceso.id },
          data: { codigo: this.generarCodigoAcceso() },
        });
        return { codigo: codigoAcceso.codigo };
      } catch (error) {
        if (this.esColisionDeCodigoAcceso(error) && intento < 5) {
          continue;
        }
        if (this.esColisionDeCodigoAcceso(error)) {
          throw new InternalServerErrorException(
            'No fue posible generar un código de acceso único.',
          );
        }
        throw error;
      }
    }

    throw new InternalServerErrorException(
      'No fue posible generar un código de acceso único.',
    );
  }

  async crear(dto: CrearContratoDto, arrendadorId: string) {
    const unidad = await this.prisma.unidad.findFirst({
      where: {
        id: dto.unidad_id,
        inmueble: { arrendador_id: arrendadorId },
      },
    });
    if (!unidad) {
      throw new NotFoundException('Unidad no encontrada');
    }

    const inquilino = await this.prisma.inquilino.findFirst({
      where: { id: dto.inquilino_id, arrendador_id: arrendadorId },
    });
    if (!inquilino) {
      throw new NotFoundException('Inquilino no encontrado');
    }

    let contratoCreado:
      | Prisma.ContratoGetPayload<{
          include: {
            codigo_acceso: true;
            unidad: { include: { inmueble: true } };
            inquilino: true;
          };
        }>
      | undefined;

    try {
      for (let intento = 1; intento <= 5; intento += 1) {
        try {
          contratoCreado = await this.prisma.$transaction(async (tx) => {
            const contrato = await tx.contrato.create({
              data: {
                arrendador_id: arrendadorId,
                unidad_id: dto.unidad_id,
                inquilino_id: dto.inquilino_id,
                tipo_plantilla: dto.tipo_plantilla,
                canon_centavos: dto.canon_centavos,
                dia_pago: dto.dia_pago,
                forma_pago: dto.forma_pago,
                deposito_centavos: dto.deposito_centavos,
                datos_recaudo: dto.datos_recaudo,
                datos_fiador_o_poliza: dto.datos_fiador_o_poliza,
                fecha_inicio: dto.fecha_inicio,
                fecha_fin: dto.fecha_fin,
                estado: EstadoContrato.ACTIVO,
              },
              include: {
                unidad: { include: { inmueble: true } },
                inquilino: true,
              },
            });

            await tx.codigoAcceso.create({
              data: {
                codigo: this.generarCodigoAcceso(),
                contrato_id: contrato.id,
                unidad_id: dto.unidad_id,
                inquilino_id: dto.inquilino_id,
              },
            });

            return tx.contrato.findUniqueOrThrow({
              where: { id: contrato.id },
              include: {
                codigo_acceso: true,
                unidad: { include: { inmueble: true } },
                inquilino: true,
              },
            });
          });
          break;
        } catch (error) {
          if (this.esColisionDeCodigoAcceso(error)) {
            if (intento === 5) {
              throw new InternalServerErrorException(
                'No fue posible generar el código de acceso',
              );
            }
            continue;
          }
          throw error;
        }
      }

      if (!contratoCreado) {
        throw new InternalServerErrorException(
          'No fue posible generar el código de acceso',
        );
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Esta unidad ya tiene un contrato activo');
      }
      throw error;
    }

    const contratoConfirmado = contratoCreado;
    if (!contratoConfirmado) {
      throw new InternalServerErrorException(
        'No fue posible crear el contrato',
      );
    }

    const pdfContratoUrl = `uploads/contratos/${contratoConfirmado.id}.pdf`;
    try {
      await this.generarPdfContrato(contratoConfirmado);

      return await this.prisma.contrato.update({
        where: { id: contratoConfirmado.id },
        data: { pdf_contrato_url: pdfContratoUrl },
        include: {
          codigo_acceso: true,
          unidad: { include: { inmueble: true } },
          inquilino: true,
        },
      });
    } catch (error) {
      await this.eliminarPdfContrato(pdfContratoUrl);
      this.logger.error(
        `No fue posible generar o guardar el PDF del contrato ${contratoConfirmado.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return contratoConfirmado;
    }
  }

  async solicitarTerminacionAnticipada(
    id: string,
    arrendadorId: string,
    motivo: string,
  ) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    if (contrato.estado !== EstadoContrato.ACTIVO) {
      throw new ConflictException(
        'Solo un contrato activo puede solicitar terminación anticipada.',
      );
    }

    if (contrato.terminacionAnticipadaSolicitada) {
      throw new ConflictException(
        'Este contrato ya tiene una solicitud de terminación anticipada pendiente.',
      );
    }

    return this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        terminacionAnticipadaSolicitada: true,
        terminacionAnticipadaSolicitadaPor: RolSolicitante.ARRENDADOR,
        terminacionAnticipadaSolicitadaEn: new Date(),
        terminacionAnticipadaMotivo: motivo,
      },
    });
  }

  async confirmarTerminacionAnticipada(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
    });

    if (!contrato) {
      throw new NotFoundException('Contrato no encontrado.');
    }

    if (!contrato.terminacionAnticipadaSolicitada) {
      throw new ConflictException(
        'No hay una solicitud de terminación anticipada pendiente para confirmar.',
      );
    }

    return this.prisma.contrato.update({
      where: { id: contrato.id },
      data: {
        estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
        terminacionAnticipadaConfirmadaEn: new Date(),
      },
    });
  }
}
