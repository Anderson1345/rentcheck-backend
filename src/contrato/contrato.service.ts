import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoContrato,
  Prisma,
  RolSolicitante,
  TipoPlantillaContrato,
} from '@prisma/client';
import { randomInt } from 'crypto';
import PDFDocument from 'pdfkit';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PrismaService } from '../prisma/prisma.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

const SELECT_INMUEBLE_RESUMEN = {
  id: true,
  direccion: true,
  ciudad: true,
  estrato: true,
  matricula_inmobiliaria: true,
  creado_en: true,
} as const satisfies Prisma.InmuebleSelect;

const SELECT_INQUILINO_RESUMEN = {
  id: true,
  nombre: true,
  cedula: true,
  telefono: true,
} as const satisfies Prisma.InquilinoSelect;

const SELECT_ARRENDADOR_RESUMEN_PDF = {
  nombre: true,
  cedula: true,
} as const satisfies Prisma.ArrendadorSelect;

const SELECT_CONTRATO_PARA_PDF = {
  id: true,
  estado: true,
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
  unidad: {
    select: {
      nombre: true,
      inmueble: { select: { direccion: true, ciudad: true } },
    },
  },
  inquilino: { select: { nombre: true, cedula: true } },
  arrendador: { select: SELECT_ARRENDADOR_RESUMEN_PDF },
} as const satisfies Prisma.ContratoSelect;

type ContratoParaPdf = Prisma.ContratoGetPayload<{
  select: typeof SELECT_CONTRATO_PARA_PDF;
}>;

const PLANTILLA_VIVIENDA_URBANA_LEY_820 = `CONTRATO DE ARRENDAMIENTO DE VIVIENDA URBANA

Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de vivienda urbana, el cual se regirá por la Ley 820 de 2003 y demás normas concordantes, y por las siguientes cláusulas:

PRIMERA — OBJETO. EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el inmueble ubicado en {{unidad_direccion_completa}}, para ser destinado exclusivamente a vivienda.

SEGUNDA — CANON DE ARRENDAMIENTO. El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado dentro de los primeros {{dia_pago}} días de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.

TERCERA — TÉRMINO. El presente contrato tendrá una duración de un (1) año, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}, prorrogable en los términos previstos por la Ley 820 de 2003.

CUARTA — DEPÓSITO. EL ARRENDATARIO entrega en este acto a EL ARRENDADOR, a título de depósito en garantía, la suma de {{deposito_en_pesos}}, la cual será restituida al finalizar el contrato, previa verificación del estado del inmueble y de que no existan sumas pendientes por concepto de cánones, servicios públicos o daños imputables a EL ARRENDATARIO.

QUINTA — DESTINACIÓN Y USO. EL ARRENDATARIO se obliga a destinar el inmueble única y exclusivamente para vivienda, sin poder darle un uso distinto, ni subarrendarlo total o parcialmente sin autorización previa y escrita de EL ARRENDADOR.

SEXTA — ESTADO DEL INMUEBLE. EL ARRENDATARIO declara recibir el inmueble en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.

SÉPTIMA — SERVICIOS PÚBLICOS. Los servicios públicos domiciliarios del inmueble serán asumidos por EL ARRENDATARIO, salvo que las condiciones particulares de este contrato indiquen algo distinto.

OCTAVA — CAUSALES DE TERMINACIÓN. Además de las causales previstas en la Ley 820 de 2003, dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del inmueble para un fin distinto al pactado, y el subarriendo no autorizado.`;

const PLANTILLA_LOCAL_COMERCIAL = `CONTRATO DE ARRENDAMIENTO DE LOCAL COMERCIAL

Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de local comercial, regido por las disposiciones del Código de Comercio colombiano en lo relativo al arrendamiento de establecimientos y locales de comercio, y por las siguientes cláusulas:

PRIMERA — OBJETO. EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el inmueble de uso comercial ubicado en {{unidad_direccion_completa}}.

SEGUNDA — CANON DE ARRENDAMIENTO. El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado dentro de los primeros {{dia_pago}} días de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.

TERCERA — TÉRMINO. El presente contrato tendrá una duración de un (1) año, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}.

CUARTA — DEPÓSITO. EL ARRENDATARIO entrega en este acto a EL ARRENDADOR, a título de depósito en garantía, la suma de {{deposito_en_pesos}}, la cual será restituida al finalizar el contrato, previa verificación del estado del inmueble y de que no existan sumas pendientes por concepto de cánones, servicios públicos o daños imputables a EL ARRENDATARIO.

QUINTA — DESTINACIÓN Y USO. EL ARRENDATARIO se obliga a destinar el inmueble exclusivamente a la actividad comercial descrita en las condiciones particulares de este contrato, sin poder cambiarla ni subarrendar el local total o parcialmente sin autorización previa y escrita de EL ARRENDADOR.

SEXTA — ESTADO DEL INMUEBLE. EL ARRENDATARIO declara recibir el inmueble en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.

SÉPTIMA — LICENCIAS Y PERMISOS. La obtención de las licencias, permisos y registros necesarios para el funcionamiento de la actividad comercial de EL ARRENDATARIO corren por cuenta exclusiva de este, sin que ello sea responsabilidad de EL ARRENDADOR.

OCTAVA — CAUSALES DE TERMINACIÓN. Dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del inmueble para una actividad distinta a la pactada, y el subarriendo no autorizado.`;

const PLANTILLA_PARQUEADERO = `CONTRATO DE ARRENDAMIENTO DE PARQUEADERO

Entre los suscritos, {{arrendador_nombre}}, identificado(a) con cédula de ciudadanía No. {{arrendador_cedula}}, quien en adelante se denominará EL ARRENDADOR, y {{inquilino_nombre}}, identificado(a) con cédula de ciudadanía No. {{inquilino_cedula}}, quien en adelante se denominará EL ARRENDATARIO, hemos convenido celebrar el presente contrato de arrendamiento de espacio de parqueadero, regido por las disposiciones generales del Código Civil colombiano en materia de arrendamiento, y por las siguientes cláusulas:

PRIMERA — OBJETO. EL ARRENDADOR entrega a título de arrendamiento a EL ARRENDATARIO el espacio de parqueadero identificado como {{unidad_direccion_completa}}, para uso exclusivo de estacionamiento de un (1) vehículo.

SEGUNDA — CANON DE ARRENDAMIENTO. El canon mensual de arrendamiento es de {{canon_en_pesos}}, pagadero por mes anticipado dentro de los primeros {{dia_pago}} días de cada mes, mediante {{forma_pago}}, a través de: {{datos_recaudo}}.

TERCERA — TÉRMINO. El presente contrato tendrá una duración de un (1) año, contado a partir del {{fecha_inicio}} hasta el {{fecha_fin}}.

CUARTA — DEPÓSITO. EL ARRENDATARIO entrega en este acto a EL ARRENDADOR, a título de depósito en garantía, la suma de {{deposito_en_pesos}}, la cual será restituida al finalizar el contrato, previa verificación del estado del espacio y de que no existan sumas pendientes por concepto de cánones o daños imputables a EL ARRENDATARIO.

QUINTA — DESTINACIÓN Y USO. EL ARRENDATARIO se obliga a destinar el espacio exclusivamente al estacionamiento de vehículos automotores, sin poder usarlo como bodega, depósito de mercancía, ni subarrendarlo sin autorización previa y escrita de EL ARRENDADOR.

SEXTA — ESTADO DEL ESPACIO. EL ARRENDATARIO declara recibir el espacio en el estado que consta en el inventario fotográfico de entrega anexo a este contrato, y se obliga a restituirlo en las mismas condiciones, salvo el deterioro natural por el uso legítimo del mismo.

SÉPTIMA — RESPONSABILIDAD. EL ARRENDADOR no será responsable por daños, hurto o pérdida de bienes dejados dentro del vehículo estacionado, salvo negligencia grave que le sea directamente imputable.

OCTAVA — CAUSALES DE TERMINACIÓN. Dan lugar a la terminación del contrato el incumplimiento reiterado en el pago del canon, el uso del espacio para un fin distinto al pactado, y el subarriendo no autorizado.`;

const CIERRE_PLANTILLA = `

CONDICIONES PARTICULARES DEL CONTRATO

{{condiciones_particulares_o_texto_por_defecto}}

Para constancia se firma el presente contrato en la ciudad de {{ciudad}}, el día {{fecha_generacion}}.

_______________________________
EL ARRENDADOR — {{arrendador_nombre}}

_______________________________
EL ARRENDATARIO — {{inquilino_nombre}}`;

@Injectable()
export class ContratoService {
  private readonly logger = new Logger(ContratoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  private formatearCentavosAPesos(centavos: number): string {
    return `$${(centavos / 100).toLocaleString('es-CO')}`;
  }

  private obtenerPlantillaBase(tipoPlantilla: TipoPlantillaContrato): string {
    switch (tipoPlantilla) {
      case TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820:
        return PLANTILLA_VIVIENDA_URBANA_LEY_820;
      case TipoPlantillaContrato.LOCAL_COMERCIAL:
        return PLANTILLA_LOCAL_COMERCIAL;
      case TipoPlantillaContrato.PARQUEADERO:
        return PLANTILLA_PARQUEADERO;
    }
  }

  private construirTextoContrato(contrato: ContratoParaPdf): string {
    const arrendadorNombre = contrato.arrendador.nombre;
    const arrendadorCedula =
      contrato.arrendador.cedula?.trim() || '[cédula pendiente de registrar]';
    const inquilinoNombre = contrato.inquilino.nombre;
    const inquilinoCedula = contrato.inquilino.cedula;
    const unidadDireccionCompleta = `${contrato.unidad.inmueble.direccion}, ${contrato.unidad.nombre}`;
    const canonEnPesos = this.formatearCentavosAPesos(contrato.canon_centavos);
    const depositoEnPesos = this.formatearCentavosAPesos(
      contrato.deposito_centavos,
    );
    const diaPago = contrato.dia_pago;
    const formaPago = contrato.forma_pago;
    const datosRecaudo = contrato.datos_recaudo;
    const fechaInicio = contrato.fecha_inicio.toISOString().slice(0, 10);
    const fechaFin = contrato.fecha_fin.toISOString().slice(0, 10);
    const condicionesParticulares =
      contrato.condicionesParticularesTexto?.trim() ||
      'No aplican condiciones particulares adicionales a las aquí pactadas.';
    const ciudad = contrato.unidad.inmueble.ciudad;
    const fechaGeneracion = new Date().toLocaleString('es-CO');

    const datosFiadorOPoliza = contrato.datos_fiador_o_poliza?.trim();

    let texto = this.obtenerPlantillaBase(contrato.tipo_plantilla);

    if (datosFiadorOPoliza) {
      texto += `\nNOVENA — GARANTÍA ADICIONAL. El presente contrato cuenta con la siguiente garantía adicional: {{datos_fiador_o_poliza}}.\n`;
    }

    texto += CIERRE_PLANTILLA;

    return texto
      .split('{{arrendador_nombre}}')
      .join(arrendadorNombre)
      .split('{{arrendador_cedula}}')
      .join(arrendadorCedula)
      .split('{{inquilino_nombre}}')
      .join(inquilinoNombre)
      .split('{{inquilino_cedula}}')
      .join(inquilinoCedula)
      .split('{{unidad_direccion_completa}}')
      .join(unidadDireccionCompleta)
      .split('{{canon_en_pesos}}')
      .join(canonEnPesos)
      .split('{{dia_pago}}')
      .join(String(diaPago))
      .split('{{forma_pago}}')
      .join(formaPago)
      .split('{{datos_recaudo}}')
      .join(datosRecaudo)
      .split('{{deposito_en_pesos}}')
      .join(depositoEnPesos)
      .split('{{fecha_inicio}}')
      .join(fechaInicio)
      .split('{{fecha_fin}}')
      .join(fechaFin)
      .split('{{datos_fiador_o_poliza}}')
      .join(datosFiadorOPoliza ?? '')
      .split('{{condiciones_particulares_o_texto_por_defecto}}')
      .join(condicionesParticulares)
      .split('{{ciudad}}')
      .join(ciudad)
      .split('{{fecha_generacion}}')
      .join(fechaGeneracion);
  }

  private generarPdfContrato(contrato: ContratoParaPdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const documento = new PDFDocument();
      const fragmentos: Buffer[] = [];

      documento.on('data', (fragmento: Buffer) => fragmentos.push(fragmento));
      documento.on('end', () => resolve(Buffer.concat(fragmentos)));
      documento.on('error', reject);

      documento.fontSize(11);
      documento.text(this.construirTextoContrato(contrato));
      documento.end();
    });
  }

  private async eliminarPdfContrato(ruta: string): Promise<void> {
    try {
      await this.almacenamiento.eliminarArchivo(ruta);
    } catch {
      // La limpieza no debe ocultar el error original de la transacción.
    }
  }

  private async exponerUrlFirmada<
    T extends { pdf_contrato_ruta: string | null },
  >(
    contrato: T,
  ): Promise<
    Omit<T, 'pdf_contrato_ruta'> & { pdf_contrato_url: string | null }
  > {
    const { pdf_contrato_ruta, ...resto } = contrato;
    if (!pdf_contrato_ruta) {
      return { ...resto, pdf_contrato_url: null };
    }
    return {
      ...resto,
      pdf_contrato_url:
        await this.almacenamiento.generarUrlFirmada(pdf_contrato_ruta),
    };
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
    const contratos = await this.prisma.contrato.findMany({
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
        codigo_acceso: {
          select: { codigo: true },
        },
      },
      orderBy: { fecha_inicio: 'desc' },
    });

    return Promise.all(contratos.map((c) => this.exponerUrlFirmada(c)));
  }

  async encontrarUno(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      include: {
        unidad: true,
        inquilino: { select: SELECT_INQUILINO_RESUMEN },
        incrementos_ipc: true,
        codigo_acceso: {
          select: { codigo: true },
        },
      },
    });

    return contrato ? this.exponerUrlFirmada(contrato) : null;
  }

  async renovar(id: string, arrendadorId: string) {
    const contrato = await this.prisma.contrato.findFirst({
      where: {
        id,
        unidad: {
          inmueble: { arrendador_id: arrendadorId },
        },
      },
      select: SELECT_CONTRATO_PARA_PDF,
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
    const pdfContratoRuta = `contratos/${contrato.id}/contrato.pdf`;
    let archivoSubido = false;
    try {
      const bufferPdf = await this.generarPdfContrato({
        ...contrato,
        canon_centavos: canonNuevo,
        fecha_fin: nuevaFechaFin,
      });
      await this.almacenamiento.subirArchivo(
        bufferPdf,
        pdfContratoRuta,
        'application/pdf',
        true,
      );
      archivoSubido = true;
      contratoConPdf = await this.prisma.contrato.update({
        where: { id: contrato.id },
        data: { pdf_contrato_ruta: pdfContratoRuta },
      });
    } catch (error) {
      if (archivoSubido) {
        await this.eliminarPdfContrato(pdfContratoRuta);
      }
      this.logger.error(
        `No fue posible regenerar o guardar el PDF del contrato ${contrato.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return {
      contrato: await this.exponerUrlFirmada(contratoConPdf),
      incremento_ipc: incrementoIpc,
    };
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

    let contratoCreado: Prisma.ContratoGetPayload<object> | undefined;

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
                condicionesParticularesTexto: dto.condicionesParticularesTexto,
                fecha_inicio: dto.fecha_inicio,
                fecha_fin: dto.fecha_fin,
                estado: EstadoContrato.ACTIVO,
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

            return contrato;
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

    const pdfContratoRuta = `contratos/${contratoConfirmado.id}/contrato.pdf`;
    let archivoSubido = false;
    try {
      const contratoParaPdf = await this.prisma.contrato.findUniqueOrThrow({
        where: { id: contratoConfirmado.id },
        select: SELECT_CONTRATO_PARA_PDF,
      });

      const bufferPdf = await this.generarPdfContrato(contratoParaPdf);
      await this.almacenamiento.subirArchivo(
        bufferPdf,
        pdfContratoRuta,
        'application/pdf',
        true,
      );
      archivoSubido = true;

      await this.prisma.contrato.update({
        where: { id: contratoConfirmado.id },
        data: { pdf_contrato_ruta: pdfContratoRuta },
      });

      return this.exponerUrlFirmada(
        await this.prisma.contrato.findUniqueOrThrow({
          where: { id: contratoConfirmado.id },
          include: {
            codigo_acceso: true,
            unidad: {
              include: { inmueble: { select: SELECT_INMUEBLE_RESUMEN } },
            },
            inquilino: { select: SELECT_INQUILINO_RESUMEN },
          },
        }),
      );
    } catch (error) {
      if (archivoSubido) {
        await this.eliminarPdfContrato(pdfContratoRuta);
      }
      this.logger.error(
        `No fue posible generar o guardar el PDF del contrato ${contratoConfirmado.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return this.exponerUrlFirmada(
        await this.prisma.contrato.findUniqueOrThrow({
          where: { id: contratoConfirmado.id },
          include: {
            codigo_acceso: true,
            unidad: {
              include: { inmueble: { select: SELECT_INMUEBLE_RESUMEN } },
            },
            inquilino: { select: SELECT_INQUILINO_RESUMEN },
          },
        }),
      );
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
    return this.prisma.$transaction(async (tx) => {
      const contratoExistente = await tx.contrato.findFirst({
        where: {
          id,
          unidad: {
            inmueble: { arrendador_id: arrendadorId },
          },
        },
        select: { estado: true, terminacionAnticipadaSolicitada: true },
      });

      if (!contratoExistente) {
        throw new NotFoundException('Contrato no encontrado.');
      }

      const resultado = await tx.contrato.updateMany({
        where: {
          id,
          unidad: {
            inmueble: { arrendador_id: arrendadorId },
          },
          estado: EstadoContrato.ACTIVO,
          terminacionAnticipadaSolicitada: true,
        },
        data: {
          estado: EstadoContrato.TERMINADO_ANTICIPADAMENTE,
          terminacionAnticipadaConfirmadaEn: new Date(),
        },
      });

      if (resultado.count === 0) {
        if (
          contratoExistente.estado === EstadoContrato.TERMINADO_ANTICIPADAMENTE
        ) {
          throw new ConflictException({
            codigo: 'TERMINACION_YA_CONFIRMADA',
            mensaje: 'La terminación anticipada ya fue confirmada.',
          });
        }
        if (contratoExistente.estado !== EstadoContrato.ACTIVO) {
          throw new ConflictException({
            codigo: 'CONTRATO_NO_ACTIVO',
            mensaje: 'El contrato no está activo.',
          });
        }
        if (!contratoExistente.terminacionAnticipadaSolicitada) {
          throw new ConflictException({
            codigo: 'TERMINACION_NO_SOLICITADA',
            mensaje:
              'No hay una solicitud de terminación anticipada pendiente para confirmar.',
          });
        }
        // El contrato estaba ACTIVO y con solicitud pendiente en la lectura,
        // pero otra petición ya confirmó la terminación entre la lectura y
        // esta escritura condicional.
        throw new ConflictException({
          codigo: 'TERMINACION_YA_CONFIRMADA',
          mensaje: 'La terminación anticipada ya fue confirmada.',
        });
      }

      return tx.contrato.findUniqueOrThrow({ where: { id } });
    });
  }
}
