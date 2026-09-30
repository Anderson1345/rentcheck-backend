import {
  Controller,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AlertaSchedulerService } from '../alerta/alerta-scheduler.service';
import { EjecutarTareasQueryDto } from './ejecutar-tareas-query.dto';
import { TareasSecretGuard } from './tareas-secret.guard';

/**
 * Punto de entrada para el cron externo (cron-job.org): ejecuta las tareas
 * diarias. Sin JWT; protegido por `X-Tareas-Secret`. Excluido de Swagger.
 */
@ApiExcludeController()
@Controller('interno')
@UseGuards(TareasSecretGuard)
export class InternoController {
  constructor(private readonly scheduler: AlertaSchedulerService) {}

  /**
   * Por defecto responde 202 al instante y corre en segundo plano (el arranque
   * en frío de Render puede pasar de los 30 s que espera el cron externo).
   * Con `?esperar=true` espera y devuelve 200 con el resultado de cada tarea.
   * Con una corrida ya en curso responde 202 `en_curso`.
   */
  @Post('tareas-diarias')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async tareasDiarias(
    @Query() consulta: EjecutarTareasQueryDto,
    @Res({ passthrough: true }) respuesta: Response,
  ) {
    // Comprobar y arrancar en el mismo tick: no hay carrera entre dos llamadas.
    if (this.scheduler.tareasEnCurso()) {
      respuesta.status(HttpStatus.ACCEPTED);
      return { estado: 'en_curso' };
    }
    const corrida = this.scheduler.ejecutarTareasDiarias();

    if (consulta.esperar) {
      const resultado = await corrida;
      if (Array.isArray(resultado)) {
        respuesta.status(HttpStatus.OK);
        return resultado;
      }
      respuesta.status(HttpStatus.ACCEPTED);
      return resultado;
    }

    // El resumen (o el error) lo registra el propio scheduler.
    corrida.catch(() => undefined);
    respuesta.status(HttpStatus.ACCEPTED);
    return { estado: 'iniciada' };
  }
}
