import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ArrendadorActual, JwtAuthGuard } from '../auth/auth.module';
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
