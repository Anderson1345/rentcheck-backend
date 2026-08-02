import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { LoginArrendadorDto } from "./dto/login-arrendador.dto";
import { RegistroArrendadorDto } from "./dto/registro-arrendador.dto";

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
}
