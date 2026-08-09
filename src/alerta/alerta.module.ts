import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { AlertaController } from './alerta.controller';
import { AlertaService } from './alerta.service';

@Module({
  imports: [AuthModule],
  controllers: [AlertaController],
  providers: [AlertaService, PrismaService],
})
export class AlertaModule {}
