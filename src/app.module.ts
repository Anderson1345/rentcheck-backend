import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InmuebleModule } from './inmueble/inmueble.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    InmuebleModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
