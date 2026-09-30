# RentCheck backend — reglas para agentes

## Stack
NestJS 11 + TypeScript (strictNullChecks) + Prisma 7 (prisma-client-js, adapter @prisma/adapter-pg) + PostgreSQL (Supabase) + Supabase Storage. Despliegue: Render (build: npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build; start: node dist/src/main).
Swagger: interfaz en /api/docs; JSON en /api-json (lo consume la app móvil para generar tipos).

## Reglas de negocio
La fuente de verdad es docs/RentCheck_Contexto_App_Movil.md. Las correcciones pendientes están en docs/RentCheck_Plan_Tecnico_App_Movil.md (IDs B-xx). Ante una contradicción, detente y pregunta.
Los archivos de docs/ son copias de solo lectura: no los modifiques; si encuentras un error en ellos, repórtalo.

## Convenciones obligatorias
- Dinero: siempre entero en centavos.
- Fechas de negocio en America/Bogota (usar la utilidad de fechas del proyecto, nunca new Date() suelto para "hoy").
- DTO: propiedades con `!`; fechas con @Type(() => Date) + @IsDate(); decimales con @IsNumber().
- Autorización: JwtAuthGuard + ArrendadorGuard/InquilinoGuard (Guards, no solo decoradores). Pertenencia por Contrato → Unidad → Inmueble → arrendador_id. Recurso ajeno o inexistente = 404.
- Nunca `include: { inquilino: true }` ni `arrendador: true`: siempre `select` explícito. Nunca devolver contrasena_hash ni rutas internas del bucket.
- Rutas de archivos: solo las genera el servidor. El cliente nunca envía rutas ni URLs de archivos.
- Archivos fuera de $transaction. Si falla la escritura en BD después de subir, borrar el archivo subido.
- Nada con valor legal o financiero se borra físicamente; los PDF se versionan.
- ArrendadorActual/InquilinoActual se exportan con `export` de TypeScript, nunca en `exports: []` de @Module.
- Tras cambiar schema.prisma: npx prisma generate.
- Errores: el filtro global responde `{ statusCode, codigo, mensaje, detalles?, message }`; para un código propio se lanza, por ejemplo, `new ConflictException({ codigo: 'CONTRATO_NO_ACTIVO', mensaje: '...' })`.
- Ids de ruta: siempre con el pipe de B-22 (`ParseIdPipe`, en `src/common/pipes/parse-id.pipe.ts`).
- Pruebas e2e: siempre `configurarApp(app)` (`src/configurar-app.ts`), nunca `useGlobalPipes` a mano.
- DTOs: nunca aceptan rutas ni URLs de archivos.
- Datos de recaudo: solo se devuelven al inquilino con contrato ACTIVO (regla 11).
- `Contrato.estado_pago` nunca se asigna a mano: se deriva con `calcularEstadoCuenta` + `derivarEstadoPagoContrato` (src/common/estado-cuenta.util.ts) y se recalcula en `PagoService.crear/aprobar/rechazar` y en el cron de mora. `Pago.periodo` (primer día del mes que cubre, `@db.Date`) es obligatorio, y el reemplazo de pagos pendientes es solo entre pagos del mismo período.
- `Contrato.canon_centavos` es el canon VIGENTE hoy; el canon de un período pasado se deriva del historial de IncrementoIPC en `calcularEstadoCuenta` (`canon_anterior_centavos` / `canon_nuevo_centavos`), nunca se lee directo del contrato. Todo llamador de `calcularEstadoCuenta` debe seleccionar `canon_anterior_centavos` en los incrementos.
- Documentos legales del contrato: `DocumentoContrato` es el historial inmutable (CONTRATO_ORIGINAL v1 + un otrosí por cada incremento y prórroga, con hash SHA-256, ruta `contratos/{id}/v{n}-{tipo}.pdf`, subida con upsert=false). Todo pasa por `DocumentoContratoService.registrarDocumento`; nunca se sobrescribe ni se borra un documento existente. Tras confirmar un incremento o una prórroga se genera su otrosí fuera de la transacción: si falla, el hecho queda aplicado y el documento se genera con `POST /contratos/:id/documentos/regenerar` (solo genera lo que falta; el original se reconstruye con los términos ORIGINALES vía `terminosOriginales`).
- `Contrato.pdf_contrato_ruta` está DEPRECADO (apunta al original v1; el panel del inquilino aún lo usa hasta B0.4-B). No leerlo para lógica nueva: usar `DocumentoContrato`.
- El ZIP de documentos del inmueble incluye todas las versiones de cada contrato y solo comprobantes con estado APROBADO, con nombres únicos.
- La terminación anticipada es mutuo acuerdo (regla 17, D-2): solicita una parte con motivo y `fecha_efectiva`, confirma la OTRA y solo quien solicitó puede cancelar antes de la confirmación. Toda transición (solicitar, confirmar, cancelar, aplicar por cron) es un `updateMany` condicional dentro de una transacción, y si `count = 0` se distingue el error leyendo el estado actual. La lógica vive en `TerminacionAnticipadaService`; no la dupliques por rol.
- Todo llamador de `calcularEstadoCuenta` pasa `fechaFinParaEstadoCuenta(contrato)` (src/common/terminacion.util.ts) como `fecha_fin`: un contrato terminado anticipadamente no genera períodos después de su fecha efectiva.
- Estados del contrato: un contrato con `fecha_inicio` futura nace PROGRAMADO (no bloquea la unidad) y solo se activa por el cron de estados (PROGRAMADO→ACTIVO) o lo cancela el arrendador (PROGRAMADO→CANCELADO, `cancelado_en`); nada se borra. El único cron de estados es `ejecutarTransicionesDeEstado` (terminaciones → vencimiento → activación, en ese orden).
- Todo cambio de estado de un contrato es un `updateMany` condicionado al estado de origen (dentro de una transacción si hay más escrituras); si `count = 0` se distingue el error leyendo el estado actual.
- `crear()` bloquea la fila de la unidad (`SELECT ... FOR UPDATE`) y valida el traslape de fechas con `buscarTraslape` (src/common/traslape.util.ts) contra los contratos ACTIVO y PROGRAMADO de la unidad; el contrato siguiente debe empezar después del último día del anterior. Para buscar el contrato actual de un inquilino usa `resolverIdContratoDelInquilino` (ACTIVO, luego PROGRAMADO, luego el más reciente no cancelado).
- Fin de contrato (D-1): un contrato ACTIVO que llega a su `fecha_fin` sin aviso de no renovación se PRORROGA automáticamente por el término inicial (aplica a las tres plantillas); con aviso vigente pasa a VENCIDO. El cron de estados (`ejecutarTransicionesDeEstado`) corre a las 00:05 de Bogotá con orden fijo: terminaciones → vencimientos/prórrogas → activación de programados. Si la unidad ya tiene un contrato PROGRAMADO posterior, el contrato vence en vez de prorrogarse.
- Toda prórroga (manual o automática) pasa por `aplicarProrroga` (src/contrato/aplicar-prorroga.ts): updateMany condicionado a la `fecha_fin` leída, fila `Prorroga`, recálculo de `estado_pago`, todo en la transacción; su otrosí se genera FUERA de ella con `generarSinPropagarErrores`.
- El aviso de no renovación (`AvisoNoRenovacion`, una fila por contrato) está vigente mientras `cancelado_en` sea NULL; un aviso cancelado se reactiva en la misma fila. Solo se da o cancela con el contrato ACTIVO y `hoy < fecha_fin`.
- Los datos del inquilino que ve el arrendador (nombre, cédula, teléfono) salen SIEMPRE de la copia en el contrato (`Contrato.inquilino_nombre/cedula/telefono`), nunca de `Inquilino.nombre/cedula/telefono` (perfil global de la persona). `POST /contratos` recibe `inquilino_id` o `inquilino_nuevo` (uno solo); con `inquilino_nuevo` se busca por cédula normalizada y se reutiliza la identidad sin modificarla ni devolver sus datos; la identidad nueva se crea con `createMany({ skipDuplicates: true })`, nunca con `create` dentro de una transacción interactiva.
- Con el adaptador de pg, un P2002 no trae `meta.target`: el nombre de la restricción llega en `meta.driverAdapterError.cause.originalMessage`. Dentro de una transacción interactiva un P2002 la envenena; por eso se usa `createMany({ skipDuplicates: true })` y luego `findUniqueOrThrow`.
- El portal del inquilino solo ve contratos con `vinculado_en` no nulo (el contrato se vincula al crear la cuenta con su código o con `POST /inquilino/contratos/vincular`); todo resolver o lector nuevo del lado del inquilino debe exigirlo (`resolverIdContratoDelInquilino` ya lo hace). Un código inexistente, de otra cuenta, ya usado o de un contrato CANCELADO recibe siempre la misma respuesta.
- Código de acceso: formato `RC-XXXX-XXXX` (alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, sin I, O, 0 ni 1), expira a los 7 días (`CodigoAcceso.expira_en`; uno vencido es como uno inexistente, mismo 404) y 5 intentos fallidos seguidos (`IntentoCodigo`, origen = IP o `cuenta:<id>`) bloquean 15 minutos con 429 `DEMASIADOS_INTENTOS`. Se genera SOLO con `crypto.randomInt` (`src/common/utils/codigo-acceso.ts`, donde viven todas las constantes); el código de entrada se normaliza con `normalizarCodigoAcceso` (DTO con Transform).
- Todo correo se normaliza con `normalizarCorreo` (`trim().toLowerCase()`) antes de guardarse o compararse (DTOs con Transform y servicios), en Arrendador e Inquilino, y antes de registrar se verifican las dos tablas. Ningún mensaje revela si un correo o una cédula existen: el registro con un correo ya usado responde siempre el mismo 409 genérico. `POST /inquilinos` no existe; las identidades se crean con `inquilino_nuevo` en `POST /contratos`.
- Portal del inquilino: toda ruta que reciba un id de contrato pasa por `contratoVinculadoDelInquilino` (`src/common/contrato-vinculado-inquilino.ts`): solo devuelve el contrato si es del inquilino, tiene `vinculado_en` y no está CANCELADO; si no, 404 sin distinguir la causa. Las rutas nuevas del inquilino van bajo `/inquilino/...`; las `mi-*` y `GET /solicitudes-mantenimiento/mias` son alias OBSOLETOS (se retiran en B0.5) y no se amplían.
- Los endpoints que crean registros desde la cola sin conexión de la app (`POST /pagos`, `POST /solicitudes-mantenimiento`) aceptan el encabezado opcional `Idempotency-Key`: misma clave y mismo contenido devuelve el mismo registro sin duplicar; misma clave con distinto contenido responde 422 `IDEMPOTENCY_KEY_REUTILIZADA`; una clave por (inquilino, endpoint). Todo endpoint nuevo de creación que use la app móvil en cola debe seguir este patrón.

## Verificación antes de reportar
npx prisma generate && npx tsc --noEmit && npm run lint && npm run test:e2e
Las pruebas e2e usan rentcheck_test (.env.test). Nunca apuntes pruebas a la base de desarrollo ni a producción. Si la base de pruebas no tiene las migraciones al día: npm run test:e2e:setup.

## Prohibido
- Leer o imprimir .env, .env.test o credenciales. Si necesitas saber si existe una variable, pregunta.
- Cambiar código fuera del alcance del prompt.
- Push, merge o force-push.
