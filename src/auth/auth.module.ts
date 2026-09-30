import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AlmacenamientoModule } from '../almacenamiento/almacenamiento.module';
import { VinculacionModule } from '../contrato/vinculacion.module';
import { CorreoModule } from '../correo/correo.module';
import { PrismaService } from '../prisma/prisma.service';
import { ArrendadorGuard } from './arrendador.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InquilinoAuthController } from './inquilino-auth.controller';
import { InquilinoGuard } from './inquilino.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { VerificacionCorreoController } from './verificacion-correo.controller';
import { VerificacionCorreoService } from './verificacion-correo.service';

@Module({
  imports: [
    AlmacenamientoModule,
    CorreoModule,
    VinculacionModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [
    AuthController,
    InquilinoAuthController,
    VerificacionCorreoController,
  ],
  providers: [
    AuthService,
    VerificacionCorreoService,
    PrismaService,
    JwtStrategy,
    JwtAuthGuard,
    ArrendadorGuard,
    InquilinoGuard,
  ],
  exports: [JwtAuthGuard, ArrendadorGuard, InquilinoGuard],
})
export class AuthModule {}

export { ArrendadorActual } from './arrendador-actual.decorator';
export { ArrendadorGuard } from './arrendador.guard';
export { InquilinoActual } from './inquilino-actual.decorator';
export { InquilinoGuard } from './inquilino.guard';
export { JwtAuthGuard } from './jwt-auth.guard';
