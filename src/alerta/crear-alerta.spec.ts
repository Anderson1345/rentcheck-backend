import { TipoAlerta } from '@prisma/client';
import { alertarAlArrendadorDelContrato, crearAlerta } from './crear-alerta';

const ARRENDADOR = '55555555-5555-4555-8555-555555555555';
const INQUILINO = '66666666-6666-4666-8666-666666666666';
const CONTRATO = '77777777-7777-4777-8777-777777777777';

function clienteFalso() {
  const create = jest.fn().mockResolvedValue({ id: 'nueva' });
  return { cliente: { alerta: { create } }, create };
}

describe('crearAlerta', () => {
  it('crea con el cliente que recibe (cliente de Prisma o tx), tal cual los datos', async () => {
    const { cliente, create } = clienteFalso();
    const datos = {
      arrendador_id: ARRENDADOR,
      tipo: TipoAlerta.CONTRATO_VINCULADO_POR_INQUILINO,
      mensaje: 'Texto',
      contrato_id: CONTRATO,
    };
    const resultado = await crearAlerta(cliente as never, datos);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: datos });
    expect(resultado).toEqual({ id: 'nueva' });
  });

  it('acepta como destinatario un inquilino', async () => {
    const { cliente, create } = clienteFalso();
    await crearAlerta(cliente as never, {
      inquilino_id: INQUILINO,
      tipo: TipoAlerta.PAGO_APROBADO,
      mensaje: 'Texto',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ninguno', {}],
    ['los dos', { arrendador_id: ARRENDADOR, inquilino_id: INQUILINO }],
    ['ambos nulos', { arrendador_id: null, inquilino_id: null }],
  ])(
    'exige exactamente un destinatario (%s) y no escribe',
    async (_n, dest) => {
      const { cliente, create } = clienteFalso();
      await expect(
        crearAlerta(cliente as never, {
          ...dest,
          tipo: TipoAlerta.PAGO_APROBADO,
          mensaje: 'Texto',
        }),
      ).rejects.toThrow(/exactamente un destinatario/);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('un destinatario con el otro en null es válido', async () => {
    const { cliente, create } = clienteFalso();
    await crearAlerta(cliente as never, {
      arrendador_id: ARRENDADOR,
      inquilino_id: null,
      tipo: TipoAlerta.PAGO_APROBADO,
      mensaje: 'Texto',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('alertarAlArrendadorDelContrato', () => {
  function dbFalso(nombreUnidad: string) {
    const create = jest.fn().mockResolvedValue({ id: 'nueva' });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      arrendador_id: ARRENDADOR,
      unidad: { nombre: nombreUnidad },
    });
    return {
      db: { alerta: { create }, contrato: { findUniqueOrThrow } },
      create,
      findUniqueOrThrow,
    };
  }

  it('crea la alerta del arrendador del contrato con {unidad} reemplazado', async () => {
    const { db, create, findUniqueOrThrow } = dbFalso('Apto 101');
    await alertarAlArrendadorDelContrato(
      db as never,
      CONTRATO,
      TipoAlerta.AVISO_NO_RENOVACION_DADO,
      'Aviso en la unidad {unidad}.',
    );
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: CONTRATO },
      select: { arrendador_id: true, unidad: { select: { nombre: true } } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        arrendador_id: ARRENDADOR,
        tipo: TipoAlerta.AVISO_NO_RENOVACION_DADO,
        contrato_id: CONTRATO,
        mensaje: 'Aviso en la unidad Apto 101.',
      },
    });
  });

  it('un nombre de unidad con patrones de reemplazo se escribe tal cual', async () => {
    const { db, create } = dbFalso('Apto $& 2');
    await alertarAlArrendadorDelContrato(
      db as never,
      CONTRATO,
      TipoAlerta.AVISO_NO_RENOVACION_DADO,
      'Unidad {unidad}.',
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        arrendador_id: ARRENDADOR,
        tipo: TipoAlerta.AVISO_NO_RENOVACION_DADO,
        contrato_id: CONTRATO,
        mensaje: 'Unidad Apto $& 2.',
      },
    });
  });
});
