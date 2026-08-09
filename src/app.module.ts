import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { InquilinoPanelModule } from './inquilino-panel/inquilino-panel.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    AlertaModule,
    InmuebleModule,
    InquilinoModule,
    ContratoModule,
    PagoModule,
    FotoInventarioModule,
    SolicitudMantenimientoModule,
    InquilinoPanelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
