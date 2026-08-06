import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ContratoController } from './contrato.controller';
import { ContratoService } from './contrato.service';

@Module({
  imports: [AuthModule],
  controllers: [ContratoController],
  providers: [ContratoService, PrismaService],
})
export class ContratoModule {}
