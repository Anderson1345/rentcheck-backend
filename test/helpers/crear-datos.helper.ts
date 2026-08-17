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

export interface RespuestaCrearContrato {
  id: string;
  canon_centavos: number;
  deposito_centavos: number;
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
    deposito_centavos: 500000,
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

export async function registrarArrendador(
  app: INestApplication<App>,
  nombre: string,
  correo: string,
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
  return respuesta.body as RespuestaAutenticacion;
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
      cedula: '1234567890',
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
