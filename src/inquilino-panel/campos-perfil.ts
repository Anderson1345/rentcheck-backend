import { BadRequestException } from '@nestjs/common';
import { CAMPOS_PERFIL_EDITABLES } from './dto/actualizar-perfil-inquilino.dto';

/**
 * Revisa las claves del cuerpo tal como llegó (antes del whitelist, que
 * descarta en silencio lo desconocido), con el mismo estilo de error que
 * `PATCH /contratos/:id`: CUALQUIER campo distinto de nombre y teléfono
 * (cedula, correo, contrasena, id...) es 400 `CAMPO_NO_EDITABLE` con la lista
 * de campos rechazados, y un cuerpo sin ningún campo editable es 400
 * `SIN_CAMPOS`.
 */
export function validarCamposDePerfil(cuerpo: unknown): void {
  const claves =
    cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
      ? Object.keys(cuerpo)
      : [];
  const rechazados = claves.filter(
    (clave) => !(CAMPOS_PERFIL_EDITABLES as readonly string[]).includes(clave),
  );
  if (rechazados.length > 0) {
    throw new BadRequestException({
      codigo: 'CAMPO_NO_EDITABLE',
      mensaje: `Solo se pueden cambiar ${CAMPOS_PERFIL_EDITABLES.join(' y ')} del perfil; estos campos no se pueden cambiar por aquí.`,
      detalles: rechazados,
    });
  }
  if (claves.length === 0) {
    throw new BadRequestException({
      codigo: 'SIN_CAMPOS',
      mensaje: `Envía al menos un campo a cambiar: ${CAMPOS_PERFIL_EDITABLES.join(', ')}.`,
    });
  }
}
