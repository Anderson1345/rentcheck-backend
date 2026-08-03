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
import { ActualizarUnidadDto } from './dto/actualizar-unidad.dto';
import { CrearInmuebleDto } from './dto/crear-inmueble.dto';
import { CrearUnidadDto } from './dto/crear-unidad.dto';
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

  @Post(':inmuebleId/unidades')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear una unidad dentro de un inmueble existente' })
  @ApiCreatedResponse({
    description: 'Unidad creada exitosamente.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble no encontrado o no pertenece al arrendador.',
  })
  async crearUnidad(
    @Param('inmuebleId') inmuebleId: string,
    @Body() dto: CrearUnidadDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const unidad = await this.inmuebleService.crearUnidad(
      inmuebleId,
      dto,
      arrendadorId,
    );
    if (!unidad) {
      throw new NotFoundException('Inmueble no encontrado.');
    }
    return unidad;
  }

  @Patch(':inmuebleId/unidades/:unidadId')
  @ApiOperation({ summary: 'Actualizar una unidad por ID' })
  @ApiOkResponse({
    description: 'Unidad actualizada exitosamente.',
  })
  @ApiNotFoundResponse({
    description: 'Inmueble o unidad no encontrada.',
  })
  async actualizarUnidad(
    @Param('inmuebleId') inmuebleId: string,
    @Param('unidadId') unidadId: string,
    @Body() dto: ActualizarUnidadDto,
    @ArrendadorActual() arrendadorId: string,
  ) {
    const unidad = await this.inmuebleService.actualizarUnidad(
      inmuebleId,
      unidadId,
      dto,
      arrendadorId,
    );
    if (!unidad) {
      throw new NotFoundException('Inmueble o unidad no encontrada.');
    }
    return unidad;
  }
}
