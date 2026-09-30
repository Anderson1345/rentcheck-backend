import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RecuperarContrasenaDto } from './dto/recuperar-contrasena.dto';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto';
import { RecuperacionContrasenaService } from './recuperacion-contrasena.service';

@ApiTags('Recuperación de contraseña')
@Controller('auth')
export class RecuperacionContrasenaController {
  constructor(private readonly recuperacion: RecuperacionContrasenaService) {}

  @Post('recuperar-contrasena')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Pedir un código para restablecer la contraseña',
    description:
      'Siempre responde 202 con el mismo cuerpo: no revela si el correo existe, si la cuenta está verificada ni si el envío está en espera (60 s entre envíos, máximo 5 por hora). Solo envía si el correo es de una cuenta con contraseña (arrendador o inquilino con cuenta); un código nuevo invalida el anterior de recuperación.',
  })
  @ApiBody({ type: RecuperarContrasenaDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Solicitud recibida (mismo cuerpo siempre).',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'CORREO_NO_DISPONIBLE: no hay proveedor de correo configurado.',
  })
  recuperar(@Body() dto: RecuperarContrasenaDto) {
    return this.recuperacion.solicitar(dto);
  }

  @Post('restablecer-contrasena')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Restablecer la contraseña con el código recibido por correo',
    description:
      'Cambia la contraseña (mismas reglas del registro: mínimo 8 caracteres con al menos una letra y un número; si no las cumple responde 400 VALIDACION sin gastar el código) y, como el código llegó al correo, marca el correo como verificado si aún no lo estaba: la cuenta puede iniciar sesión aunque nunca hubiera verificado. El código vale 10 minutos, admite 5 intentos y se consume al usarse. Cualquier fallo (equivocado, vencido, consumido, correo desconocido, cuenta inexistente o un código de otro propósito) responde el mismo 400 CODIGO_INVALIDO. Envía un aviso de cambio de contraseña al correo. LÍMITE CONOCIDO: no invalida las sesiones abiertas; un token ya emitido sigue valiendo hasta que expire (el cierre de sesión en todos los dispositivos llega con el refresh token, B0.5).',
  })
  @ApiBody({ type: RestablecerContrasenaDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '{ contrasena_actualizada: true }',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'CODIGO_INVALIDO, o VALIDACION si la contraseña nueva no cumple las reglas o el cuerpo está mal formado.',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description:
      'DEMASIADOS_INTENTOS: 5 códigos inválidos seguidos desde el mismo origen bloquean 15 minutos.',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'CORREO_NO_DISPONIBLE: no hay proveedor de correo configurado.',
  })
  restablecer(@Body() dto: RestablecerContrasenaDto, @Ip() ip: string) {
    return this.recuperacion.restablecer(dto, ip);
  }
}
