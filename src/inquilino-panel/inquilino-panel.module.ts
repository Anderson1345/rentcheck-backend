import { Module } from '@nestjs/common';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { InquilinoPanelController } from './inquilino-panel.controller';
import { InquilinoPanelService } from './inquilino-panel.service';

@Module({
  imports: [AuthModule, AlmacenamientoModule],
  controllers: [InquilinoPanelController],
  providers: [InquilinoPanelService, PrismaService],
})
export class InquilinoPanelModule {}
