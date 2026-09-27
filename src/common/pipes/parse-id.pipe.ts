import { Injectable, NotFoundException, ParseUUIDPipe } from '@nestjs/common';

@Injectable()
export class ParseIdPipe extends ParseUUIDPipe {
  constructor() {
    super({
      exceptionFactory: () =>
        new NotFoundException({
          codigo: 'NO_ENCONTRADO',
          mensaje: 'Recurso no encontrado.',
        }),
    });
  }
}
