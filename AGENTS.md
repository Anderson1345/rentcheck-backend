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

## Verificación antes de reportar
npx prisma generate && npx tsc --noEmit && npm run lint && npm run test:e2e
Las pruebas e2e usan rentcheck_test (.env.test). Nunca apuntes pruebas a la base de desarrollo ni a producción. Si la base de pruebas no tiene las migraciones al día: npm run test:e2e:setup.

## Prohibido
- Leer o imprimir .env, .env.test o credenciales. Si necesitas saber si existe una variable, pregunta.
- Cambiar código fuera del alcance del prompt.
- Push, merge o force-push.
