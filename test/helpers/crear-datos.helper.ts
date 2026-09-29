import { HttpStatus, INestApplication } from '@nestjs/common';
import { TipoPlantillaContrato } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

export interface RespuestaAutenticacion {
  access_token: string;
  arrendador: { id: string };
}

export interface RespuestaCrearInmueble {
  id: string;
  unidades: Array<{ id: string; nombre: string }>;
}

export interface RespuestaCrearInquilino {
  id: string;
}

let contadorCedula = 0;

function generarCedulaUnica(): string {
  contadorCedula += 1;
  const aleatorio = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `${contadorCedula}${aleatorio}`.padStart(10, '0').slice(-10);
}

export interface RespuestaCrearContrato {
  id: string;
  canon_centavos: number;
  deposito_centavos: number | null;
  dia_pago: number;
  estado: string;
  fecha_inicio: string;
  fecha_fin: string;
  pdf_contrato_url: string | null;
  codigo_acceso: { codigo: string } | null;
  unidad: { id: string };
  inquilino: { id: string };
}

export interface PagoCreado {
  id: string;
  contrato_id: string;
  arrendador_id: string;
  monto_centavos: number;
  fecha_reportada: string;
  comprobante_url: string;
  estado: string;
}

export function contratoValido(
  unidadId: string,
  inquilinoId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    unidad_id: unidadId,
    inquilino_id: inquilinoId,
    tipo_plantilla: TipoPlantillaContrato.VIVIENDA_URBANA_LEY_820,
    canon_centavos: 1000000,
    dia_pago: 5,
    forma_pago: 'Transferencia bancaria',
    datos_recaudo: 'Bancolombia ahorros 123456789',
    fecha_inicio: '2026-01-10',
    fecha_fin: '2026-12-31',
    ...overrides,
  };
}

export function fechaHoyLocal(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

export const CEDULA_ARRENDADOR_PRUEBA = '900123456';

/**
 * Registra un arrendador. Por defecto le guarda una cédula (sin ella no
 * puede crear contratos); pasa `conCedula = false` para probar esa regla.
 */
export async function registrarArrendador(
  app: INestApplication<App>,
  nombre: string,
  correo: string,
  conCedula = true,
): Promise<RespuestaAutenticacion> {
  const respuesta = await request(app.getHttpServer())
    .post('/auth/arrendador/registro')
    .send({
      nombre,
      correo,
      telefono: '3001234567',
      contrasena: 'clave123',
    })
    .expect(HttpStatus.CREATED);
  const autenticacion = respuesta.body as RespuestaAutenticacion;

  if (conCedula) {
    await request(app.getHttpServer())
      .patch('/arrendadores/perfil')
      .set('Authorization', `Bearer ${autenticacion.access_token}`)
      .send({ cedula: CEDULA_ARRENDADOR_PRUEBA })
      .expect(HttpStatus.OK);
  }
  return autenticacion;
}

export async function crearInmueble(
  app: INestApplication<App>,
  token: string,
  matricula = 'ABC-123456',
): Promise<RespuestaCrearInmueble> {
  const respuesta = await request(app.getHttpServer())
    .post('/inmuebles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      direccion: 'Calle 123 # 45-67',
      ciudad: 'Bogota',
      estrato: 3,
      matricula_inmobiliaria: matricula,
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearInmueble;
}

export async function crearInquilino(
  app: INestApplication<App>,
  token: string,
): Promise<RespuestaCrearInquilino> {
  const respuesta = await request(app.getHttpServer())
    .post('/inquilinos')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: 'Inquilino Prueba',
      cedula: generarCedulaUnica(),
      telefono: '3009876543',
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearInquilino;
}

export async function crearContrato(
  app: INestApplication<App>,
  token: string,
  unidadId: string,
  inquilinoId: string,
  overrides: Record<string, unknown> = {},
): Promise<RespuestaCrearContrato> {
  const respuesta = await request(app.getHttpServer())
    .post('/contratos')
    .set('Authorization', `Bearer ${token}`)
    .send(contratoValido(unidadId, inquilinoId, overrides))
    .expect(HttpStatus.CREATED);
  return respuesta.body as RespuestaCrearContrato;
}

export async function autenticarInquilino(
  app: INestApplication<App>,
  codigo: string,
  correo: string,
): Promise<string> {
  const respuesta = await request(app.getHttpServer())
    .post('/auth/inquilino/completar-registro')
    .send({
      codigo,
      correo,
      contrasena: 'clave1234',
    })
    .expect(HttpStatus.OK);
  return (respuesta.body as { access_token: string }).access_token;
}

export async function reportarPago(
  app: INestApplication<App>,
  inquilinoToken: string,
  contratoId: string,
): Promise<PagoCreado> {
  const respuesta = await request(app.getHttpServer())
    .post('/pagos')
    .set('Authorization', `Bearer ${inquilinoToken}`)
    .field('contratoId', contratoId)
    .field('monto_centavos', '1000000')
    .field('fecha_reportada', fechaHoyLocal())
    .attach('comprobante', Buffer.from('comprobante de prueba'), {
      filename: 'comprobante.png',
      contentType: 'image/png',
    })
    .expect(HttpStatus.CREATED);
  return respuesta.body as PagoCreado;
}
