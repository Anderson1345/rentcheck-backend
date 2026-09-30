// Script SOLO para desarrollo local. Se conecta con el DATABASE_URL de .env
// (la base de datos local del desarrollador) y BORRA todos los datos de
// negocio antes de sembrar datos de prueba.
//
// NUNCA correr esto contra rentcheck_test (.env.test) ni contra producción
// (Render). El script no lee ni usa .env.test bajo ninguna circunstancia.

require('dotenv').config();
const readline = require('node:readline');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

const CONTRASENA_PRUEBA = 'Prueba1234';

function preguntar(mensaje) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(mensaje, (respuesta) => {
      rl.close();
      resolve(respuesta);
    });
  });
}

function sumarMeses(fecha, meses) {
  const resultado = new Date(fecha);
  resultado.setMonth(resultado.getMonth() + meses);
  return resultado;
}

function primerDiaDelMes(fecha) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
}

function sumarDias(fecha, dias) {
  const resultado = new Date(fecha);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

async function confirmarBaseDeDatos() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      'No se encontró DATABASE_URL en el entorno (.env). Nada que hacer.',
    );
    process.exit(1);
  }

  let host;
  let nombreBase;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    nombreBase = url.pathname.replace(/^\//, '');
  } catch {
    console.error('DATABASE_URL no es una URL válida.');
    process.exit(1);
  }

  console.log('Este script va a BORRAR y volver a sembrar datos en:');
  console.log(`  host: ${host}`);
  console.log(`  base de datos: ${nombreBase}`);
  if (/test/i.test(nombreBase)) {
    console.log(
      '  ADVERTENCIA: el nombre de la base contiene "test". Verifica que NO sea rentcheck_test.',
    );
  }
  console.log('');

  const respuesta = await preguntar(
    'Escribe exactamente SI para continuar (cualquier otra cosa cancela): ',
  );

  if (respuesta !== 'SI') {
    console.log('Cancelado. No se modificó nada.');
    process.exit(0);
  }
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function limpiarDatosDeNegocio() {
  // Orden de borrado respetando llaves foráneas: hijos antes que padres.
  await prisma.alerta.deleteMany();
  await prisma.fotoInventario.deleteMany();
  await prisma.solicitudMantenimiento.deleteMany();
  await prisma.pago.deleteMany();
  await prisma.intentoCodigo.deleteMany();
  await prisma.avisoNoRenovacion.deleteMany();
  await prisma.documentoContrato.deleteMany();
  await prisma.incrementoIPC.deleteMany();
  await prisma.codigoAcceso.deleteMany();
  await prisma.prorroga.deleteMany();
  await prisma.contrato.deleteMany();
  await prisma.documentoInmueble.deleteMany();
  await prisma.unidad.deleteMany();
  await prisma.inmueble.deleteMany();
  await prisma.inquilino.deleteMany();
  await prisma.arrendador.deleteMany();
  console.log('Datos de negocio anteriores eliminados.');
}

async function actualizarConfiguracionIpc() {
  for (const { anio, porcentaje } of [
    { anio: 2024, porcentaje: 5.2 },
    { anio: 2025, porcentaje: 5.1 },
  ]) {
    const existente = await prisma.configuracionIpc.findFirst({
      where: { anio },
    });
    if (existente) {
      await prisma.configuracionIpc.update({
        where: { id: existente.id },
        data: { porcentaje },
      });
    } else {
      await prisma.configuracionIpc.create({ data: { anio, porcentaje } });
    }
  }
  console.log('ConfiguracionIpc actualizada (2024 = 5,20 %, 2025 = 5,10 %).');
}

async function sembrar() {
  const hoy = new Date();
  const contrasenaHash = await bcrypt.hash(CONTRASENA_PRUEBA, 10);

  // --- Arrendadores -------------------------------------------------
  const arrendadorConCedula = await prisma.arrendador.create({
    data: {
      nombre: 'Arrendador Uno Prueba',
      correo: 'arrendador.uno@rentcheck.test',
      telefono: '3001110001',
      cedula: '900123456',
      contrasena_hash: contrasenaHash,
    },
  });

  const arrendadorSinCedula = await prisma.arrendador.create({
    data: {
      nombre: 'Arrendador Dos Prueba',
      correo: 'arrendador.dos@rentcheck.test',
      telefono: '3001110002',
      contrasena_hash: contrasenaHash,
    },
  });

  // --- Inmuebles y unidades (del arrendador con cédula) --------------
  const inmuebleResidencial = await prisma.inmueble.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      direccion: 'Calle 100 # 15-20',
      ciudad: 'Bogotá',
      estrato: 4,
      matricula_inmobiliaria: 'MAT-PRUEBA-001',
    },
  });

  const apto101 = await prisma.unidad.create({
    data: {
      inmueble_id: inmuebleResidencial.id,
      nombre: 'Apto 101',
      tipo: 'APARTAMENTO',
      metros_cuadrados: '65',
      numero_habitaciones: 3,
      numero_banos: 2,
      canon_base_centavos: 150000000,
      ocupantes_maximos: 4,
      acepta_mascotas: true,
      uso_permitido: 'RESIDENCIAL',
    },
  });

  const parqueadero12 = await prisma.unidad.create({
    data: {
      inmueble_id: inmuebleResidencial.id,
      nombre: 'Parqueadero 12',
      tipo: 'PARQUEADERO',
      metros_cuadrados: '12',
      numero_habitaciones: 0,
      numero_banos: 0,
      canon_base_centavos: 25000000,
      ocupantes_maximos: 1,
      acepta_mascotas: false,
      uso_permitido: 'RESIDENCIAL',
    },
  });

  const inmuebleComercial = await prisma.inmueble.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      direccion: 'Carrera 15 # 88-40, Local 5',
      ciudad: 'Bogotá',
      estrato: 3,
      matricula_inmobiliaria: 'MAT-PRUEBA-002',
    },
  });

  const local5 = await prisma.unidad.create({
    data: {
      inmueble_id: inmuebleComercial.id,
      nombre: 'Local 5',
      tipo: 'LOCAL',
      metros_cuadrados: '40',
      numero_habitaciones: 0,
      numero_banos: 1,
      canon_base_centavos: 300000000,
      ocupantes_maximos: 10,
      acepta_mascotas: false,
      uso_permitido: 'COMERCIAL',
    },
  });

  // --- Inquilinos ------------------------------------------------------
  // Inquilino A ya tiene cuenta activada (correo + contraseña) para poder
  // loguear directo sin pasar por el flujo de activación por código.
  const inquilinoA = await prisma.inquilino.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      nombre: 'Inquilino Uno Prueba',
      cedula: '1000111222',
      telefono: '3002220001',
      correo: 'inquilino.uno@rentcheck.test',
      contrasena_hash: contrasenaHash,
    },
  });

  const inquilinoB = await prisma.inquilino.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      nombre: 'Inquilino Dos Prueba',
      cedula: '1000222333',
      telefono: '3002220002',
    },
  });

  const inquilinoC = await prisma.inquilino.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      nombre: 'Inquilino Tres Prueba',
      cedula: '1000333444',
      telefono: '3002220003',
    },
  });

  // --- Contratos ---------------------------------------------------------
  // A: ACTIVO, al día (Apto 101 - inquilino A, ya con cuenta)
  const contratoA = await prisma.contrato.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      unidad_id: apto101.id,
      inquilino_id: inquilinoA.id,
      inquilino_nombre: inquilinoA.nombre,
      inquilino_cedula: inquilinoA.cedula,
      inquilino_telefono: inquilinoA.telefono,
      tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
      canon_centavos: 150000000,
      dia_pago: 5,
      forma_pago: 'Transferencia bancaria',
      datos_recaudo: 'Bancolombia ahorros 000-111222-33',
      fecha_inicio: sumarMeses(hoy, -6),
      fecha_fin: sumarMeses(hoy, 6),
      estado: 'ACTIVO',
      estado_pago: 'AL_DIA',
      // Inquilino A ya tiene cuenta: su contrato está vinculado (aparece en su portal).
      vinculado_en: sumarMeses(hoy, -6),
    },
  });

  // B: ACTIVO con un pago pendiente de validar (Parqueadero 12 - inquilino B, sin cuenta)
  const contratoB = await prisma.contrato.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      unidad_id: parqueadero12.id,
      inquilino_id: inquilinoB.id,
      inquilino_nombre: inquilinoB.nombre,
      inquilino_cedula: inquilinoB.cedula,
      inquilino_telefono: inquilinoB.telefono,
      tipo_plantilla: 'PARQUEADERO',
      canon_centavos: 25000000,
      dia_pago: 1,
      forma_pago: 'Nequi',
      deposito_centavos: 25000000,
      datos_recaudo: 'Nequi 300 111 2222',
      fecha_inicio: sumarMeses(hoy, -3),
      fecha_fin: sumarMeses(hoy, 9),
      estado: 'ACTIVO',
      estado_pago: 'PENDIENTE',
    },
  });

  // C: ACTIVO, a menos de 30 días de vencer (Local 5 - inquilino C, sin cuenta)
  const fechaFinC = sumarDias(hoy, 20);
  const contratoC = await prisma.contrato.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      unidad_id: local5.id,
      inquilino_id: inquilinoC.id,
      inquilino_nombre: inquilinoC.nombre,
      inquilino_cedula: inquilinoC.cedula,
      inquilino_telefono: inquilinoC.telefono,
      tipo_plantilla: 'LOCAL_COMERCIAL',
      canon_centavos: 300000000,
      dia_pago: 10,
      forma_pago: 'Transferencia bancaria',
      deposito_centavos: 300000000,
      datos_recaudo: 'Davivienda ahorros 444-555666-7',
      fecha_inicio: sumarMeses(fechaFinC, -12),
      fecha_fin: fechaFinC,
      estado: 'ACTIVO',
      estado_pago: 'AL_DIA',
    },
  });

  // D: VENCIDO (mismo Apto 101, inquilino previo = inquilino C, contrato histórico)
  const contratoD = await prisma.contrato.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      unidad_id: apto101.id,
      inquilino_id: inquilinoC.id,
      inquilino_nombre: inquilinoC.nombre,
      inquilino_cedula: inquilinoC.cedula,
      inquilino_telefono: inquilinoC.telefono,
      tipo_plantilla: 'VIVIENDA_URBANA_LEY_820',
      canon_centavos: 140000000,
      dia_pago: 5,
      forma_pago: 'Transferencia bancaria',
      datos_recaudo: 'Bancolombia ahorros 000-111222-33',
      fecha_inicio: sumarMeses(hoy, -26),
      fecha_fin: sumarMeses(hoy, -2),
      estado: 'VENCIDO',
      estado_pago: 'AL_DIA',
    },
  });

  // --- Códigos de acceso ---------------------------------------------
  const codigoA = await prisma.codigoAcceso.create({
    data: {
      codigo: 'RC-DEVA-2222',
      // Vigente 7 días; los contratos ya vinculados no lo usan más.
      expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      contrato_id: contratoA.id,
      unidad_id: apto101.id,
      inquilino_id: inquilinoA.id,
    },
  });
  const codigoB = await prisma.codigoAcceso.create({
    data: {
      codigo: 'RC-DEVB-2222',
      // Vigente 7 días; los contratos ya vinculados no lo usan más.
      expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      contrato_id: contratoB.id,
      unidad_id: parqueadero12.id,
      inquilino_id: inquilinoB.id,
    },
  });
  const codigoC = await prisma.codigoAcceso.create({
    data: {
      codigo: 'RC-DEVC-2222',
      // Vigente 7 días; los contratos ya vinculados no lo usan más.
      expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      contrato_id: contratoC.id,
      unidad_id: local5.id,
      inquilino_id: inquilinoC.id,
    },
  });
  const codigoD = await prisma.codigoAcceso.create({
    data: {
      codigo: 'RC-DEVD-2222',
      // Vigente 7 días; los contratos ya vinculados no lo usan más.
      expira_en: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      contrato_id: contratoD.id,
      unidad_id: apto101.id,
      inquilino_id: inquilinoC.id,
    },
  });

  // --- Pagos ---------------------------------------------------------
  await prisma.pago.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      contrato_id: contratoB.id,
      monto_centavos: 25000000,
      fecha_reportada: hoy,
      periodo: primerDiaDelMes(hoy),
      estado: 'PENDIENTE',
    },
  });

  await prisma.pago.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      contrato_id: contratoA.id,
      monto_centavos: 150000000,
      fecha_reportada: sumarDias(hoy, -5),
      periodo: primerDiaDelMes(sumarDias(hoy, -5)),
      estado: 'APROBADO',
    },
  });

  // --- Solicitud de mantenimiento -------------------------------------
  await prisma.solicitudMantenimiento.create({
    data: {
      arrendador_id: arrendadorConCedula.id,
      unidad_id: apto101.id,
      inquilino_id: inquilinoA.id,
      descripcion: 'Fuga de agua en el lavaplatos de la cocina.',
      urgencia: 'MEDIO',
      estado: 'PENDIENTE',
    },
  });

  console.log('Datos de prueba creados.');

  return {
    arrendadorConCedula,
    arrendadorSinCedula,
    inquilinoA,
    codigosSinVincular: [
      { codigo: codigoB.codigo, unidad: parqueadero12.nombre, contrato: 'B (ACTIVO, pago pendiente)' },
      { codigo: codigoC.codigo, unidad: local5.nombre, contrato: 'C (ACTIVO, vence en 20 días)' },
      { codigo: codigoD.codigo, unidad: apto101.nombre, contrato: 'D (VENCIDO)' },
    ],
    codigoVinculado: codigoA.codigo,
  };
}

function imprimirCredenciales(resultado) {
  console.log('');
  console.log('=== Credenciales de prueba (para copiar en Swagger) ===');
  console.log('');
  console.log('Arrendadores:');
  console.log(
    `  ${resultado.arrendadorConCedula.correo} / ${CONTRASENA_PRUEBA}  (con cédula registrada)`,
  );
  console.log(
    `  ${resultado.arrendadorSinCedula.correo} / ${CONTRASENA_PRUEBA}  (sin cédula, no puede confirmar contratos)`,
  );
  console.log('');
  console.log('Inquilinos con cuenta ya activada (login directo):');
  console.log(`  ${resultado.inquilinoA.correo} / ${CONTRASENA_PRUEBA}`);
  console.log(
    `    (su contrato Apto 101 está vinculado; código ya usado: ${resultado.codigoVinculado})`,
  );
  console.log('');
  console.log('Contratos SIN vincular (no aparecen en el portal hasta usar su código; sirven para probar validar-codigo / completar-registro):');
  for (const item of resultado.codigosSinVincular) {
    console.log(`  ${item.codigo}  — unidad "${item.unidad}", contrato ${item.contrato}`);
  }
  console.log('');
}

async function main() {
  await confirmarBaseDeDatos();
  await limpiarDatosDeNegocio();
  await actualizarConfiguracionIpc();
  const resultado = await sembrar();
  imprimirCredenciales(resultado);
}

main()
  .catch((error) => {
    console.error('Error sembrando datos de prueba:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
