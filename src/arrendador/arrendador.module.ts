import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ArrendadorController } from './arrendador.controller';
import { ArrendadorService } from './arrendador.service';

@Module({
  controllers: [ArrendadorController],
  providers: [ArrendadorService, PrismaService],
})
export class ArrendadorModule {}
