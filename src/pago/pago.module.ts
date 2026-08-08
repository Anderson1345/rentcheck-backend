import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { PagoController } from './pago.controller';
import { PagoService } from './pago.service';

@Module({
  imports: [AuthModule],
  controllers: [PagoController],
  providers: [PagoService, PrismaService],
})
export class PagoModule {}
