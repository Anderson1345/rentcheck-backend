import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InmuebleController } from './inmueble.controller';
import { InmuebleService } from './inmueble.service';

@Module({
  controllers: [InmuebleController],
  providers: [InmuebleService, PrismaService],
})
export class InmuebleModule {}
