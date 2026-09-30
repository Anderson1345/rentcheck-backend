import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentoContratoService } from '../contrato/documento-contrato.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertaSchedulerService } from './alerta-scheduler.service';
import { AlertaController } from './alerta.controller';
import { AlertaService } from './alerta.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [AlertaController],
  providers: [
    AlertaService,
    AlertaSchedulerService,
    DocumentoContratoService,
    PrismaService,
  ],
})
export class AlertaModule {}
