import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VinculacionContratoService } from './vinculacion-contrato.service';

@Module({
  providers: [VinculacionContratoService, PrismaService],
  exports: [VinculacionContratoService],
})
export class VinculacionModule {}
