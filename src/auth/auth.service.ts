import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoContrato, Prisma } from '@prisma/client';
import { normalizarCorreo } from '../common/utils/normalizar-correo';
import * as bcrypt from 'bcrypt';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { firmarFotoOpcional } from '../common/foto-perfil';
import { PrismaService } from '../prisma/prisma.service';
import { errorCodigoNoValido } from '../contrato/codigo-no-valido.exception';
import { IntentosCodigoService } from '../contrato/intentos-codigo.service';
import { VinculacionContratoService } from '../contrato/vinculacion-contrato.service';
import { CompletarRegistroInquilinoDto } from './dto/completar-registro-inquilino.dto';
import { LoginArrendadorDto } from './dto/login-arrendador.dto';
import { LoginInquilinoDto } from './dto/login-inquilino.dto';
import { RegistroArrendadorDto } from './dto/registro-arrendador.dto';
import { RespuestaValidarCodigoDto } from './dto/respuesta-validar-codigo.dto';
import { ValidarCodigoAccesoDto } from './dto/validar-codigo-acceso.dto';

const MENSAJE_INICIA_SESION =
  'Inicia sesión y agrega este código desde la app.';

/** Mismo texto (y mismo 409) para arrendador e inquilino, sin distinguir tabla. */
const MENSAJE_REGISTRO_NO_COMPLETADO =
  'No fue posible completar el registro con esos datos. Si ya tienes cuenta, inicia sesión.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly jwtService: JwtService,
    private readonly vinculacion: VinculacionContratoService,
    private readonly intentos: IntentosCodigoService,
  ) {}

  /** ¿El correo (ya normalizado) está en Arrendador o en Inquilino? */
  private async correoYaRegistrado(
    cliente: Pick<Prisma.TransactionClient, 'arrendador' | 'inquilino'>,
    correo: string,
    excluirInquilinoId?: string,
  ): Promise<boolean> {
    const [arrendador, inquilino] = await Promise.all([
      cliente.arrendador.findUnique({
        where: { correo },
        select: { id: true },
      }),
      cliente.inquilino.findUnique({ where: { correo }, select: { id: true } }),
    ]);
    return (
      arrendador !== null ||
      (inquilino !== null && inquilino.id !== excluirInquilinoId)
    );
  }

  async registrarArrendador(dto: RegistroArrendadorDto) {
    const correo = normalizarCorreo(dto.correo);
    // Se verifican las dos tablas; el mensaje no dice en cuál está.
    if (await this.correoYaRegistrado(this.prisma, correo)) {
      throw new ConflictException(MENSAJE_REGISTRO_NO_COMPLETADO);
    }

    const contrasena_hash = await bcrypt.hash(dto.contrasena, 10);
    try {
      const arrendador = await this.prisma.arrendador.create({
        data: {
          nombre: dto.nombre,
          correo,
          telefono: dto.telefono,
          contrasena_hash,
        },
      });
      return this.crearRespuestaAutenticacion(arrendador);
    } catch (error) {
      // Carrera: otro registro con el mismo correo entre la verificación y la escritura.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(MENSAJE_REGISTRO_NO_COMPLETADO);
      }
      throw error;
    }
  }

  async iniciarSesionArrendador(dto: LoginArrendadorDto) {
    const arrendador = await this.prisma.arrendador.findUnique({
      where: { correo: normalizarCorreo(dto.correo) },
    });

    if (!arrendador) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const contrasenaCoincide = await bcrypt.compare(
      dto.contrasena,
      arrendador.contrasena_hash,
    );

    if (!contrasenaCoincide) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.crearRespuestaAutenticacion(arrendador);
  }

  /**
   * Código utilizable para vincular: existe, su contrato no está CANCELADO y
   * todavía no se usó (`vinculado_en` nulo). Cualquier otro caso recibe la
   * misma respuesta, sin distinguir causas. Un contrato PROGRAMADO sí vincula.
   */
  private codigoUtilizable(
    codigoAcceso: {
      expira_en: Date;
      contrato: { estado: EstadoContrato; vinculado_en: Date | null };
    } | null,
  ): boolean {
    return (
      codigoAcceso !== null &&
      codigoAcceso.expira_en.getTime() > Date.now() &&
      codigoAcceso.contrato.estado !== EstadoContrato.CANCELADO &&
      codigoAcceso.contrato.vinculado_en === null
    );
  }

  private tieneCuenta(inquilino: {
    correo: string | null;
    contrasena_hash: string | null;
  }): boolean {
    return inquilino.correo !== null && inquilino.contrasena_hash !== null;
  }

  validarCodigoAccesoInquilino(
    dto: ValidarCodigoAccesoDto,
    ip: string,
  ): Promise<RespuestaValidarCodigoDto> {
    return this.intentos.ejecutar(ip, () => this.validarSinBloqueo(dto));
  }

  private async validarSinBloqueo(
    dto: ValidarCodigoAccesoDto,
  ): Promise<RespuestaValidarCodigoDto> {
    const codigoAcceso = await this.prisma.codigoAcceso.findUnique({
      where: { codigo: dto.codigo },
      select: {
        expira_en: true,
        inquilino: { select: { correo: true, contrasena_hash: true } },
        contrato: {
          select: {
            estado: true,
            vinculado_en: true,
            // Lo que escribió el arrendador, nunca el nombre global.
            inquilino_nombre: true,
          },
        },
        unidad: {
          select: { nombre: true, inmueble: { select: { direccion: true } } },
        },
      },
    });

    if (!codigoAcceso || !this.codigoUtilizable(codigoAcceso)) {
      throw errorCodigoNoValido();
    }

    if (this.tieneCuenta(codigoAcceso.inquilino)) {
      return {
        requiere_inicio_sesion: true,
        mensaje: MENSAJE_INICIA_SESION,
      };
    }

    return {
      requiere_inicio_sesion: false,
      nombreInquilino: codigoAcceso.contrato.inquilino_nombre,
      nombreUnidad: codigoAcceso.unidad.nombre,
      direccionInmueble: codigoAcceso.unidad.inmueble.direccion,
      mensaje: 'Puede continuar completando su registro.',
    };
  }

  /**
   * Crea la cuenta y vincula el contrato en UNA transacción: si algo falla
   * no queda cuenta ni vínculo. Un código no se puede usar dos veces.
   */
  completarRegistroInquilino(dto: CompletarRegistroInquilinoDto, ip: string) {
    return this.intentos.ejecutar(ip, () => this.completarSinBloqueo(dto));
  }

  private async completarSinBloqueo(dto: CompletarRegistroInquilinoDto) {
    const correo = normalizarCorreo(dto.correo);
    const contrasena_hash = await bcrypt.hash(dto.contrasena, 10);

    const inquilino = await this.prisma.$transaction(async (tx) => {
      const codigoAcceso = await tx.codigoAcceso.findUnique({
        where: { codigo: dto.codigo },
        select: {
          contrato_id: true,
          expira_en: true,
          inquilino: {
            select: { id: true, correo: true, contrasena_hash: true },
          },
          contrato: { select: { estado: true, vinculado_en: true } },
        },
      });

      if (!codigoAcceso || !this.codigoUtilizable(codigoAcceso)) {
        throw errorCodigoNoValido();
      }
      if (this.tieneCuenta(codigoAcceso.inquilino)) {
        throw new ConflictException({
          codigo: 'REQUIERE_INICIO_SESION',
          mensaje: MENSAJE_INICIA_SESION,
        });
      }

      // Las dos tablas, con un mensaje que no revela dónde existe el correo.
      if (
        await this.correoYaRegistrado(tx, correo, codigoAcceso.inquilino.id)
      ) {
        throw new ConflictException(MENSAJE_REGISTRO_NO_COMPLETADO);
      }

      // Escritura condicionada: dos registros simultáneos con el mismo código
      // no pueden crear la cuenta dos veces.
      const cuenta = await tx.inquilino.updateMany({
        where: {
          id: codigoAcceso.inquilino.id,
          correo: null,
          contrasena_hash: null,
        },
        data: { correo, contrasena_hash },
      });
      if (cuenta.count === 0) {
        throw new ConflictException({
          codigo: 'REQUIERE_INICIO_SESION',
          mensaje: MENSAJE_INICIA_SESION,
        });
      }

      const vinculado = await this.vinculacion.vincularEnTransaccion(
        tx,
        codigoAcceso.contrato_id,
      );
      if (!vinculado) {
        throw errorCodigoNoValido();
      }

      return tx.inquilino.findUniqueOrThrow({
        where: { id: codigoAcceso.inquilino.id },
      });
    });

    return this.crearRespuestaAutenticacionInquilino(inquilino);
  }

  async iniciarSesionInquilino(dto: LoginInquilinoDto) {
    const inquilino = await this.prisma.inquilino.findUnique({
      where: { correo: normalizarCorreo(dto.correo) },
    });

    if (!inquilino || !inquilino.contrasena_hash) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const contrasenaCoincide = await bcrypt.compare(
      dto.contrasena,
      inquilino.contrasena_hash,
    );

    if (!contrasenaCoincide) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.crearRespuestaAutenticacionInquilino(inquilino);
  }

  private async crearRespuestaAutenticacion(arrendador: {
    id: string;
    nombre: string;
    correo: string;
    telefono: string;
    foto_cedula_nit_url: string | null;
    creado_en: Date;
  }) {
    return {
      access_token: this.jwtService.sign({ id: arrendador.id }),
      arrendador: {
        id: arrendador.id,
        nombre: arrendador.nombre,
        correo: arrendador.correo,
        telefono: arrendador.telefono,
        // Nunca la ruta interna: URL firmada (null si no hay foto o falla la firma).
        foto_cedula_nit_url: await firmarFotoOpcional(
          this.almacenamiento,
          arrendador.foto_cedula_nit_url,
          `arrendadores/${arrendador.id}/`,
          this.logger,
        ),
        creado_en: arrendador.creado_en,
      },
    };
  }

  private crearRespuestaAutenticacionInquilino(inquilino: {
    id: string;
    nombre: string;
    correo: string | null;
    telefono: string;
    creado_en: Date;
  }) {
    return {
      access_token: this.jwtService.sign({ inquilinoId: inquilino.id }),
      inquilino: {
        id: inquilino.id,
        nombre: inquilino.nombre,
        correo: inquilino.correo,
        telefono: inquilino.telefono,
        creado_en: inquilino.creado_en,
      },
    };
  }
}
