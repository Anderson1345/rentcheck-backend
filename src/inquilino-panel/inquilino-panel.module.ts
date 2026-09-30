import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { VinculacionModule } from '../contrato/vinculacion.module';
import { AvisoNoRenovacionService } from '../contrato/aviso-no-renovacion.service';
import { ContratoModule } from '../contrato/contrato.module';
import { TerminacionAnticipadaService } from '../contrato/terminacion-anticipada.service';
import { InquilinoPanelController } from './inquilino-panel.controller';
import { InquilinoPanelService } from './inquilino-panel.service';

@Module({
  imports: [
    AuthModule,
    AlmacenamientoModule,
    VinculacionModule,
    ContratoModule,
  ],
  controllers: [InquilinoPanelController],
  providers: [
    InquilinoPanelService,
    TerminacionAnticipadaService,
    AvisoNoRenovacionService,
    PrismaService,
  ],
})
export class InquilinoPanelModule {}
