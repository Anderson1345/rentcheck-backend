import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ArrendadorActual, JwtAuthGuard } from '../auth/auth.module';
import { ContratoService } from './contrato.service';
import { CrearContratoDto } from './dto/crear-contrato.dto';

@ApiTags('Contratos')
@Controller('contratos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ContratoController {
  constructor(private readonly contratoService: ContratoService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un contrato' })
  @ApiCreatedResponse({
    description:
      'Contrato creado exitosamente, incluyendo su código de acceso generado.',
  })
  @ApiNotFoundResponse({
    description: 'La unidad o el inquilino no pertenecen al arrendador.',
  })
  @ApiConflictResponse({
    description: 'La unidad ya tiene un contrato activo.',
  })
  crear(
    @Body() dto: CrearContratoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.contratoService.crear(dto, arrendadorId);
  }
}
