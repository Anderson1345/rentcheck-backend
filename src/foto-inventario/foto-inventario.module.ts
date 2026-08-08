import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { FotoInventarioController } from './foto-inventario.controller';
import { FotoInventarioService } from './foto-inventario.service';

@Module({
  imports: [AuthModule],
  controllers: [FotoInventarioController],
  providers: [FotoInventarioService, PrismaService],
})
export class FotoInventarioModule {}
