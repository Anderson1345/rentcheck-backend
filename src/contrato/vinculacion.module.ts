import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntentosCodigoService } from './intentos-codigo.service';
import { VinculacionContratoService } from './vinculacion-contrato.service';

@Module({
  providers: [VinculacionContratoService, IntentosCodigoService, PrismaService],
  exports: [VinculacionContratoService, IntentosCodigoService],
})
export class VinculacionModule {}
