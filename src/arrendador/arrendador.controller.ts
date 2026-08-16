import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrendadorActual,
  ArrendadorGuard,
  JwtAuthGuard,
} from '../auth/auth.module';
import { ArrendadorService } from './arrendador.service';
import { ActualizarPerfilArrendadorDto } from './dto/actualizar-perfil-arrendador.dto';

@ApiTags('Arrendadores')
@Controller('arrendadores')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class ArrendadorController {
  constructor(private readonly arrendadorService: ArrendadorService) {}

  @Get('perfil')
  @ApiOperation({ summary: 'Obtener el perfil del arrendador autenticado' })
  @ApiOkResponse({
    description:
      'Datos del arrendador: nombre, correo, telefono, cedula y foto de cedula/NIT.',
  })
  @ApiNotFoundResponse({ description: 'Arrendador no encontrado.' })
  async verPerfil(@ArrendadorActual() arrendadorId: string) {
    const perfil = await this.arrendadorService.verPerfil(arrendadorId);
    if (!perfil) {
      throw new NotFoundException('Arrendador no encontrado.');
    }
    return perfil;
  }

  @Patch('perfil')
  @ApiOperation({
    summary: 'Actualizar el perfil del arrendador autenticado',
    description:
      'Actualiza solo los campos recibidos (nombre, telefono, cedula). No permite cambiar el correo ni la contraseña.',
  })
  @ApiOkResponse({
    description: 'Arrendador actualizado sin contrasena_hash.',
  })
  @ApiNotFoundResponse({ description: 'Arrendador no encontrado.' })
  actualizarPerfil(
    @Body() dto: ActualizarPerfilArrendadorDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.arrendadorService.actualizarPerfil(arrendadorId, dto);
  }
}
