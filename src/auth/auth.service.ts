import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { CompletarRegistroInquilinoDto } from "./dto/completar-registro-inquilino.dto";
import { LoginArrendadorDto } from "./dto/login-arrendador.dto";
import { LoginInquilinoDto } from "./dto/login-inquilino.dto";
import { RegistroArrendadorDto } from "./dto/registro-arrendador.dto";
import { ValidarCodigoAccesoDto } from "./dto/validar-codigo-acceso.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async registrarArrendador(dto: RegistroArrendadorDto) {
    const arrendadorExistente = await this.prisma.arrendador.findUnique({
      where: { correo: dto.correo },
    });

    if (arrendadorExistente) {
      throw new ConflictException("El correo ya está registrado.");
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
      throw new UnauthorizedException("Credenciales inválidas.");
    }

    const contrasenaCoincide = await bcrypt.compare(
      dto.contrasena,
      arrendador.contrasena_hash,
    );

    if (!contrasenaCoincide) {
      throw new UnauthorizedException("Credenciales inválidas.");
    }

    return this.crearRespuestaAutenticacion(arrendador);
  }

  async validarCodigoAccesoInquilino(dto: ValidarCodigoAccesoDto) {
    const codigoAcceso = await this.prisma.codigoAcceso.findUnique({
      where: { codigo: dto.codigo },
      include: {
        inquilino: true,
        unidad: { include: { inmueble: true } },
        contrato: true,
      },
    });

    if (!codigoAcceso) {
      throw new NotFoundException("Código de acceso no válido");
    }

    if (
      codigoAcceso.inquilino.correo !== null &&
      codigoAcceso.inquilino.contrasena_hash !== null
    ) {
      throw new ConflictException(
        "Esta cuenta ya fue activada. Inicie sesión con correo y contraseña.",
      );
    }

    return {
      inquilinoId: codigoAcceso.inquilino.id,
      nombreInquilino: codigoAcceso.inquilino.nombre,
      nombreUnidad: codigoAcceso.unidad.nombre,
      direccionInmueble: codigoAcceso.unidad.inmueble.direccion,
      mensaje: "Puede continuar completando su registro.",
    };
  }

  async completarRegistroInquilino(dto: CompletarRegistroInquilinoDto) {
    const codigoAcceso = await this.prisma.codigoAcceso.findUnique({
      where: { codigo: dto.codigo },
      include: { inquilino: true },
    });

    if (!codigoAcceso) {
      throw new NotFoundException("Código de acceso no válido");
    }

    if (
      codigoAcceso.inquilino.correo !== null &&
      codigoAcceso.inquilino.contrasena_hash !== null
    ) {
      throw new ConflictException("Esta cuenta ya fue activada.");
    }

    const inquilinoConCorreo = await this.prisma.inquilino.findUnique({
      where: { correo: dto.correo },
    });

    if (inquilinoConCorreo && inquilinoConCorreo.id !== codigoAcceso.inquilino.id) {
      throw new ConflictException("El correo ya está en uso.");
    }

    const contrasena_hash = await bcrypt.hash(dto.contrasena, 10);
    const inquilino = await this.prisma.inquilino.update({
      where: { id: codigoAcceso.inquilino.id },
      data: {
        correo: dto.correo,
        contrasena_hash,
        foto_cedula_url: dto.foto_cedula_url,
      },
    });

    return this.crearRespuestaAutenticacionInquilino(inquilino);
  }

  async iniciarSesionInquilino(dto: LoginInquilinoDto) {
    const inquilino = await this.prisma.inquilino.findUnique({
      where: { correo: dto.correo },
    });

    if (!inquilino || !inquilino.contrasena_hash) {
      throw new UnauthorizedException("Credenciales inválidas.");
    }

    const contrasenaCoincide = await bcrypt.compare(
      dto.contrasena,
      inquilino.contrasena_hash,
    );

    if (!contrasenaCoincide) {
      throw new UnauthorizedException("Credenciales inválidas.");
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
    foto_cedula_url: string | null;
    creado_en: Date;
  }) {
    return {
      access_token: this.jwtService.sign({ inquilinoId: inquilino.id }),
      inquilino: {
        id: inquilino.id,
        nombre: inquilino.nombre,
        correo: inquilino.correo,
        telefono: inquilino.telefono,
        foto_cedula_url: inquilino.foto_cedula_url,
        creado_en: inquilino.creado_en,
      },
    };
  }
}
