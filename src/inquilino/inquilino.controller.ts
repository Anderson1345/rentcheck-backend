import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ArrendadorActual, JwtAuthGuard } from '../auth/auth.module';
import { CrearInquilinoDto } from './dto/crear-inquilino.dto';
import { InquilinoService } from './inquilino.service';

@ApiTags('Inquilinos')
@Controller('inquilinos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InquilinoController {
  constructor(private readonly inquilinoService: InquilinoService) {}

  @Post()
  @ApiOperation({ summary: 'Crear la ficha básica de un inquilino' })
  @ApiCreatedResponse({
    description: 'Ficha básica del inquilino creada exitosamente.',
  })
  crear(
    @Body() dto: CrearInquilinoDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.inquilinoService.crear(dto, arrendadorId);
  }
}
