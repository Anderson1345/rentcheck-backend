import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

function esFechaValida(valor: unknown): valor is Date {
  return valor instanceof Date && !Number.isNaN(valor.getTime());
}

export function NoEsFechaFutura(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'noEsFechaFutura',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (!esFechaValida(value)) {
            return true;
          }
          return value.getTime() <= Date.now();
        },
        defaultMessage(): string {
          return 'La fecha no puede ser posterior a la fecha actual.';
        },
      },
    });
  };
}

export function FechaFinPosteriorAFechaInicio(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'fechaFinPosteriorAFechaInicio',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const objeto = args.object as { fecha_inicio?: Date };
          const fechaInicio = objeto.fecha_inicio;
          if (!esFechaValida(value) || !esFechaValida(fechaInicio)) {
            return true;
          }
          return value.getTime() > fechaInicio.getTime();
        },
        defaultMessage(): string {
          return 'La fecha de fin (fecha_fin) debe ser posterior a la fecha de inicio (fecha_inicio).';
        },
      },
    });
  };
}
