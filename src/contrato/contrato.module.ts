import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ContratoController } from './contrato.controller';
import { ContratoService } from './contrato.service';
import { CorreccionContratoService } from './correccion-contrato.service';
import { DocumentoContratoService } from './documento-contrato.service';
import { AvisoNoRenovacionService } from './aviso-no-renovacion.service';
import { TerminacionAnticipadaService } from './terminacion-anticipada.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [ContratoController],
  providers: [
    ContratoService,
    CorreccionContratoService,
    DocumentoContratoService,
    TerminacionAnticipadaService,
    AvisoNoRenovacionService,
    PrismaService,
  ],
  exports: [DocumentoContratoService],
})
export class ContratoModule {}
