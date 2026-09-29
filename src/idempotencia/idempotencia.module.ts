import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotenciaService } from './idempotencia.service';

@Module({
  providers: [IdempotenciaService, PrismaService],
  exports: [IdempotenciaService],
})
export class IdempotenciaModule {}
