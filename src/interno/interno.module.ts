import { Module } from '@nestjs/common';
import { AlertaModule } from '../alerta/alerta.module';
import { InternoController } from './interno.controller';
import { TareasSecretGuard } from './tareas-secret.guard';

@Module({
  imports: [AlertaModule],
  controllers: [InternoController],
  providers: [TareasSecretGuard],
})
export class InternoModule {}
