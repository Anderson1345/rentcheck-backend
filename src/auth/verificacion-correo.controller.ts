import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReenviarVerificacionDto } from './dto/reenviar-verificacion.dto';
import { VerificarCorreoDto } from './dto/verificar-correo.dto';
import { VerificacionCorreoService } from './verificacion-correo.service';

@ApiTags('Verificación de correo')
@Controller('auth')
export class VerificacionCorreoController {
  constructor(private readonly verificacion: VerificacionCorreoService) {}

  @Get('capacidades')
  @ApiOperation({
    summary: 'Qué funciones dependen del proveedor de correo',
    description:
      'Ambas son true solo si hay un proveedor configurado (CORREO_PROVEEDOR distinto de desactivado). La recuperación de contraseña se implementa en B0.4-D2; aquí solo se reporta el mismo valor.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      '{ verificacion_correo: boolean, recuperacion_contrasena: boolean }',
  })
  capacidades() {
    return this.verificacion.capacidades();
  }

  @Post('reenviar-verificacion')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Reenviar el código de verificación del correo',
    description:
      'Siempre responde 202 con el mismo cuerpo: no revela si el correo existe, si ya está verificado ni si el envío está en espera (60 s entre envíos, máximo 5 por hora). Solo envía si el correo es de una cuenta (arrendador o inquilino) sin verificar; un envío nuevo invalida el código anterior.',
  })
  @ApiBody({ type: ReenviarVerificacionDto })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Solicitud recibida (mismo cuerpo siempre).',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'CORREO_NO_DISPONIBLE: no hay proveedor de correo configurado.',
  })
  reenviar(@Body() dto: ReenviarVerificacionDto) {
    return this.verificacion.reenviar(dto);
  }

  @Post('verificar-correo')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: 'Verificar el correo con el código de 6 dígitos',
    description:
      'Marca el correo como verificado en la tabla que corresponda (arrendador o inquilino). El código vale 10 minutos, admite 5 intentos y se consume al usarse. Cualquier fallo (equivocado, vencido, consumido, correo desconocido o ya verificado) responde el mismo 400 CODIGO_INVALIDO.',
  })
  @ApiBody({ type: VerificarCorreoDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: '{ correo_verificado: true }',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'CODIGO_INVALIDO (o VALIDACION si el cuerpo no tiene la forma esperada).',
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
  verificar(@Body() dto: VerificarCorreoDto, @Ip() ip: string) {
    return this.verificacion.verificar(dto, ip);
  }
}
