import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
