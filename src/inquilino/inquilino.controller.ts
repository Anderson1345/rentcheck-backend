import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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

  @Get()
  @ApiOperation({ summary: 'Listar inquilinos del arrendador autenticado' })
  @ApiOkResponse({ description: 'Lista de inquilinos del arrendador.' })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.inquilinoService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un inquilino por ID' })
  @ApiOkResponse({ description: 'Inquilino encontrado.' })
  @ApiNotFoundResponse({
    description: 'Inquilino no encontrado o no pertenece al arrendador.',
  })
  async encontrarUno(
    @Param('id') id: string,
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
