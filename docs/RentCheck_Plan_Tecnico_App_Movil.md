# RentCheck — Plan técnico de la app móvil

> **Versión 2.2 — 27 de septiembre de 2026.** Reemplaza a la versión 2.1.
> Complementa a `RentCheck_Contexto_App_Movil.md` (qué hace el producto) con el **cómo**: qué se reutiliza, qué se corrige primero en el backend, qué tecnologías se usan y cuánto cuesta publicar. Es el único documento donde se nombran tecnologías concretas.
> La forma de trabajar día a día (tamaño de los prompts, plantilla, verificación, estado del avance) está en `RentCheck_instrucciones_desarrollo_movil.md`.

**Qué cambió en la versión 2.2:**
- B-33 (eliminar inmueble con documentos respondía 500) y B-36, la parte de "transiciones de estado sin escritura condicional" (doble aprobación de pago, doble confirmación de terminación anticipada, doble cambio de estado de mantenimiento), se corrigieron en el Bloque **0.1-B** (cerrado el 27/09/2026). La otra mitad de B-36 (control de versión en ediciones concurrentes normales) sigue pendiente para el Bloque 0.5.

**Qué cambió en la versión 2.1:**
- Se incorporaron los hallazgos de `RentCheck_Escenarios_Operativos.md` (auditoría de 30 escenarios sobre el código real, 26-27/09/2026): 15 IDs nuevos, B-32 a B-46 (sección 3.7).
- B-32 (datos de recaudo expuestos con contrato no activo) y B-40 (fotos de devolución nunca se devuelven) se corrigieron en el Bloque 0.1.
- Se agregó el Bloque **0.1-B** (B-33, B-36) y se repartieron los demás IDs nuevos entre los bloques existentes (sección 4).

**Qué cambió en la versión 2.0 frente a la 1:** ver el historial completo en el documento; en resumen, se auditó el código real del backend (no solo la documentación) y aparecieron los errores B-01 a B-31, reorganizados en bloques de trabajo.

---

## 1. Decisión: se reutiliza el backend, pero primero se corrige

Se reutilizan el backend NestJS + Prisma + PostgreSQL y el almacenamiento en Supabase, que ya están en producción (Render + Supabase). Reescribirlos no tiene sentido: la arquitectura es sana (guards por rol, aislamiento por arrendador, archivos privados con URL firmada, pruebas e2e, despliegue funcionando).

Lo que sí es obligatorio es una **Fase 0 de correcciones** antes de construir pantallas. Varios errores de la sección 3 cambian la forma de los datos que la app va a consumir (pagos por período, contratos múltiples por inquilino, activación). Si se construye la app encima de la forma actual, habrá que rehacer pantallas.

La app móvil es un cliente nuevo de la misma API REST. La web (`rentcheck-frontend`) queda congelada mientras tanto. Se reconstruirá después contra la API ya corregida, así que no vale la pena mantenerla al día durante la Fase 0.

---

## 2. Cómo se conecta la app con el backend

- La app hace peticiones HTTPS a `https://rentcheck-backend-9zb6.onrender.com` con el mismo token `Authorization: Bearer` que usa la web.
- Los archivos se piden igual: el backend devuelve una URL firmada que expira en 1 hora. La app **nunca** guarda esa URL como permanente; si expiró, vuelve a pedir el recurso.
- **Arranque en frío de Render:** el plan gratis duerme el servicio tras 15 minutos sin tráfico, y la primera petición tarda unos 50 segundos. La app debe tener un tiempo de espera largo en la primera llamada y mostrar un mensaje tipo "Conectando con el servidor…" en vez de un error.
- Los tipos TypeScript de la app se **generan desde Swagger** (`/api-json`, confirmado en producción desde B0.0), no se copian a mano.

---

## 3. Auditoría del backend (26 de septiembre de 2026)

Revisión hecha sobre `rentcheck-backend/src` y `prisma/schema.prisma` tal como están en el disco. Severidad: **Crítico** = rompe datos, seguridad o legalidad; **Importante** = la app móvil lo necesita o producirá errores visibles; **Menor** = limpieza.

### 3.1 Seguridad

| ID | Sev. | Dónde | Problema | Corrección esperada | Estado |
|---|---|---|---|---|---|
| B-01 | Crítico | `contrato.service.ts` → `encontrarUno()` y `crear()` usan `include: { inquilino: true }` | `GET /contratos/:id` y `POST /contratos` devuelven **todos** los campos del inquilino, incluidos `contrasena_hash`, `correo` y `foto_cedula_url`. | Reemplazar todo `include: { inquilino: true }` por un `select` explícito (id, nombre, cédula, teléfono, activado). Buscar el mismo patrón en todo `src/` (`inquilino: true`, `arrendador: true`). Agregar una prueba e2e que falle si la respuesta contiene `contrasena_hash`. | ✅ Corregido en B0.1 |
| B-02 | Crítico | `generarCodigoAcceso()`, `POST /auth/inquilino/validar-codigo` y `completar-registro` | El código es `RC-<año>-` + 4 caracteres: unas 1,7 millones de combinaciones por año. Estos endpoints solo tienen el límite global (100 por minuto), así que con pocos contratos sin activar un atacante puede adivinar códigos y **tomar la cuenta del inquilino** (define él el correo y la contraseña). | Código de 8 caracteres de un alfabeto sin caracteres confusos (sin 0/O/1/I), con formato `RC-XXXX-XXXX` y sin el año; límite de 5 intentos por minuto en ambos endpoints; expiración (por ejemplo 7 días, regenerable); contador de intentos fallidos por código. | 🔶 Límite (5/min) corregido en B0.1; formato de 8 caracteres y expiración van en B0.4-A |
| B-03 | Crítico | `CrearInmuebleDto`/`ActualizarInmuebleDto.foto_portada_ruta`, `CrearUnidadDto`/`ActualizarUnidadDto.foto_principal_url`, `CompletarRegistroInquilinoDto.foto_cedula_url` | El cliente puede escribir una **ruta interna del bucket**. Con `PATCH /inmuebles/:id { foto_portada_ruta: "contratos/<id>/contrato.pdf" }`, el siguiente `GET` devuelve una URL firmada de un archivo ajeno. Si después se sube una portada nueva, `subirFotoPortada()` **borra** ese archivo ajeno. Además, la web guarda la foto de cédula como texto base64 dentro de la base de datos. | Quitar esos campos de todos los DTOs de entrada. Toda ruta la genera el servidor. Crear endpoints de subida real (multipart) para foto principal de Unidad, foto de cédula del Inquilino y foto de cédula/NIT del Arrendador, con el mismo patrón de `POST /inmuebles/:id/foto-portada`. Limpiar los valores base64 que existan. | 🔶 Campos quitados de los DTOs en B0.1; endpoints de subida van en B0.4-B |
| B-04 | Crítico (verificar) | `main.ts` | Render pone un proxy delante de la app. Sin `trust proxy`, es probable que `req.ip` sea la IP del proxy, y entonces **todos los usuarios compartirían** el límite de 100 peticiones por minuto y 5 inicios de sesión por minuto. Con la app móvil en uso real, eso da errores 429 aleatorios. | `app.getHttpAdapter().getInstance().set('trust proxy', 1)`. Verificar con un log temporal de `req.ip` en producción, antes y después. | 🔶 Código en B0.1; verificación en producción pendiente (después del merge) |
| B-22 | Importante | Todos los `@Param('id')` | Un id que no tiene forma de UUID hace fallar la consulta de Prisma, y se responde 500 en vez de 404. | `ParseUUIDPipe` en todos los parámetros de id. | ✅ Corregido en B0.1 (`ParseIdPipe` propio) |
| B-25 | Importante | `auth.module.ts` (`expiresIn: '7d'`) | No hay token de renovación ni forma de revocar sesiones. En móvil, el usuario tendría que iniciar sesión cada 7 días, y un teléfono perdido conserva el acceso hasta que el token vence. | Token de acceso corto (por ejemplo 1 hora) + token de renovación guardado en la base de datos con su hash (tabla `SesionDispositivo`), rotación en cada uso, `POST /auth/logout` y "cerrar todas las sesiones". Puede ir en el Bloque 0.6 si hace falta priorizar. | ⬜ Bloque 0.6 |
| B-30 | Menor | Filtros de subida | El tipo de archivo se valida con el `mimetype` que declara el cliente, no con el contenido real. | Validar los bytes iniciales del archivo (paquete `file-type`) en el mismo paso. | ⬜ Sin bloque asignado (menor) |

### 3.2 Pagos y mora (el motor de cobro)

Los tres errores siguientes tienen la misma causa: el sistema **no sabe a qué mes corresponde cada pago**. Solo compara la `fecha_reportada` con "el último día de pago que ya pasó".

| ID | Sev. | Dónde | Problema (escenario concreto) |
|---|---|---|---|
| B-05 | Crítico | `ejecutarInquilinoEnMora()` + `calcularCicloPagoActual()` | (a) **Un pago anticipado no cuenta.** Con día de pago 5, el inquilino paga el 3 de octubre. El 5 de octubre el ciclo pasa a ser "5 de octubre", el pago del 3 queda antes y el contrato se marca EN_MORA. (b) **Un contrato nuevo entra en mora la noche siguiente.** Si se crea el 20 de septiembre con día 5, el ciclo actual es "5 de septiembre", no hay pagos y queda EN_MORA. (c) El cron corre a las 00:00 UTC, que son las **7 pm del día anterior en Colombia**: la mora empieza antes de que termine el plazo. |
| B-06 | Crítico | `ejecutarRecordatorioPago()` | Para decidir si ya se pagó, usa el ciclo **anterior**. Quien pagó el mes pasado nunca recibe el recordatorio del mes siguiente. Además, la alerta se guarda para el **arrendador**, no para el inquilino. |
| B-07 | Crítico | `PagoService.crear()` y `aprobar()` | (a) El reemplazo automático busca "cualquier pago PENDIENTE desde el ciclo actual". Si un inquilino atrasado reporta septiembre y luego octubre el mismo día, el de octubre **reemplaza** al de septiembre. (b) Aprobar **cualquier** pago (uno parcial, o uno viejo cuando se deben dos meses) pone el contrato AL_DIA. |

**Corrección única para B-05, B-06 y B-07 (Bloque 0.2):**
1. Agregar `Pago.periodo` (fecha del primer día del mes que cubre el pago), obligatorio para pagos nuevos. Lo propone el servidor: por defecto el período vencido más antiguo sin pagar; el inquilino puede elegir otro de la lista de períodos pendientes. Migración: asignar a los pagos existentes el período según su `fecha_reportada`.
2. Una función pura y probada con pruebas unitarias, `calcularEstadoCuenta(contrato, incrementos, pagos, hoy)`. Genera los períodos desde `fecha_inicio` hasta hoy (sin pasar de `fecha_fin`), calcula para cada uno su fecha límite y su canon vigente (según el historial de IPC) y le asigna un estado: `PAGADO`, `EN_REVISION`, `PENDIENTE` (aún no vence), `VENCIDO` o `PARCIAL`.
3. `estado_pago` del contrato **se deriva** de esa función: `EN_MORA` si algún período está VENCIDO, `AL_DIA` si ninguno lo está, `PENDIENTE` si todavía no vence el primero. Se recalcula al aprobar o rechazar y en el cron.
4. El reemplazo automático solo ocurre entre pagos PENDIENTES **del mismo período**.
5. Un período vence **al día siguiente** de su fecha límite, en hora de Colombia.
6. Nuevo endpoint `GET /inquilino/contratos/:id/estado-cuenta` (y su equivalente para el arrendador) con la lista de períodos. La app lo usa en "Mis Pagos", y el Panel lo puede usar para "recaudo esperado vs. real".
7. Aceptar el encabezado `Idempotency-Key` en `POST /pagos` (y en `POST /solicitudes-mantenimiento`): si llega dos veces la misma clave, se devuelve el mismo registro. Es necesario para la cola sin conexión de la app.
8. **B-38** (nuevo, ver 3.7): con contrato terminado, el inquilino debe poder seguir reportando pagos de períodos anteriores al cierre que sigan vencidos.
9. **B-39** (nuevo, ver 3.7): `fecha_reportada` no puede ser anterior a `fecha_inicio` del contrato.

**Decisión D-3, confirmada el 26/09/2026:** el **primer período** vence en el primer día de pago igual o posterior a `fecha_inicio`. Un contrato que inicia el 20 de septiembre con día de pago 5 tiene su primera fecha límite el 5 de octubre, y antes de esa fecha no puede estar En mora.

### 3.3 Contrato: reglas legales y de ciclo de vida

| ID | Sev. | Dónde | Problema | Corrección esperada |
|---|---|---|---|---|
| B-08 | Crítico (legal) | Plantilla `VIVIENDA_URBANA_LEY_820` y `CrearContratoDto.deposito_centavos` (`@IsPositive`, obligatorio) | La **Ley 820 de 2003, art. 16, prohíbe exigir depósitos en dinero** en arriendos de vivienda urbana. Hoy el sistema obliga a poner un depósito mayor que cero y lo escribe como cláusula CUARTA. | Depósito opcional: en vivienda debe ser 0 o nulo (si llega otro valor, error 400 con mensaje claro); en local y parqueadero es opcional. Quitar la cláusula de depósito de la plantilla de vivienda y dejar solo "garantías" (fiador, póliza, codeudor). La liquidación de depósito aplica solo a local y parqueadero. |
| B-09 | Crítico | `ContratoService.renovar()` + `ConfiguracionIpc` | (a) "Renovar" aplica el IPC y alarga la fecha de fin en una sola acción, **y se puede repetir sin límite**: dos clics seguidos son dos incrementos. La Ley 820 (art. 20) permite subir el canon solo **cada 12 meses**, y como máximo el 100 % del IPC del año anterior. (b) Toma el registro de IPC "más reciente", no el del año calendario anterior. (c) **Dato erróneo en producción:** el 9,28 % guardado corresponde al IPC de **2023**. El IPC de 2024 fue 5,20 % y el de 2025 fue **5,10 %**, que es el que aplica a los ajustes de 2026. | Separar en dos acciones: `POST /contratos/:id/aplicar-incremento` (solo si pasaron ≥ 12 meses desde el último incremento o desde el inicio; usa el IPC del año anterior a la fecha de aplicación; en vivienda el porcentaje puede ser menor o igual al IPC, nunca mayor; en local o parqueadero, el porcentaje pactado) y `POST /contratos/:id/prorrogar` (solo alarga la fecha de fin, sin tocar el canon; solo dentro de los 90 días antes del vencimiento). Corregir los datos de `ConfiguracionIpc` en producción (2024 = 5,20; 2025 = 5,10) y recalcular a mano cualquier contrato renovado con el valor erróneo. |
| B-10 | Crítico (legal) | Las 3 plantillas, cláusula TERCERA | El texto dice "tendrá una duración de un (1) año" aunque las fechas digan otra cosa. La SEGUNDA dice "dentro de los primeros {{dia_pago}} días", que no coincide con cómo el sistema calcula la mora. | Calcular la duración en meses a partir de las fechas. Redactar el pago como "a más tardar el día {{dia_pago}} de cada mes". |
| B-11 | Crítico | `renovar()` sube el PDF a la **misma ruta** `contratos/{id}/contrato.pdf` | Cada renovación **sobrescribe el contrato original**. Se pierde la evidencia de lo que se firmó, contra la regla de que nada con valor legal se borra. | Versionar: `contratos/{id}/v{n}.pdf`, más una tabla `DocumentoContrato` (tipo `CONTRATO_ORIGINAL` / `OTROSI_INCREMENTO` / `OTROSI_PRORROGA`, versión, ruta, hash SHA-256, fecha). Un incremento o una prórroga generan un **otrosí** nuevo; el contrato original no se toca. |
| B-12 | Crítico (legal) | Cron `ejecutarTransicionVencimiento()` | En vivienda urbana, la Ley 820 (art. 6) dice que si ninguna de las partes avisa, el contrato **se prorroga automáticamente** en las mismas condiciones y por el mismo término. Hoy el sistema lo pasa a VENCIDO y libera la unidad. | **Decisión D-1, confirmada el 26/09/2026:** agregar "aviso de no renovación" (quién, cuándo, motivo, fecha del aviso). Al llegar la fecha de fin, si hay aviso, el contrato pasa a FINALIZADO al terminar ese día; si no hay aviso, se **prorroga automáticamente** por el mismo término inicial y se genera un otrosí de prórroga. Aplica a los tres tipos de plantilla. |
| B-13 | Importante | `confirmarTerminacionAnticipada()` | (a) No verifica que el contrato siga ACTIVO. (b) El arrendador puede **solicitar y confirmar él mismo**, así que la "terminación anticipada" es en la práctica unilateral y sin preaviso, algo que la Ley 820 no permite así para vivienda. (c) No hay forma de cancelar una solicitud ni se registra una fecha efectiva de entrega. | **Decisión D-2, confirmada el 26/09/2026:** confirma la **contraparte** de quien solicitó (si solicitó el Arrendador, confirma el Inquilino, y al contrario); validar ACTIVO; agregar `fecha_efectiva` y `POST .../cancelar-solicitud`. |
| B-16 | Importante | `ContratoService.crear()` | Permite crear el contrato sin la cédula del arrendador; el PDF sale con "[cédula pendiente de registrar]". | Responder 409 con un mensaje que lleve al perfil. |
| B-26 | Menor | DTOs de Inmueble y Unidad | Estrato y campos residenciales siempre obligatorios; `metros_cuadrados >= 1` incluso para un parqueadero. Además se puede cambiar `uso_permitido`/`tipo` con un contrato activo. | Validación condicional según la sección 5.3/5.4 del contexto; bloquear el cambio de uso o tipo mientras haya un contrato ACTIVO. |
| B-28 | Menor | `enum EstadoContrato` | `PROXIMO_A_VENCER` existe pero no se usa. | Eliminarlo con su migración (o documentar que nunca se guarda). |
| B-35 | Importante (nuevo) | `ContratoController` no tiene ningún `PATCH` | Un dato mal escrito al confirmar el contrato (canon, día de pago) es imposible de corregir sin terminar el contrato y crear otro, lo que genera un historial falso. | Permitir corregir los términos mientras el contrato **no esté vinculado** por el inquilino, regenerando el PDF. Una vez vinculado, un cambio de canon o día de pago es un otrosí, no una corrección. |
| B-41 | Importante (nuevo) | `ContratoService.crear()` | No valida que `fecha_inicio` sea de hoy en adelante. El contrato nace `ACTIVO` de inmediato con fecha futura, bloqueando la unidad antes de tiempo. | Aceptar fecha futura, pero no contar períodos antes del inicio (lo resuelve el estado de cuenta de 0.2) y no bloquear la unidad hasta la fecha de inicio real. |
| B-43 | Menor (nuevo) | Creación automática de la Unidad principal | Se crea con `metros_cuadrados: 0` y otros valores que el propio validador del DTO rechazaría si un usuario los enviara. | Crear la unidad principal con valores que pasen las mismas validaciones, o marcarla como "pendiente de completar". |

### 3.4 Identidad del inquilino y contratos múltiples

| ID | Sev. | Problema | Corrección esperada |
|---|---|---|---|
| B-14 | Crítico | **Migración a medias.** La cédula ya es única globalmente, pero `InquilinoService.listar/encontrarUno` filtran por `arrendador_id`, y `crear()` hace un `create` directo. Escenario real: en el asistente de la web, si se crea la ficha y luego el contrato falla (unidad ocupada), al reintentar con la misma cédula `POST /inquilinos` da **500**. Además, `validar-codigo` y `completar-registro` responden 409 "cuenta ya activada" cuando el inquilino ya tiene cuenta, así que **un segundo contrato nunca se puede vincular**. | Ver el diseño de la sección 3.5. |
| B-15 | Importante | Correo sin normalizar (índice único sensible a mayúsculas), sin verificación cruzada Arrendador ↔ Inquilino, y mensajes que revelan si un correo existe ("El correo ya está registrado", "El correo ya está en uso"). | Guardar y comparar en minúsculas y sin espacios (`trim().toLowerCase()`) + migración de datos; verificar ambas tablas antes de registrar o activar; mensaje genérico. |
| B-17 | Importante | `GET /inquilino/mi-panel`, `mi-contrato` y `mi-contrato/solicitar-terminacion-anticipada` resuelven **un** contrato (el ACTIVO o el más reciente). | `GET /inquilino/contratos` (lista) y rutas con id: `/inquilino/contratos/:id/panel`, `/:id`, `/:id/estado-cuenta`, `/:id/solicitar-terminacion`. Mantener las rutas viejas solo mientras la web las use. |
| B-21 | Importante | `completar-registro` recibe JSON con `foto_cedula_url` como texto; la web manda la foto en base64 dentro del JSON. Con una foto real, el límite de tamaño del cuerpo JSON la rechaza (413), y cuando cabe, queda guardada como texto en la base de datos. | Resuelto por B-03: subida real multipart, separada del registro (`POST /inquilino/perfil/foto-cedula`). |
| B-40 | Importante (nuevo) | `InquilinoPanelService.obtenerMiContrato()` filtraba `fotos_inventario` por `momento: ENTREGA`; nunca devolvía las de `DEVOLUCION`. | Traer todas las fotos y separarlas en la respuesta en `fotos_entrega` y `fotos_devolucion`. | ✅ Corregido en B0.1 (adelantado desde B0.4-B) |

### 3.5 Diseño recomendado: inquilino global con vinculación por código

Objetivo: una sola cuenta por persona, sin que un arrendador pueda "pegarle" contratos a un desconocido ni ver datos de otra relación.

1. **El asistente ya no crea fichas sueltas.** `POST /contratos` recibe `inquilino_id` (de un inquilino que ya tiene contrato con **este** arrendador) **o** `inquilino_nuevo { nombre, cedula, telefono }`. Dentro de la misma transacción del contrato se busca por cédula normalizada: si no existe, se crea; si existe, se reutiliza **sin modificar** su nombre ni teléfono y **sin devolver** al arrendador ningún dato que él no haya escrito. La respuesta es igual en ambos casos. `POST /inquilinos` queda obsoleto.
2. **Copia de datos en el contrato:** `Contrato.inquilino_nombre`, `inquilino_cedula`, `inquilino_telefono` guardan lo que escribió el arrendador. El PDF y las pantallas del arrendador usan esa copia. Así el contrato refleja lo firmado y no se filtran datos de otras relaciones.
3. **Vinculación:** `Contrato.vinculado_en` (nulo hasta que el inquilino usa el código). El portal del inquilino solo muestra contratos vinculados.
   - Persona sin cuenta: `validar-codigo` → `completar-registro` crea la cuenta y vincula ese contrato.
   - Persona con cuenta: `validar-codigo` responde un mensaje genérico ("Inicia sesión y agrega este código"). Ya dentro de la app, `POST /inquilino/contratos/vincular { codigo }` vincula el contrato.
4. **Cédula equivocada:** mientras el contrato no esté vinculado, el arrendador puede corregir los datos del inquilino (`PATCH /contratos/:id/inquilino`). Si corrige la cédula, el contrato se reasigna a la identidad correcta y el código se regenera.
5. **Listado del arrendador:** `GET /inquilinos` se construye desde sus contratos (inquilinos distintos), con la copia de datos y un indicador `vinculado`. El correo del inquilino solo se muestra si el contrato está vinculado.
6. `Inquilino.arrendador_id` se elimina después de migrar (primero se deja de usar y luego se borra la columna, en dos pasos).
7. Pendiente menor: tipo de documento (CC, CE, pasaporte) junto a la cédula, para evitar choques entre números de documentos distintos.

### 3.6 Alertas, tareas diarias e infraestructura

| ID | Sev. | Problema | Corrección esperada |
|---|---|---|---|
| B-18 | Importante | `Alerta` solo tiene `arrendador_id`. No existen alertas para el inquilino. | Agregar `destinatario` (`ARRENDADOR`/`INQUILINO`) e `inquilino_id` opcional; `GET /inquilino/alertas` y `PATCH .../leida`; tipos nuevos: `PAGO_APROBADO`, `PAGO_RECHAZADO`, `MANTENIMIENTO_CAMBIO_ESTADO`, y el recordatorio de pago va al inquilino. |
| B-19 | Importante | Todo se calcula con la hora del servidor (UTC). El cron de vencimiento corre a las 23:55 UTC con `fecha_fin < now()`, así que un contrato que termina el día X se marca vencido el mismo día X (hacia las 6:55 pm hora de Colombia). | Hora oficial del negocio: `America/Bogota`. Una utilidad `hoyEnBogota()` usada por las tareas diarias, el estado de cuenta y los validadores de fecha. El contrato vence cuando **termina** el día `fecha_fin`. |
| B-20 | Importante | Las 6 tareas diarias son `@Cron` dentro del proceso. En Render gratis, si el servicio está dormido o se reinicia a esa hora, **ese día no corren** y nada lo recupera. | Un solo endpoint interno `POST /interno/tareas-diarias`, protegido con un encabezado secreto (`TAREAS_SECRET`), que ejecuta las tareas en orden (primero la de vencimiento). Lo llama **cron-job.org** (ya en uso) todos los días a las 00:05 hora de Colombia, con reintento. Las tareas deben poder correr dos veces sin duplicar nada. Se quitan los `@Cron`. |
| B-23 | Menor | El ZIP de documentos incluye comprobantes RECHAZADOS y REEMPLAZADOS. | Solo los APROBADOS. |
| B-24 | Importante | Muchos DTOs no tienen `@ApiProperty`, así que Swagger los muestra vacíos y no se pueden generar tipos para la app. | Activar el plugin de Swagger de Nest CLI en `nest-cli.json` (`"compilerOptions": { "plugins": ["@nestjs/swagger"] }`), que documenta los DTOs automáticamente, y declarar el tipo de respuesta de los endpoints principales. | ✅ Plugin activado en B0.0; tipos de respuesta pendientes desde B0.2 |
| B-27 | Importante | Ningún listado tiene paginación. Cada elemento con archivo genera **una llamada a Supabase** para firmar su URL (una lista de 50 pagos son 50 llamadas). | Paginación por cursor (`?cursor=&limite=20`) en pagos, contratos, solicitudes y alertas, con la respuesta `{ items, siguienteCursor }`. Firmar URLs en lote (`createSignedUrls`) o bajo demanda. |
| B-29 | Menor | `GET /solicitudes-mantenimiento/mias` y `GET /solicitudes-mantenimiento/:id` están en dos controladores distintos; que funcione depende del orden en que se registran. | Cambiar la ruta del inquilino a `/inquilino/solicitudes` (en línea con B-17). |
| B-31 | Menor | `main.ts`, función de validación de origen de CORS (líneas 19 a 24) | Los parámetros `origin` y `callback` quedaron sin tipo, así que son `any`: `npm run lint` reporta 2 errores y 2 advertencias (`no-unsafe-call`, `no-unsafe-argument`). Entró con el cambio de CORS al cierre del Paso 11, que no pasó por lint. No afecta el funcionamiento ni el build. Detectado el 26/09/2026. | Tipar explícitamente los dos parámetros (`origin: string \| undefined` y el `callback`), o anotar el objeto de opciones con el tipo `CorsOptions` de Nest para que los tipos se infieran solos. Se corrige en el Bloque 0.1, que ya toca `main.ts`. Criterio: `npm run lint` queda sin ninguna salida. | ✅ Corregido en B0.1 |
| — | Importante | Formato de error inconsistente. | Un filtro global de excepciones que responda siempre `{ statusCode, codigo, mensaje, detalles? }`, con `codigo` estable (por ejemplo `CONTRATO_NO_ACTIVO`) para que la app muestre textos propios sin analizar mensajes. | ✅ Corregido en B0.1 (`src/common/filtros/filtro-excepciones-global.ts`) |

### 3.7 Hallazgos adicionales — auditoría de escenarios operativos (26-27/09/2026)

Revisión complementaria hecha sobre 30 escenarios operativos concretos (documento completo: `RentCheck_Escenarios_Operativos.md`, en `docs/` del repositorio). De ahí salieron 15 IDs nuevos, ya repartidos entre los bloques de la sección 4:

| ID | Sev. | Resumen | Bloque | Estado |
|---|---|---|---|---|
| B-32 | Crítico (privacidad) | `mi-contrato` exponía `datos_recaudo` con el contrato ya terminado (viola la regla 11 del contexto) | 0.1 | ✅ Corregido |
| B-33 | Importante | Eliminar un inmueble con documentos cargados responde 500 por llave foránea en vez de 409 con mensaje | 0.1-B | ✅ Corregido |
| B-34 | Importante | No existe forma de regenerar el PDF de un contrato si su generación falló al crearlo | 0.3-B | ⬜ |
| B-35 | Importante | No existe `PATCH` de contrato: un dato mal escrito es imposible de corregir sin terminar el contrato | 0.3-A | ⬜ |
| B-36 | Importante | Transiciones de estado sin escritura condicional (doble aprobación de pago, doble confirmación de terminación, doble cambio de estado de mantenimiento); además, ediciones concurrentes sin control de versión | 0.1-B (transiciones) / 0.5 (control de versión) | 🔶 Transiciones corregidas en B0.1-B; control de versión pendiente en 0.5 |
| B-37 | Importante | Un fallo al firmar la URL de un solo archivo tumba con 500 el listado completo (`Promise.all` sin tolerancia a fallos) | 0.5 | ⬜ |
| B-38 | Importante | Con contrato terminado, el inquilino no puede reportar lo que quedó debiendo de períodos anteriores al cierre | 0.2-B | ⬜ |
| B-39 | Menor | `fecha_reportada` de un pago no se valida contra la fecha de inicio del contrato | 0.2-B | ⬜ |
| B-40 | Importante | `mi-contrato` nunca devolvía las fotos de devolución (solo las de entrega) | 0.1 | ✅ Corregido |
| B-41 | Importante | Un contrato con fecha de inicio futura nace `ACTIVO` de inmediato y bloquea la unidad antes de tiempo | 0.3-A | ⬜ |
| B-42 | Importante | Comprobantes reemplazados y rechazados se acumulan en el bucket sin política de retención | 0.5 | ⬜ |
| B-43 | Menor | La unidad principal se crea automáticamente con valores que el propio validador del DTO rechazaría | 0.3-A | ⬜ |
| B-44 | Importante | El ZIP de documentos descarga todo a memoria en una sola petición: riesgo de tiempo agotado con historiales grandes | 0.5 | ⬜ |
| B-45 | Importante | No se puede anular una aprobación de pago hecha por error | 0.6 | ⬜ |
| B-46 | Importante | No existe baja de cuenta del inquilino (Ley 1581 de 2012 y requisito de Google Play para publicar) | Antes de usuarios reales | ⬜ |

Para el detalle de cada escenario (qué pasa hoy, qué debería pasar, cómo probarlo a mano), ver el documento completo. Cuando se dé el prompt de cada bloque, se referencia el escenario correspondiente además del ID.

---

## 4. Fase 0 — correcciones del backend en bloques de trabajo

Cada bloque es **una entrega**: una rama, uno o dos prompts, una verificación completa y un commit o merge. El orden importa, porque cada bloque deja al siguiente sobre terreno firme.

| Bloque | Contenido | IDs | Prompts estimados | Requisito previo |
|---|---|---|---|---|
| **0.0 Preparación** | AGENTS.md, CLAUDE.md, docs/, plugin de Swagger, JSON en /api-json | B-24 | 1 | — |
| **0.1 Seguridad inmediata** | Selects explícitos, quitar rutas escritas por el cliente, `trust proxy`, `ParseIdPipe`, límite de intentos en activación, filtro global de errores, tipar el callback de CORS, datos de recaudo por estado, fotos de entrega/devolución separadas | B-01, B-03 (quitar campos), B-04, B-22, B-31, límite de B-02, formato de error, B-32, B-40 | 1 | 0.0 |
| **0.1-B Consistencia de escrituras** | Eliminar inmueble con documentos (409 en vez de 500), escrituras condicionales en transiciones de estado (pago, terminación, mantenimiento) | B-33, B-36 (transiciones) | 1 | 0.1 |
| **0.2 Motor de pagos por período** | `Pago.periodo`, `calcularEstadoCuenta` con pruebas unitarias, estado de pago derivado, reemplazo por período, endpoint de estado de cuenta, `Idempotency-Key`, `hoyEnBogota()`, pagos de contrato terminado, validación de fecha reportada | B-05, B-06 (cálculo), B-07, B-19, B-38, B-39 | 2 (A: función pura + pruebas; B: integración + migración + e2e) | D-3 confirmada |
| **0.3 Contrato legal** | Depósito condicional, plantillas corregidas, incremento y prórroga separados, versiones de PDF (otrosí), terminación con contraparte, cédula del arrendador obligatoria, corrección de datos de IPC, PATCH de contrato sin vincular, fecha de inicio futura, unidad principal válida, regenerar PDF | B-08, B-09, B-10, B-11, B-12, B-13, B-16, B-26, B-35, B-41, B-43, B-34 | 2 (A: reglas y endpoints; B: PDF y versiones) | D-1 y D-2 confirmadas |
| **0.4 Identidad y multi-contrato** | Diseño de la sección 3.5, correo normalizado y mensajes genéricos, código nuevo con expiración, rutas del inquilino por contrato, subidas reales de fotos de cédula y foto de unidad | B-02, B-03 (subidas), B-14, B-15, B-17, B-21, B-29 | 2 (A: modelo + migración + auth; B: rutas del inquilino + subidas) | 0.1 |
| **0.5 Infraestructura** | Endpoint de tareas diarias + cron-job.org, zona horaria en tareas, paginación, firma de URLs en lote, ZIP solo aprobados, tolerancia a fallos al firmar, política de retención del bucket, ZIP sin memoria, control de versión en ediciones | B-19 (tareas), B-20, B-23, B-27, B-37, B-42, B-44, B-36 (control de versión) | 1 | 0.2 |
| **0.6 Para la app (en paralelo con móvil)** | Alertas del inquilino, tokens de notificación y envío, sesiones con token de renovación, anular aprobación de pago | B-18, B-25, push, B-45 | 2 | 0.4 |

Después de cada bloque: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint`, `npm run test:e2e` (con la salida completa), redespliegue en Render y una prueba real en Swagger de producción. Las migraciones de datos (IPC, correos, períodos) siempre muestran el conteo de registros antes de aplicarse.

**Antes de manejar usuarios reales** (no bloquea el desarrollo): B-46 (baja de cuenta), doble factor para el arrendador, auditoría de acciones sensibles, detección de comprobantes duplicados (hash del archivo), verificación de correo y recuperación de contraseña (requieren un proveedor de correo; ver 7.4), consentimiento de datos personales (Ley 1581) y política de retención.

---

## 5. Tecnología de la app móvil

**Base: React Native + Expo + TypeScript.** La razón no cambia: el equipo ya conoce React, sirve un solo código para Android e iOS, y Expo resuelve cámara, notificaciones y empaquetado sin tocar Android Studio.

| Necesidad | Pieza | Notas |
|---|---|---|
| Proyecto | `npx create-expo-app@latest` con plantilla TypeScript | Usar el **SDK estable más reciente** al momento de crear el proyecto (confirmar en expo.dev/changelog). No fijar la versión de memoria. |
| Navegación | **Expo Router** (rutas por archivos) | Grupos `(auth)`, `(arrendador)`, `(inquilino)`; el diseño de cada grupo protege por rol. |
| Datos del servidor | **TanStack Query** | Caché, reintentos, recarga al volver a la app y soporte de persistencia para leer sin conexión. |
| Formularios | **React Hook Form + Zod** | Los esquemas de Zod reflejan las reglas del backend (el servidor sigue siendo quien valida). |
| Tipos de la API | **openapi-typescript** desde `/api-json` | Script `npm run api:tipos`. Ya disponible desde B0.0. |
| Sesión | **expo-secure-store** | Token de acceso y de renovación. Nunca AsyncStorage para esto. |
| Cámara y galería | **expo-image-picker** + **expo-image-manipulator** | Redimensionar a unos 1600 px, JPEG al 70-80 %. Volver a codificar la imagen elimina los metadatos EXIF (ubicación); igual el backend debe limpiarlos también. |
| Documentos | **expo-document-picker**, **expo-file-system**, **expo-sharing** | Comprobante en PDF; descargar y compartir el PDF del contrato por WhatsApp o correo. |
| Enlace de activación | **expo-linking** + esquema `rentcheck://` | Enlace o QR que abre la pantalla de activación con el código ya escrito. |
| Notificaciones | **expo-notifications** + **servicio de push de Expo** | El backend envía a `https://exp.host/--/api/v2/push/send` sin SDK de Firebase propio. En Android, Expo usa FCM por debajo: hay que crear un proyecto de Firebase (plan gratis) y subir la credencial a EAS. **No funcionan en Expo Go**: requieren una *development build*. |
| Biometría | **expo-local-authentication** | Confirmar acciones sensibles y desbloqueo opcional. |
| Cola sin conexión | **expo-sqlite** (o persistencia de mutaciones de TanStack Query) | Cada envío en cola lleva su `Idempotency-Key`. |
| Estilos | **NativeWind** (Tailwind para React Native), opcional | Aprovecha lo que ya saben de Tailwind. El diseño visual se define aparte; por ahora, tokens de color y tipografía en un solo archivo `tema.ts`. |
| Compilación | **EAS Build** (plan gratis) | Development build para probar en el teléfono; `preview` para generar un APK instalable. |

**Una sola app para los dos roles** (recomendación, decisión D-5 del contexto): pantalla inicial "Soy arrendador / Soy inquilino", que cambia según el rol de la sesión. Publicar dos apps duplica el costo de publicación, las revisiones y el mantenimiento, sin beneficio real a esta escala.

---

## 6. Estructura del proyecto móvil

```
rentcheck-mobile/
  AGENTS.md                 # reglas persistentes para Codex (ver instrucciones)
  CLAUDE.md                 # reglas para Claude Code (importa AGENTS.md)
  app/                      # Expo Router
    (auth)/                 # bienvenida, login, registro, activar/[codigo]
    (arrendador)/           # pestañas: panel, inmuebles, contratos, pagos, más
    (inquilino)/            # selector de contrato, panel, pagos, solicitudes, más
  src/
    api/                    # cliente fetch, interceptores, tipos generados (tipos.gen.ts)
    consultas/              # hooks de TanStack Query por módulo
    componentes/            # UI reutilizable
    sesion/                 # secure-store, contexto de sesión, rol
    offline/                # cola de envíos
    utilidades/             # dinero (centavos ↔ pesos), fechas Bogotá, imágenes
    tema.ts
  .env                      # EXPO_PUBLIC_API_URL (no poner secretos: todo lo EXPO_PUBLIC queda dentro de la app)
```

Reglas del cliente de API: tiempo de espera de 60 s en la primera petición (arranque en frío) y 20 s en las siguientes; ante un 401, un solo intento de renovar el token y, si falla, cerrar sesión; los errores se muestran según `codigo`; el dinero siempre viaja en centavos (entero) y se formatea solo al mostrarlo.

---

## 7. Costos y distribución — datos reales

| Concepto | Costo | Comentario |
|---|---|---|
| Expo / EAS Build (plan gratis) | USD 0 | Cupo mensual limitado de compilaciones y cola de espera. Suficiente para el proyecto. |
| Firebase (plan Spark) para FCM | USD 0 | No pide tarjeta. |
| Servicio de push de Expo | USD 0 | — |
| **Cuenta de Google Play Console** | **USD 25, pago único** | Requiere un medio de pago. Las cuentas personales nuevas además deben hacer una **prueba cerrada con al menos 12 testers durante 14 días seguidos** antes de publicar en producción. |
| Apple Developer (iOS) | USD 99 al año | Solo si se publica en App Store. |
| Proveedor de correo (recuperación de contraseña y verificación) | USD 0 con límites | Por ejemplo Resend o Brevo en plan gratis. Confirmar al momento si piden tarjeta. |

**Recomendación para la etapa académica (SENA):** no publicar en Google Play todavía. Distribuir con **EAS Build → APK** (perfil `preview`, distribución interna): se instala con un enlace, no cuesta nada y sirve para la sustentación y las pruebas con usuarios. La publicación en tienda se planea cuando haya presupuesto para los USD 25 y 12 testers disponibles.

---

## 8. Orden de trabajo

1. **Fase 0** (sección 4): bloques 0.0 → 0.6, en orden (0.1-B se hace justo después de 0.1). Las decisiones D-1, D-2 y D-3 quedaron confirmadas el 26/09/2026, así que ningún bloque está bloqueado.
2. **App móvil**, por entregas E1 → E12 (lista, alcance y criterios en `RentCheck_instrucciones_desarrollo_movil.md`). El bloque 0.6 se hace en paralelo, justo antes de las entregas que lo necesitan (alertas del inquilino antes de E9, push antes de E10, sesiones antes de E12).
3. **Web**: se reconstruye al final, contra la API ya corregida, reutilizando los tipos generados.
