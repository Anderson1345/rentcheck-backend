import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { SolicitudMantenimientoController } from './solicitud-mantenimiento.controller';
import { SolicitudMantenimientoService } from './solicitud-mantenimiento.service';

@Module({
  imports: [AuthModule],
  controllers: [SolicitudMantenimientoController],
  providers: [SolicitudMantenimientoService, PrismaService],
})
export class SolicitudMantenimientoModule {}
