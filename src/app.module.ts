import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InmuebleModule } from './inmueble/inmueble.module';
import { InquilinoModule } from './inquilino/inquilino.module';
import { ContratoModule } from './contrato/contrato.module';
import { PagoModule } from './pago/pago.module';
import { FotoInventarioModule } from './foto-inventario/foto-inventario.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    InmuebleModule,
    InquilinoModule,
    ContratoModule,
    PagoModule,
    FotoInventarioModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
