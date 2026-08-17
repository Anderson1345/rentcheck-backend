import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ContratoController } from './contrato.controller';
import { ContratoService } from './contrato.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [ContratoController],
  providers: [ContratoService, PrismaService],
})
export class ContratoModule {}
