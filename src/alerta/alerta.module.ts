import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { AlertaSchedulerService } from './alerta-scheduler.service';
import { AlertaController } from './alerta.controller';
import { AlertaService } from './alerta.service';

@Module({
  imports: [AuthModule],
  controllers: [AlertaController],
  providers: [AlertaService, AlertaSchedulerService, PrismaService],
})
export class AlertaModule {}
