import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { SolicitudMantenimientoArrendadorController } from './solicitud-mantenimiento-arrendador.controller';
import { SolicitudMantenimientoController } from './solicitud-mantenimiento.controller';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [
    SolicitudMantenimientoController,
    SolicitudMantenimientoArrendadorController,
  ],
  providers: [SolicitudMantenimientoService, PrismaService],
})
export class SolicitudMantenimientoModule {}
