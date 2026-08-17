import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CompletarRegistroInquilinoDto } from './dto/completar-registro-inquilino.dto';
import { LoginInquilinoDto } from './dto/login-inquilino.dto';
import { ValidarCodigoAccesoDto } from './dto/validar-codigo-acceso.dto';

@ApiTags('Autenticación de Inquilino')
@Controller('auth/inquilino')
export class InquilinoAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('validar-codigo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar un código de acceso de inquilino' })
  @ApiBody({ type: ValidarCodigoAccesoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Código válido; el inquilino puede continuar su registro.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Código de acceso no válido.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'La cuenta ya fue activada; debe iniciar sesión con correo y contraseña.',
  })
  validarCodigo(@Body() dto: ValidarCodigoAccesoDto) {
    return this.authService.validarCodigoAccesoInquilino(dto);
  }

  @Post('completar-registro')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Completar el registro de un inquilino' })
  @ApiBody({ type: CompletarRegistroInquilinoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Registro completado correctamente.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Código de acceso no válido.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'La cuenta ya fue activada o el correo ya está en uso.',
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
