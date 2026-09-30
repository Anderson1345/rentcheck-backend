import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ArrendadorController } from './arrendador.controller';
import { ArrendadorService } from './arrendador.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [ArrendadorController],
  providers: [ArrendadorService, PrismaService],
})
export class ArrendadorModule {}
