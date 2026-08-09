import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AlertaModule } from './alerta/alerta.module';
import { InmuebleModule } from './inmueble/inmueble.module';
import { InquilinoModule } from './inquilino/inquilino.module';
import { ContratoModule } from './contrato/contrato.module';
import { PagoModule } from './pago/pago.module';
import { FotoInventarioModule } from './foto-inventario/foto-inventario.module';
import { SolicitudMantenimientoModule } from './solicitud-mantenimiento/solicitud-mantenimiento.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    AlertaModule,
    InmuebleModule,
    InquilinoModule,
    ContratoModule,
    PagoModule,
    FotoInventarioModule,
    SolicitudMantenimientoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
