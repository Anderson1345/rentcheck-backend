import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CompletarRegistroInquilinoDto } from './dto/completar-registro-inquilino.dto';
import { LoginInquilinoDto } from './dto/login-inquilino.dto';
import { RespuestaValidarCodigoDto } from './dto/respuesta-validar-codigo.dto';
import { ValidarCodigoAccesoDto } from './dto/validar-codigo-acceso.dto';

@ApiTags('Autenticación de Inquilino')
@Controller('auth/inquilino')
export class InquilinoAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('validar-codigo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Validar un código de acceso de inquilino' })
  @ApiBody({ type: ValidarCodigoAccesoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    type: RespuestaValidarCodigoDto,
    description:
      'Código utilizable. Sin cuenta: datos del contrato para continuar el registro. Con cuenta: requiere_inicio_sesion (sin nombre).',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description:
      'Código de acceso no válido (inexistente, ya usado o de un contrato cancelado; no se distingue).',
  })
  validarCodigo(@Body() dto: ValidarCodigoAccesoDto) {
    return this.authService.validarCodigoAccesoInquilino(dto);
  }

  @Post('completar-registro')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Completar el registro de un inquilino' })
  @ApiBody({ type: CompletarRegistroInquilinoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Registro completado correctamente.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Código de acceso no válido o ya usado.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'REQUIERE_INICIO_SESION (la persona ya tiene cuenta) o el correo ya está en uso.',
  })
  completarRegistro(@Body() dto: CompletarRegistroInquilinoDto) {
    return this.authService.completarRegistroInquilino(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Iniciar sesión como inquilino' })
  @ApiBody({ type: LoginInquilinoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inicio de sesión correcto.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Credenciales inválidas.',
  })
  iniciarSesion(@Body() dto: LoginInquilinoDto) {
    return this.authService.iniciarSesionInquilino(dto);
  }
}
