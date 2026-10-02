import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentoContratoService } from '../contrato/documento-contrato.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertaSchedulerService } from './alerta-scheduler.service';
import { LimpiezaTecnicaService } from './limpieza-tecnica.service';
import { AlertaController } from './alerta.controller';
import { AlertaInquilinoController } from './alerta-inquilino.controller';
import { AlertaService } from './alerta.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [AlertaController, AlertaInquilinoController],
  providers: [
    AlertaService,
    AlertaSchedulerService,
    LimpiezaTecnicaService,
    DocumentoContratoService,
    PrismaService,
  ],
  exports: [AlertaSchedulerService],
})
export class AlertaModule {}
