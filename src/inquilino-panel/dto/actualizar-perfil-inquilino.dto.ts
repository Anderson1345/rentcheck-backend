import { PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { CrearInquilinoDto } from '../../inquilino/dto/crear-inquilino.dto';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Nombre y teléfono del perfil del inquilino, con las MISMAS reglas que al
 * escribirlos en un contrato (`CrearInquilinoDto`: texto no vacío), sin
 * duplicar los validadores. Se recortan los espacios antes de validar, así un
 * valor de solo espacios es 400 `VALIDACION`. La cédula, el correo y la
 * contraseña no se pueden cambiar por aquí.
 */
export class ActualizarPerfilInquilinoDto extends PartialType(
  PickType(CrearInquilinoDto, ['nombre', 'telefono'] as const),
) {}

Transform(recortar)(ActualizarPerfilInquilinoDto.prototype, 'nombre');
Transform(recortar)(ActualizarPerfilInquilinoDto.prototype, 'telefono');

/** Campos que el PATCH acepta. */
export const CAMPOS_PERFIL_EDITABLES = ['nombre', 'telefono'] as const;
