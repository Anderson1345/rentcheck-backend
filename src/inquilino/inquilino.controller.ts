import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
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
import { ParseIdPipe } from '../common/pipes/parse-id.pipe';
import { InquilinoService } from './inquilino.service';

@ApiTags('Inquilinos')
@Controller('inquilinos')
@UseGuards(JwtAuthGuard, ArrendadorGuard)
@ApiBearerAuth()
export class InquilinoController {
  constructor(private readonly inquilinoService: InquilinoService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar los inquilinos del arrendador autenticado',
    description:
      'Personas con las que tiene contrato (datos de la copia del contrato, una fila por persona) más sus fichas sueltas de POST /inquilinos. Nunca incluye el correo.',
  })
  @ApiOkResponse({ description: 'Lista de inquilinos del arrendador.' })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.inquilinoService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener un inquilino por ID',
    description:
      'Devuelve los datos que el arrendador escribió (copia del contrato); 404 si no tiene relación con esa persona.',
  })
  @ApiOkResponse({ description: 'Inquilino encontrado.' })
  @ApiNotFoundResponse({
    description: 'Inquilino no encontrado o no pertenece al arrendador.',
  })
  async encontrarUno(
    @Param('id', ParseIdPipe) id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inquilino = await this.inquilinoService.encontrarUno(
      id,
      arrendadorId,
    );
    if (!inquilino) {
      throw new NotFoundException('Inquilino no encontrado.');
    }
    return inquilino;
  }
}
