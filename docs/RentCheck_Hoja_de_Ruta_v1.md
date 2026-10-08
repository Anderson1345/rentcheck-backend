# RentCheck — Hoja de ruta hacia la versión de demostración

> **Versión 1.1 — 8 de octubre de 2026.** Estado: **propuesta**; D-21 decidida (sí: APK ya; A1 cerrada en código el 08/10/2026). Las demás decisiones de la sección 8 las toma Jesús.
> Ordena todo lo que falta en un solo camino: lo pendiente del plan de rediseño (`RentCheck_Plan_Rediseno_UX.md` §4, pasos 7 a 11), las ideas de `RentCheck — Funciones que hacen la diferencia.md` y la versión web.
> Cuando se apruebe, **reemplaza** el orden de esos dos documentos. Las reglas de negocio siguen en el documento 1 (Contexto), los B-xx en el documento 2 (Plan Técnico) y el estado de cada entrega en el documento 3 (instrucciones).

---

## 1. Resumen

- **Meta inmediata:** un **APK instalable** para mostrar en el SENA. Se puede tener **ya**, con lo que existe hoy, sin esperar nada más (Fase 0). Cada fase siguiente termina con un APK nuevo.
- **La competencia ya hace lo básico**, y algo más de lo que decía el documento de funciones: hay quien ya da recibos y paz y salvo (Alquilando) y quien ya registra gastos e impuestos por inmueble y emite factura DIAN (MisPropiedades, desde USD 10 al mes). Esas funciones son **paridad**: hay que tenerlas, pero no hacen que alguien elija RentCheck.
- **Lo que sí diferencia a RentCheck** (sección 3.3): app nativa para los **dos** roles y gratis con una unidad; las reglas de la Ley 820 **aplicadas por el sistema** (ya construido, falta mostrarlo); el **historial de buen pagador** que es del inquilino; el **lector de comprobantes con IA** con detección de duplicados; y el cobro amable por WhatsApp.
- **Orden propuesto:** Fase 0 APK → Fase 1 pagos verificables → Fase 2 diferenciales (versión de demostración completa) → Fase 3 web → Fase 4 lo que necesita development build (push, Google) y pasarela → Fase 5 antes de usuarios reales.
- **Web:** recomendación de construirla **desde el mismo proyecto Expo** (React Native Web), con diseño adaptado a pantalla ancha. Una sola base de código, mismas reglas y mismo estilo.
- **Costo de todo el camino hasta la demostración: $0.** Lo único que cuesta (Play Store, dominio, IA de pago, Wompi en producción) queda en la Fase 5.

---

## 2. Dónde estamos (7 de octubre de 2026)

| Área | Estado |
|---|---|
| Backend (Fase 0 de correcciones, alertas, Panel v2) | Cerrado hasta B0.7. Pendientes: B0.6-B3 (push), B0.6-B4 (sesiones), B0.6-B5 (aplazada), B-84 y B-87 a B-90 (P1-B), B-83 (Google), B-85 (Wompi) |
| App móvil, funciones de la versión 1 | E1 a E9 cerradas: acceso, inmuebles, contratos con PDF, pagos, mantenimiento, portal del inquilino, alertas, Panel |
| Rediseño de estructura | **Completo** (D2, R1 a R4, B0.7) |
| Pendiente del plan de rediseño | P1 (Bre-B y referencia), push + E10, Google (G1), sesiones (B0.6-B4), Wompi (P2); E11, E12, B0.6-B5, E3-C |
| Ideas nuevas | Propuestas en el documento de funciones; ninguna aprobada todavía (D-15 a D-18) |
| Web | Frontend web anterior congelado (`web-v1-congelada`); la web nueva es la fase 3 del documento 1 |
| Distribución | Solo Expo Go; **nunca se ha generado un APK** |

---

## 3. Competencia en Colombia, revisada

El documento de funciones usaba notas de 2021 a 2023. Esta tabla se revisó el 7 de octubre de 2026 con las páginas oficiales. "No lo menciona" significa que su página pública no lo dice, no que no lo tenga.

### 3.1 Quién es quién

| Opción | A quién sirve | Qué ofrece (según su página) | Precio publicado | App nativa |
|---|---|---|---|---|
| **MisPropiedades** | Propietarios y administradores (su plan publicado es de 10 a 50 propiedades) | Contratos con renovación e incremento por porcentaje o IPC, cuentas de cobro automáticas por correo y SMS, pago en línea con Wompi, recibos, portal del inquilino (pagar, subir comprobante, reportar incidentes), mantenimiento, **gastos e impuestos por propiedad**, balances a propietarios, **factura electrónica DIAN** | USD 10 al mes en el plan de 10 a 50 propiedades; prueba de 7 días | No lo menciona ("desde cualquier dispositivo") |
| **Alquilando** | Propietario directo, inquilino, inmobiliarias aliadas y corredores | Publicar y buscar, contratos y **firma digital**, pagos con Nequi, PSE y código de barras con confirmación inmediata, **recibos y paz y salvo**, estados de cuenta, solicitudes de daños, seguros, **pago garantizado** aunque el inquilino se atrase, adelantos | No publica precios | Sí ("desde la app") |
| **Arrendo** | Propietario e inquilino (marketplace + gestión) | Publicar y buscar, contratos digitales con renovación, cobros automáticos, portal del inquilino con comprobantes e historial, reportes de ingresos y ocupación, alertas | No publica precios | No lo menciona |
| **Houm** | Propietario que delega e inquilino | Intermediación completa, visitas guiadas, firma en línea; desde octubre de 2024, arriendo **sin codeudor** | No publica | Plataforma web |
| **Inmobiliaria tradicional** | Propietario que delega todo | Publicar, estudiar, contratar, cobrar | 8 a 12 % del canon al mes + IVA | — |
| **Wasi / software inmobiliario** | Inmobiliarias | CRM, portales, sitio web | Desde USD 30 por usuario al mes (dato del documento de funciones) | — |
| **Neivor** | Operadores grandes (multifamily, centros comerciales); mercado principal México | Cobro automático, conciliación, firma digital, app de comunidad | No publica | Sí (comunidad) |

### 3.2 Quién tiene qué

| Función | MisPropiedades | Alquilando | Arrendo | RentCheck hoy | RentCheck con este plan |
|---|---|---|---|---|---|
| Contratos y renovación | Sí | Sí, con firma digital | Sí | Sí, 3 plantillas con PDF versionado y huella | Igual |
| Cobro y estado de cuenta | Sí | Sí | Sí | Sí, por períodos con mora | Igual |
| Portal del inquilino | Web | App | Web | **App nativa** | App + web |
| Pago en línea confirmado | Wompi | Nequi, PSE | Portal | No (comprobante) | Bre-B + referencia (F1); Wompi pruebas (F4) |
| Recibos y paz y salvo | Recibos | Sí | No lo menciona | No | **Sí, con QR verificable** (F2) |
| Gastos e impuestos | Sí + DIAN | No lo menciona | No lo menciona | No | F4 (paridad) |
| Reglas de la Ley 820 aplicadas por el sistema (tope del IPC en vivienda, sin depósito en vivienda, prórroga automática, terminación por mutuo acuerdo con advertencia, otrosíes versionados) | Incremento "con o sin IPC" | No lo menciona | No lo menciona | **Sí** | Sí, y se muestra en la demo |
| Historial de buen pagador del inquilino, verificable y controlado por él | No | No | "Historial" interno | No | **Sí** (F2) |
| Lectura de comprobantes con IA y detección de duplicados | No | No | No | No | **Sí** (F2) |
| Acta de entrega aceptada por las dos partes | No lo menciona | No lo menciona | No lo menciona | Fotos de entrega | F4 |
| Cobro asistido por WhatsApp | SMS y correo automáticos | No lo menciona | No lo menciona | No | **Sí** (F1) |
| Gratis para empezar | Prueba de 7 días | — | — | — | **Gratis con 1 unidad** (propuesta D-18) |

### 3.3 Qué cambia frente al documento de funciones

1. **Recibos y paz y salvo (idea 1) son paridad, no diferencia.** Alquilando ya los entrega. Se hacen igual porque el inquilino los espera, pero se agrega lo que los demás no dicen tener: el **QR que verifica** que el documento es auténtico. Esa verificación es la misma pieza que necesita el historial de buen pagador.
2. **Gastos y rentabilidad (idea 6) también son paridad**: MisPropiedades ya registra gastos e impuestos por propiedad y emite factura DIAN. Baja a la Fase 4.
3. **El historial de buen pagador (idea 2) es la apuesta más fuerte.** En la búsqueda no apareció ninguna plataforma colombiana que le entregue al inquilino un historial verificable y controlado por él. Hoy al inquilino se le piden codeudores, certificado laboral y referencias personales; no hay forma de demostrar que paga a tiempo. Es lo que hace que el **inquilino** quiera usar RentCheck y se lo pida a su próximo arrendador.
4. **Las reglas de la Ley 820 ya son un diferencial y no se están mostrando.** El documento de funciones lo da por hecho; en la demostración debe verse: el sistema no deja poner depósito en vivienda, calcula el tope del incremento y prorroga solo.
5. **La app nativa para los dos roles es una ventaja real:** MisPropiedades y Arrendo no mencionan app. Alquilando sí, pero su negocio es intermediar y garantizar el pago, no darle la herramienta al propietario que arrienda solo.

**Propuesta de valor (ajustada):** *"Arrienda directo con las reglas de la ley ya puestas: contratos que cumplen la Ley 820, pagos que se leen y se verifican solos, y un historial de buen pagador que el inquilino se lleva al próximo arriendo. Gratis con tu primera unidad."*

---

## 4. Principios para ordenar el trabajo

1. **Primero algo que se pueda mostrar.** La app ya tiene suficiente para una demostración. El APK sale en la Fase 0, no al final (antes estaba en E12).
2. **Cada fase termina con un APK nuevo** que funciona. Una compilación por fase alcanza de sobra para el plan gratuito.
3. **Diferenciales antes que paridad cara.** Lo que nadie más tiene va antes que lo que todos tienen.
4. **Lo que exige development build, cuentas externas o configuración delicada (push con Firebase, Google, Wompi) va después de la demostración**, salvo que el SENA lo pida.
5. **Las reglas no cambian.** Dinero en centavos, fechas de Bogotá, nada legal se borra, 404 para lo ajeno, una migración por entrega, backend y app en prompts separados.

---

## 5. Fases

### Fase 0 — APK de demostración (ya)

| Entrega | Repo | Qué | Esfuerzo |
|---|---|---|---|
| **A1** | app | Configuración para compilar: `eas.json` con perfil `preview` que genera **APK**; nombre, ícono y pantalla de inicio; identificador de Android; esquema `rentcheck://`; la URL del backend de Render fijada para la compilación; pantallas de diagnóstico y galería fuera del APK; versión visible en "Más"; permisos de Android revisados (cámara, fotos; nada de ubicación ni contactos). Sin cambios de funciones | Bajo |
| **R5** (opcional) | app | Pulido de las 5 piezas que quedaron fuera del rediseño (R4-E): documentos del contrato del arrendador, código de acceso, "Duplicar" y "Eliminar" de la unidad, detalle de solicitud del inquilino, `ResultadoCorreccion` y `BotonRegenerar` | Bajo |

**Lo que haces tú en la Fase 0:** crear una cuenta gratis en expo.dev, instalar `eas-cli`, iniciar sesión y lanzar una compilación en la nube. EAS crea y guarda la llave de firma de Android. El APK se descarga con un enlace y se instala en el teléfono permitiendo "orígenes desconocidos". Los pasos exactos van con el prompt de A1.

**Costo:** $0. El plan gratuito de EAS permite hasta 15 compilaciones de Android al mes, con prioridad baja (en horas pico la espera puede pasar de 90 minutos), un tiempo máximo de 45 minutos por compilación y sin cobros extra. La compilación local (`eas build --local`) solo funciona en Linux o macOS (en Windows, con WSL2), así que se usa la nube.

**Resultado:** RentCheck instalado como app real, con todo lo que existe hoy. Además, el enlace `rentcheck://activar/<código>` por fin se puede probar completo, porque en Expo Go no abría. En A1 se evalúa que el QR del código lleve ese enlace (hoy lleva solo el texto del código), para que escanearlo con la cámara abra la app.

### Fase 1 — Pagos verificables (lo que queda del plan de rediseño y sí sirve a la demostración)

| Entrega | Repo | Qué |
|---|---|---|
| **P1-B** | backend | Llave Bre-B del arrendador y **referencia única por período** (B-84, **1 migración**). Sin migración: puntualidad "N de M a tiempo" (B-87), vencidos en el panel de un contrato terminado (B-88), nombre y teléfono del arrendador para su inquilino (B-89), vista previa de incremento y prórroga (B-90) |
| **P1-A1** | app | El arrendador configura su llave; "Cómo pagar" del inquilino con llave y referencia para copiar; referencia en Reportar pago; **cobro amable por WhatsApp** (idea 4): botón con mensaje ya escrito y aviso fuera del horario de la Ley 2300 de 2023 |
| **P1-A2** | app | "N de M a tiempo" en Tus pagos, tarjeta del arrendador con "Llamar", vencidos de un contrato terminado, canon nuevo y fecha nueva en el resumen de incremento y prórroga |

Antes de P1-A1 se verifica otra vez en el texto de la Ley 2300 el horario y la frecuencia permitidos para cobrar.

**Resultado:** APK 2. Los pagos tienen referencia, el inquilino sabe a dónde pagar y el arrendador cobra por WhatsApp sin escribir nada.

### Fase 2 — Lo que hace la diferencia (versión de demostración completa)

| Entrega | Repo | Qué | Depende de |
|---|---|---|---|
| **N1-B / N1-A** | backend / app | Recibo en PDF por pago aprobado (consecutivo por arrendador, huella, QR) y paz y salvo con fecha de corte. **Página de verificación pública servida por el mismo backend** (HTML mínimo: "auténtico" o "no encontrado"), así no depende de que exista la web | P1-B (referencia) |
| **N2-B / N2-A** | backend / app | **Lector de comprobantes con IA** (idea 3): autollenado en Reportar pago y semáforo "leído vs. reportado vs. esperado" en Validar pagos; **detección del mismo archivo usado dos veces** (huella). La IA sugiere, nunca aprueba. Si falla o tarda más de unos 10 segundos, el formulario queda manual | P1-B |
| **N3-B / N3-A** | backend / app | **Historial de buen pagador** (idea 2): "Mi historial" del inquilino, certificado con consentimiento (Ley 1581), enlace con vencimiento y revocación, verificación con la página de N1. Sin buscador por cédula | B-87 (P1-B) y N1 |
| **X1** | backend (script) + guía | **Datos y guion de demostración**: un script que crea por la API un arrendador, dos inmuebles, contratos con pagos a tiempo, uno en mora, solicitudes y un historial de 6 meses; cuentas de prueba; guion de 7 minutos (sección 9) | N1 a N3 |

Cada entrega B lleva como máximo una migración (se estima una en cada una de N1, N2 y N3).

**Resultado:** APK 3, la **versión de demostración**. Se presenta en el SENA con el guion de la sección 9.

### Fase 3 — Web

Ver la sección 7 para el cómo. Entregas:

| Entrega | Repo | Qué |
|---|---|---|
| **W0** | app (solo lectura) | Diagnóstico: qué librerías del proyecto funcionan en web, qué se reemplaza en web (sesión, cámara, compartir, PDF, QR), tamaño del paquete, y si el backend ya acepta el origen web (CORS) |
| **D3** | lienzo de diseño | Maquetas de escritorio con la misma identidad Medianoche: Panel del arrendador, Contratos (lista y detalle lado a lado), Validar pagos, Mi panel del inquilino. Jesús las aprueba antes de programar |
| **W1** | app | Base web: navegación lateral en pantalla ancha y barra inferior en celular, contenedor de ancho máximo, sesión en el navegador, rutas públicas y privadas, despliegue en Vercel |
| **W2** | app | Arrendador a ancho de escritorio: listas como tablas, lista y detalle lado a lado, formularios a dos columnas |
| **W3** | app | Inquilino a ancho de escritorio |
| **W4** | app | Público: landing con la propuesta de valor, **calculadoras** (idea 9: cuánto puedo subir el arriendo; inmobiliaria vs. RentCheck), planes como propuesta (D-18), descarga del APK |

**Costo:** $0. Vercel Hobby es gratis y no pide tarjeta, pero solo admite proyectos personales y no comerciales; para el SENA sirve. Si RentCheck se vuelve comercial, se cambia de proveedor (Cloudflare Pages, Netlify) en la Fase 5.

### Fase 4 — Completar la versión 1 del documento 1 (después de la demostración, o antes si sobra tiempo)

| Entrega | Qué | Por qué va aquí |
|---|---|---|
| **B0.6-B3 + E10** | Notificaciones push | Necesita development build y credenciales de Firebase (gratis). En la demo bastan las alertas dentro de la app |
| **B0.6-B4 + E12** | Sesiones renovables y cierre de todas las sesiones; borrado de datos locales, versión mínima y biometría | Indispensable antes de usuarios reales, no para mostrar |
| **G1-B / G1-A** | Entrar con Google | Necesita development build y un proyecto de Google Cloud |
| **P2-B / P2-A** | Wompi en modo pruebas con confirmación automática | Vistoso, pero con webhook y llaves de prueba; Bre-B + IA ya cubren "pagos verificables" en la demo |
| **N4-B / N4-A** | Gastos, rentabilidad y reporte anual (idea 6) | Paridad con MisPropiedades; 1 migración |
| **N5-B / N5-A** | Acta de entrega aceptada por las dos partes (idea 5) | Diferencial, pero menos visible en una demo corta |

### Fase 5 — Antes de usuarios reales

E11 (sin conexión), B0.6-B5 (anular aprobación y salud), E3-C (documentos del inmueble), dominio propio + correo (D-9: recuperar contraseña y verificación de correo reales), revisión de un abogado de las plantillas, Play Store (USD 25 y 12 testers, D-8), IA de pago o dentro del teléfono para comprobantes reales (D-17), ideas 7 (asistente del contrato) y 8 (vacante con enlace), hosting web comercial.

---

## 6. Qué pasa con cada paso pendiente

| Pendiente | Antes | Ahora | Motivo |
|---|---|---|---|
| P1 (Bre-B y referencia) | Plan de rediseño, paso 7 | **Fase 1** | Base de la IA, los recibos y el historial |
| WhatsApp (idea 4) | Dentro de P1-A | Fase 1, P1-A1 | Igual |
| APK | E12, al final | **Fase 0** | Se necesita para mostrar ya |
| Push (B0.6-B3 + E10) | Paso 8 | Fase 4 | Development build y Firebase; no es necesario para la demo |
| Google (G1) | Paso 9 | Fase 4 | Igual |
| Sesiones (B0.6-B4) | Paso 10 | Fase 4 (antes de usuarios reales) | No se nota en una demo |
| Wompi (P2) | Paso 11 | Fase 4 | Bre-B + IA cubren la demo |
| E11 sin conexión | Después de P2 | Fase 5 | Complejo; el documento 1 lo deja en la versión 1, pero no es necesario para la demostración |
| E12 endurecimiento | Final | APK en la Fase 0; el resto en la Fase 4 | Se separa lo urgente de lo que no |
| Recibos, IA, historial (ideas 1, 3, 2) | Documento de funciones | Fase 2 | Diferenciales |
| Gastos (idea 6) | Primera ola | Fase 4 | Paridad |
| Acta (5), asistente (7), vacante (8) | Si sobra tiempo | Fases 4 y 5 | Igual |
| Calculadoras (idea 9) | Con la landing | Fase 3, W4 | Igual |
| Pulido de pantallas sueltas | Lista de R4-E | Fase 0, R5 (opcional) | Se ven en la demo |

---

## 7. La web: cómo se construye

### 7.1 Opciones

| | A) Mismo proyecto Expo, exportado a web (recomendada) | B) Proyecto web aparte (React con Vite o Next.js) |
|---|---|---|
| Código | Uno solo: las mismas pantallas, consultas, tipos generados y pruebas | Dos interfaces que mantener |
| Estilo | El mismo `src/tema.ts` y las mismas piezas; se adaptan las pantallas anchas | Hay que rehacer el sistema visual |
| Reglas | Las mismas utilidades (dinero, fechas de Bogotá, estados) | Hay que copiarlas o compartirlas en un paquete |
| Esfuerzo | W0 a W4: adaptar el diseño, no rehacer | Rehacer de cero unas 60 pantallas |
| Riesgo | Algunas librerías nativas no funcionan en web (W0 las encuentra); paquete más pesado | Ninguno técnico, pero mucho más trabajo |

Expo Router exporta la web con `npx expo export -p web` y la documentación oficial lista Vercel, Netlify, Firebase Hosting y GitHub Pages como destinos.

### 7.2 Qué cambia en web (lo confirma W0)

- **Navegación:** barra lateral en pantallas anchas; barra inferior en celular, como hoy.
- **Diseño:** ancho máximo del contenido; lista y detalle lado a lado; tablas para Pagos, Contratos e Inmuebles; formularios a dos columnas. Los mismos colores, la tipografía Manrope y los radios.
- **Sesión:** el almacenamiento seguro del teléfono no existe en el navegador. Para la demostración se guarda en el navegador con sesión corta; lo correcto (token de renovación en una cookie segura) llega con B0.6-B4.
- **Cámara y archivos:** en web se eligen archivos del computador. Compartir y abrir PDF usan descarga o una pestaña nueva.
- **CORS:** el backend debe aceptar el dominio de la web. Probablemente sea solo una variable en Render, sin código (lo confirma W0).
- **Rutas públicas:** landing, calculadoras y verificación de documentos (en la Fase 2 la sirve el backend y en W4 pasa a la web).

### 7.3 El frontend web anterior

Queda congelado (`web-v1-congelada`) como historia. No se reutiliza: usa la API anterior a la Fase 0 de correcciones.

---

## 8. Decisiones que te tocan

| ID | Pregunta | Opciones | Recomendación |
|---|---|---|---|
| **D-15** | ¿Qué ideas entran y en qué orden? | A) Fase 2 = recibos con verificación (1), lector con IA (3) e historial (2); WhatsApp (4) en la Fase 1; gastos (6) y acta (5) en la Fase 4 · B) la primera ola original del documento de funciones (1, 2, 3, 6) · C) solo 1, 3 y 4 | **A**: la diferencia antes que la paridad |
| **D-16** | ¿Cuál es la IA del proyecto? | Lector de comprobantes (3) · asistente del contrato (7) · las dos | **3**: se prueba fácil y ahorra trabajo visible |
| **D-17** | ¿Dónde corre la IA? | Gemini gratuito con datos de prueba · lectura dentro del teléfono · Gemini de pago | **Gemini gratuito con comprobantes de prueba** y aviso de privacidad (en el plan gratuito Google puede usar los datos); se cambia antes de usuarios reales |
| **D-18** | ¿Planes de precio? | A) Gratis (1 unidad), Propietario y Portafolio, como propuesta · B) solo Gratis y Propietario · C) no mostrar precios | **A**, en la landing (W4), sin cobro real |
| **D-19** | ¿Cómo se construye la web? | A) mismo proyecto Expo · B) proyecto aparte | **A** (sección 7) |
| **D-20** | ¿La web va antes que push y Google? | A) Fase 3 web, luego Fase 4 · B) push y Google primero | **A**, salvo que el SENA pida push o Google |
| **D-21** | ¿Generamos ya el APK (Fase 0)? | Sí · esperar al final | **DECIDIDA (08/10/2026): sí.** A1 cerrada en código; falta la compilación |

**Falta un dato: la fecha de la sustentación** (y si el SENA exige web, IA o algo puntual). Con esa fecha se decide hasta dónde se llega antes: la Fase 0 sola sirve para un avance; las Fases 0 a 2 son la demostración completa; la Fase 3 suma la web.

---

## 9. Guion de demostración (meta de la Fase 2, unos 7 minutos)

1. **El problema** (30 s): la mitad de los arriendos en Colombia se maneja directo, con contratos genéricos y cobro por WhatsApp.
2. **Arrendador** (2 min): Panel ("quién me debe", "cómo va el año"). Crear un contrato de vivienda: el sistema no deja pedir depósito y avisa por qué (Ley 820). Código y QR para el inquilino.
3. **Inquilino** (2 min): activar con el código (o con el QR, si A1 lo convierte en enlace); Mi panel con el próximo pago y la llave Bre-B con su referencia; tomar la foto del comprobante: **la IA llena el formulario**.
4. **Arrendador** (1 min): Validar pagos con el **semáforo** (monto, fecha, referencia); aprobar. Alerta al inquilino.
5. **Inquilino** (1 min): **recibo** con QR; escanearlo y ver "auténtico". **Historial de buen pagador**: generar el certificado y abrir el enlace como lo haría un futuro arrendador.
6. **Cierre** (30 s): "la ley ya puesta, pagos verificables, un historial que viaja con el inquilino; gratis con la primera unidad".

Antes de presentar: abrir la app 2 minutos antes para despertar el servidor de Render (el plan gratuito se duerme) y llevar un video de respaldo grabado con los mismos pasos.

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Render gratis duerme y la primera petición tarda hasta un minuto | La app ya muestra "Conectando"; despertarlo antes de presentar; video de respaldo |
| Cola lenta de EAS en horas pico (más de 90 minutos) | Compilar con un día de margen antes de cada presentación |
| La IA gratuita puede usar los comprobantes para entrenar | Solo comprobantes de prueba en la demostración; aviso visible; D-17 se revisa antes de usuarios reales |
| La IA lee mal un comprobante | Solo sugiere; el inquilino corrige y el arrendador decide |
| El historial se presta a un uso indebido (Ley 1266) | Solo lo genera el titular, con consentimiento, sin buscador por cédula y con vencimiento; dice expresamente que no es un reporte de centrales de riesgo |
| Datos de la competencia desactualizados | Revisados el 7 de octubre de 2026; volver a revisar antes de la sustentación |
| El tiempo no alcanza | Cada fase deja un APK usable; se presenta hasta donde se haya llegado |

---

## Fuentes

Consultadas el 7 de octubre de 2026.

- [MisPropiedades — sitio oficial](https://www.mispropiedades.co/)
- [Alquilando — sitio oficial](https://alquilando.com/)
- [Arrendo — sitio oficial](https://www.arrendo.app/)
- [Houm: arrendar sin codeudor — Enter.co, 9 de octubre de 2024](https://www.enter.co/?p=562854)
- [Neivor — rentas residenciales](https://www.neivor.com/en/mercados-rentas-residenciales/)
- [RentaTop — Descubre.vc](https://www.descubre.vc/rentatop)
- [Requisitos que se exigen a los inquilinos — Metrocuadrado](https://www.metrocuadrado.com/noticias/guia-de-arriendo/cuales-son-los-requisitos-y-documentos-que-exigen-los-inquilinos-para-un-arriendo-122)
- [Precios de Expo y EAS](https://expo.dev/pricing.md) y [planes de EAS](https://docs.expo.dev/billing/plans/)
- [Compilaciones de Android solo en Linux y macOS — foro de Expo](https://forums.expo.dev/t/android-builds-are-supported-only-on-linux-and-macos/66406)
- [Publicar sitios web con Expo Router](https://docs.expo.dev/guides/publishing-websites/)
- [Vercel Hobby frente a Pro en 2026 — Fencode](https://www.fencode.dev/en/blog/vercel-free-vs-pro-2026-official-limits-pricing)
- `RentCheck — Funciones que hacen la diferencia.md` (6/10/2026), que trae las demás fuentes (Portafolio, Wompi, Gemini, Ley 2300)
- Documentos 1, 2 y 3 del proyecto (Contexto v2.17, Plan Técnico v3.33, instrucciones v2.61)
