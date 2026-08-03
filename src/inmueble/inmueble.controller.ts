import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import { ActualizarInmuebleDto } from './dto/actualizar-inmueble.dto';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { InmuebleService } from './inmueble.service';

@ApiTags('Inmuebles')
@Controller('inmuebles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InmuebleController {
  constructor(private readonly inmuebleService: InmuebleService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inmuebles del arrendador autenticado' })
  @ApiOkResponse({
    description: 'Lista de inmuebles con sus unidades.',
  })
  listar(@ArrendadorActual() arrendadorId: string) {
    return this.inmuebleService.listar(arrendadorId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un inmueble por ID' })
  @ApiOkResponse({
    description: 'Inmueble con sus unidades.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado.',
  })
  async encontrarUno(
    @Param('id') id: string,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inmueble = await this.inmuebleService.encontrarUno(id, arrendadorId);
    if (!inmueble) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return inmueble;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un inmueble por ID' })
  @ApiOkResponse({
    description: 'Inmueble actualizado con sus unidades.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado.',
  })
  async actualizar(
    @Param('id') id: string,
    @Body() dto: ActualizarInmuebleDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const inmueble = await this.inmuebleService.actualizar(
      id,
      dto,
      arrendadorId,
    );
    if (!inmueble) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return inmueble;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un inmueble con su unidad principal' })
  @ApiCreatedResponse({
    description: 'Inmueble creado exitosamente junto con su unidad principal.',
  })
  crear(
    @Body() dto: CrearInmuebleDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    return this.inmuebleService.crear(dto, arrendadorId);
  }
}
