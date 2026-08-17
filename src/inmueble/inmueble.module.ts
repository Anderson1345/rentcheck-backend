import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { PrismaService } from '../prisma/prisma.service';
import { InmuebleController } from './inmueble.controller';
import { InmuebleService } from './inmueble.service';

@Module({
  imports: [AlmacenamientoModule],
  controllers: [InmuebleController],
  providers: [InmuebleService, PrismaService],
})
export class InmuebleModule {}
