import { BadRequestException } from '@nestjs/common';
import { MotivoRechazoPago } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RechazarPagoDto,
  validarReglasMotivoRechazo,
} from './rechazar-pago.dto';

async function errores(cuerpo: unknown): Promise<string[]> {
  const dto = plainToInstance(RechazarPagoDto, cuerpo);
  const fallos = await validate(dto, { whitelist: true });
  return fallos.flatMap((f) => Object.keys(f.constraints ?? {}));
}

function codigoDe(dto: RechazarPagoDto): string | undefined {
  try {
    validarReglasMotivoRechazo(dto);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return ((error as BadRequestException).getResponse() as { codigo: string })
      .codigo;
  }
}

describe('RechazarPagoDto', () => {
  it('el cuerpo vacío es válido (el rechazo sin motivo sigue funcionando)', async () => {
    expect(await errores({})).toEqual([]);
    const dto = plainToInstance(RechazarPagoDto, {});
    expect(dto.motivo).toBeUndefined();
    expect(dto.mensaje).toBeUndefined();
    expect(codigoDe(dto)).toBeUndefined();
  });

  it.each(Object.values(MotivoRechazoPago))(
    'acepta el motivo %s',
    async (m) => {
      expect(await errores({ motivo: m })).toEqual([]);
    },
  );

  it('el motivo debe ser de la lista fija', async () => {
    expect(await errores({ motivo: 'OTRO_MOTIVO' })).toContain('isEnum');
    expect(await errores({ motivo: 5 })).toContain('isEnum');
  });

  it('el mensaje se recorta con trim', () => {
    const dto = plainToInstance(RechazarPagoDto, {
      motivo: 'OTRO',
      mensaje: '  Foto borrosa  ',
    });
    expect(dto.mensaje).toBe('Foto borrosa');
  });

  it('un mensaje en blanco cuenta como no enviado', () => {
    const dto = plainToInstance(RechazarPagoDto, {
      motivo: 'OTRO',
      mensaje: '    ',
    });
    expect(dto.mensaje).toBeUndefined();
    expect(codigoDe(dto)).toBe('MENSAJE_REQUERIDO');
  });

  it('acepta 200 caracteres y rechaza 201 (contados tras el trim)', async () => {
    expect(
      await errores({ motivo: 'OTRO', mensaje: ` ${'a'.repeat(200)} ` }),
    ).toEqual([]);
    expect(
      await errores({ motivo: 'OTRO', mensaje: 'a'.repeat(201) }),
    ).toContain('maxLength');
  });

  it('el mensaje debe ser texto', async () => {
    expect(await errores({ motivo: 'OTRO', mensaje: 123 })).toContain(
      'isString',
    );
  });
});

describe('validarReglasMotivoRechazo', () => {
  const dto = (cuerpo: object) => plainToInstance(RechazarPagoDto, cuerpo);

  it('mensaje sin motivo: MOTIVO_REQUERIDO', () => {
    expect(codigoDe(dto({ mensaje: 'Algo' }))).toBe('MOTIVO_REQUERIDO');
  });

  it('OTRO sin mensaje: MENSAJE_REQUERIDO', () => {
    expect(codigoDe(dto({ motivo: 'OTRO' }))).toBe('MENSAJE_REQUERIDO');
  });

  it('los demás motivos no exigen mensaje; con o sin él, pasan', () => {
    for (const motivo of [
      'MONTO_NO_COINCIDE',
      'PAGO_NO_VISIBLE',
      'COMPROBANTE_ILEGIBLE',
    ]) {
      expect(codigoDe(dto({ motivo }))).toBeUndefined();
      expect(codigoDe(dto({ motivo, mensaje: 'Detalle' }))).toBeUndefined();
    }
  });

  it('OTRO con mensaje pasa', () => {
    expect(codigoDe(dto({ motivo: 'OTRO', mensaje: 'Foto borrosa' }))).toBe(
      undefined,
    );
  });
});
