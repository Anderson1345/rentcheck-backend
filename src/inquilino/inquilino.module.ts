import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { InquilinoController } from './inquilino.controller';
import { InquilinoService } from './inquilino.service';

@Module({
  imports: [AuthModule],
  controllers: [InquilinoController],
  providers: [InquilinoService, PrismaService],
})
export class InquilinoModule {}
