import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EstadoContrato } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  errorCodigoNoValido,
  VinculacionContratoService,
} from '../contrato/vinculacion-contrato.service';
import { CompletarRegistroInquilinoDto } from './dto/completar-registro-inquilino.dto';
import { LoginArrendadorDto } from './dto/login-arrendador.dto';
import { LoginInquilinoDto } from './dto/login-inquilino.dto';
import { RegistroArrendadorDto } from './dto/registro-arrendador.dto';
import { RespuestaValidarCodigoDto } from './dto/respuesta-validar-codigo.dto';
import { ValidarCodigoAccesoDto } from './dto/validar-codigo-acceso.dto';

const MENSAJE_INICIA_SESION =
  'Inicia sesión y agrega este código desde la app.';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly vinculacion: VinculacionContratoService,
  ) {}

  async registrarArrendador(dto: RegistroArrendadorDto) {
    const arrendadorExistente = await this.prisma.arrendador.findUnique({
      where: { correo: dto.correo },
    });

    if (arrendadorExistente) {
      throw new ConflictException('El correo ya está registrado.');
    }

    const contrasena_hash = await bcrypt.hash(dto.contrasena, 10);
    const arrendador = await this.prisma.arrendador.create({
      data: {
        nombre: dto.nombre,
        correo: dto.correo,
        telefono: dto.telefono,
        contrasena_hash,
      },
    });

    return this.crearRespuestaAutenticacion(arrendador);
  }

  async iniciarSesionArrendador(dto: LoginArrendadorDto) {
    const arrendador = await this.prisma.arrendador.findUnique({
      where: { correo: dto.correo },
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
      contrato: { estado: EstadoContrato; vinculado_en: Date | null };
    } | null,
  ): boolean {
    return (
      codigoAcceso !== null &&
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

  async validarCodigoAccesoInquilino(
    dto: ValidarCodigoAccesoDto,
  ): Promise<RespuestaValidarCodigoDto> {
    const codigoAcceso = await this.prisma.codigoAcceso.findUnique({
      where: { codigo: dto.codigo },
      select: {
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
  async completarRegistroInquilino(dto: CompletarRegistroInquilinoDto) {
    const contrasena_hash = await bcrypt.hash(dto.contrasena, 10);

    const inquilino = await this.prisma.$transaction(async (tx) => {
      const codigoAcceso = await tx.codigoAcceso.findUnique({
        where: { codigo: dto.codigo },
        select: {
          contrato_id: true,
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

      const inquilinoConCorreo = await tx.inquilino.findUnique({
        where: { correo: dto.correo },
        select: { id: true },
      });
      if (
        inquilinoConCorreo &&
        inquilinoConCorreo.id !== codigoAcceso.inquilino.id
      ) {
        throw new ConflictException('El correo ya está en uso.');
      }

      // Escritura condicionada: dos registros simultáneos con el mismo código
      // no pueden crear la cuenta dos veces.
      const cuenta = await tx.inquilino.updateMany({
        where: {
          id: codigoAcceso.inquilino.id,
          correo: null,
          contrasena_hash: null,
        },
        data: { correo: dto.correo, contrasena_hash },
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
      where: { correo: dto.correo },
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

  private crearRespuestaAutenticacion(arrendador: {
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
        foto_cedula_nit_url: arrendador.foto_cedula_nit_url,
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
