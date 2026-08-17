import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AlertaModule } from './alerta/alerta.module';
import { ArrendadorModule } from './arrendador/arrendador.module';
import { InmuebleModule } from './inmueble/inmueble.module';
import { InquilinoModule } from './inquilino/inquilino.module';
import { ContratoModule } from './contrato/contrato.module';
import { PagoModule } from './pago/pago.module';
import { FotoInventarioModule } from './foto-inventario/foto-inventario.module';
import { SolicitudMantenimientoModule } from './solicitud-mantenimiento/solicitud-mantenimiento.module';
import { InquilinoPanelModule } from './inquilino-panel/inquilino-panel.module';
import { AlmacenamientoModule } from './almacenamiento/almacenamiento.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AuthModule,
    ArrendadorModule,
    AlertaModule,
    InmuebleModule,
    InquilinoModule,
    ContratoModule,
    PagoModule,
    FotoInventarioModule,
    SolicitudMantenimientoModule,
    InquilinoPanelModule,
    AlmacenamientoModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
