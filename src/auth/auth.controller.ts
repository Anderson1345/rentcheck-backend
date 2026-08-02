import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginArrendadorDto } from './dto/login-arrendador.dto';
import { RegistroArrendadorDto } from './dto/registro-arrendador.dto';

@ApiTags('Autenticación de Arrendador')
@Controller('auth/arrendador')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('registro')
  @ApiOperation({ summary: 'Registrar un Arrendador' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Arrendador registrado correctamente.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'El correo ya está registrado.',
  })
  registrar(@Body() dto: RegistroArrendadorDto) {
    return this.authService.registrarArrendador(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión como Arrendador' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inicio de sesión correcto.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Credenciales inválidas.',
  })
  iniciarSesion(@Body() dto: LoginArrendadorDto) {
    return this.authService.iniciarSesionArrendador(dto);
  }
}
