import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InmuebleModule } from './inmueble/inmueble.module';
import { InquilinoModule } from './inquilino/inquilino.module';
import { ContratoModule } from './contrato/contrato.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    InmuebleModule,
    InquilinoModule,
    ContratoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
