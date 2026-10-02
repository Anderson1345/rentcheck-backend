import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { ArrendadorController } from './arrendador.controller';
import { ArrendadorService } from './arrendador.service';
import { PanelArrendadorController } from './panel-arrendador.controller';
import { PanelArrendadorService } from './panel-arrendador.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [ArrendadorController, PanelArrendadorController],
  providers: [ArrendadorService, PanelArrendadorService, PrismaService],
})
export class ArrendadorModule {}
