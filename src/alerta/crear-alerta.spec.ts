import { RolSolicitante, TipoAlerta } from '@prisma/client';
import {
  alertarAlArrendadorDelContrato,
  alertarAlInquilinoDelContrato,
  alertarALaContraparte,
  crearAlerta,
} from './crear-alerta';

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

describe('alertarAlInquilinoDelContrato', () => {
  function dbFalso(contrato: { vinculado_en: Date | null; nombre?: string }) {
    const create = jest.fn().mockResolvedValue({ id: 'nueva' });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      inquilino_id: INQUILINO,
      vinculado_en: contrato.vinculado_en,
      unidad: { nombre: contrato.nombre ?? 'Apto 101' },
    });
    return {
      db: { alerta: { create }, contrato: { findUniqueOrThrow } },
      create,
    };
  }

  it('crea la alerta del inquilino del contrato con {unidad} reemplazado y los datos extra', async () => {
    const { db, create } = dbFalso({ vinculado_en: new Date() });
    const periodo = new Date('2031-04-01T00:00:00.000Z');
    await alertarAlInquilinoDelContrato(db as never, CONTRATO, {
      tipo: TipoAlerta.PAGO_APROBADO,
      mensaje: 'Pago de la unidad {unidad}.',
      pago_id: 'pago-1',
      periodo,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        inquilino_id: INQUILINO,
        tipo: TipoAlerta.PAGO_APROBADO,
        contrato_id: CONTRATO,
        mensaje: 'Pago de la unidad Apto 101.',
        pago_id: 'pago-1',
        periodo,
      },
    });
  });

  it('sin cuenta vinculada (vinculado_en nulo) no hay a quién alertar: no escribe y devuelve null', async () => {
    const { db, create } = dbFalso({ vinculado_en: null });
    const resultado = await alertarAlInquilinoDelContrato(
      db as never,
      CONTRATO,
      { tipo: TipoAlerta.PRORROGA_APLICADA, mensaje: 'x' },
    );
    expect(resultado).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('alertarALaContraparte', () => {
  function dbFalso() {
    const create = jest.fn().mockResolvedValue({ id: 'nueva' });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      arrendador_id: ARRENDADOR,
      inquilino_id: INQUILINO,
      vinculado_en: new Date(),
      unidad: { nombre: 'Apto 101' },
    });
    return {
      db: { alerta: { create }, contrato: { findUniqueOrThrow } },
      create,
    };
  }
  const textos = {
    [RolSolicitante.INQUILINO]: 'Lo hizo el inquilino de {unidad}.',
    [RolSolicitante.ARRENDADOR]: 'Lo hizo el arrendador de {unidad}.',
  };

  it('si actúa el inquilino avisa al arrendador con el texto del inquilino', async () => {
    const { db, create } = dbFalso();
    await alertarALaContraparte(
      db as never,
      CONTRATO,
      RolSolicitante.INQUILINO,
      TipoAlerta.AVISO_NO_RENOVACION_DADO,
      textos,
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        arrendador_id: ARRENDADOR,
        tipo: TipoAlerta.AVISO_NO_RENOVACION_DADO,
        contrato_id: CONTRATO,
        mensaje: 'Lo hizo el inquilino de Apto 101.',
      },
    });
  });

  it('si actúa el arrendador avisa al inquilino con el texto del arrendador', async () => {
    const { db, create } = dbFalso();
    await alertarALaContraparte(
      db as never,
      CONTRATO,
      RolSolicitante.ARRENDADOR,
      TipoAlerta.AVISO_NO_RENOVACION_DADO,
      textos,
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        inquilino_id: INQUILINO,
        tipo: TipoAlerta.AVISO_NO_RENOVACION_DADO,
        contrato_id: CONTRATO,
        mensaje: 'Lo hizo el arrendador de Apto 101.',
      },
    });
  });
});
