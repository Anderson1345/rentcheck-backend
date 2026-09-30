import { CanalResend } from './canal-resend';

const CLAVE = 're_clave_secreta_de_prueba';
const REMITENTE = 'RentCheck <no-responder@ejemplo.com>';
const MENSAJE = {
  para: 'persona@ejemplo.com',
  asunto: 'Tu código de verificación de RentCheck',
  texto: 'Tu código es 123456',
  html: '<p>Tu código es <strong>123456</strong></p>',
};

describe('CanalResend', () => {
  let fetchSimulado: jest.SpyInstance;

  beforeEach(() => {
    fetchSimulado = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hace POST a la API de Resend con Bearer, remitente y mensaje', async () => {
    fetchSimulado.mockResolvedValue(
      new Response(JSON.stringify({ id: 'abc' }), { status: 200 }),
    );

    await new CanalResend(CLAVE, REMITENTE).enviar(MENSAJE);

    expect(fetchSimulado).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchSimulado.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers.Authorization).toBe(`Bearer ${CLAVE}`);
    expect(opciones.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opciones.body)).toEqual({
      from: REMITENTE,
      to: MENSAJE.para,
      subject: MENSAJE.asunto,
      text: MENSAJE.texto,
      html: MENSAJE.html,
    });
  });

  it('una respuesta no 2xx lanza un error que no incluye la clave ni el código', async () => {
    fetchSimulado.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: `API key ${CLAVE} inválida para el mensaje 123456`,
        }),
        { status: 403 },
      ),
    );

    let error: unknown;
    try {
      await new CanalResend(CLAVE, REMITENTE).enviar(MENSAJE);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    const texto = `${String(error)} ${(error as Error).stack ?? ''}`;
    expect(texto).toContain('403');
    expect(texto).not.toContain(CLAVE);
    expect(texto).not.toContain('123456');
  });

  it('un fallo de red lanza un error genérico sin la clave ni el código', async () => {
    fetchSimulado.mockRejectedValue(
      new Error(`conexión rechazada con ${CLAVE} y 123456`),
    );

    let error: unknown;
    try {
      await new CanalResend(CLAVE, REMITENTE).enviar(MENSAJE);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    const texto = `${String(error)} ${(error as Error).stack ?? ''}`;
    expect(texto).not.toContain(CLAVE);
    expect(texto).not.toContain('123456');
  });
});
