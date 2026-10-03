# RentCheck — Plan de rediseño de UX y nuevas funciones

> **Versión 1.0 — 2 de octubre de 2026.** Decidido con Jesús tras probar E9 en Expo Go.
> Complementa a `RentCheck_instrucciones_desarrollo_movil.md` (estado y orden de entregas), `RentCheck_Contexto_App_Movil.md` (reglas de negocio) y `RentCheck_Plan_Tecnico_App_Movil.md` (B-xx). Si este documento contradice a esos tres, ganan ellos; las decisiones de aquí ya se copiaron a cada uno.
> **Para un chat nuevo del proyecto:** léelo antes de diseñar cualquier entrega de app desde R1 en adelante.

---

## 1. Por qué existe este plan

Jesús probó la app completa (hasta E9) y la encontró **funcional pero básica**: le gustan los colores, la tipografía y el estilo "Medianoche", pero no la **estructura**. El problema no está en una pantalla: viene de las piezas base (campo de formulario, botón, tarjeta, lista) y por eso se repite en toda la app. Además pidió funciones que una app de arriendos actual debería tener (Google, pagos verificables, zoom en fotos, duplicar unidades) y que las alertas no se acumulen.

Decisión: **antes de seguir con push**, se rediseña la estructura con maquetas aprobadas (D2) y se reconstruyen las piezas base y las pantallas en entregas de app (R1–R4), con una entrega de backend en paralelo (B0.7).

## 2. Diagnóstico (capturas del 02/10/2026)

### 2.1 Estructura visual
| # | Dónde | Problema | Dirección |
|---|---|---|---|
| U1 | Todos los formularios (login, registro, reportar pago, etc.) | El título va dentro del campo, pegado en la esquina, y se encima con lo que escribe el usuario | Etiqueta **fuera** del campo, arriba, con espacio; ayuda y error debajo; prefijo ($) alineado con el valor |
| U2 | Toda la app | Abuso de "tarjetones": todo es una tarjeta blanca grande o un botón gris de ancho completo apilado | Jerarquía: un bloque protagonista por pantalla, filas compactas, grillas de accesos con icono, separadores en vez de tarjetas para listas |
| U3 | Detalle de contrato | 5–7 botones grises idénticos seguidos ("Estado de cuenta", "Aplicar incremento"...) y los datos en un solo tarjetón | Cabecera con resumen (estado, canon, fechas, inquilino); grilla de 4 accesos frecuentes con icono; menú "Más acciones" para lo raro; secciones/pestañas: Resumen · Pagos · Documentos · Acceso |
| U4 | Inmuebles | Con pocos inmuebles, media pantalla vacía; no se parece al diseño original | Tarjetas con foto grande, unidades, ocupación y recaudo del inmueble; estado vacío útil |
| U5 | Unidades | Muestran un icono genérico aunque tengan foto | Miniatura con la foto de la unidad |
| U6 | Lista de contratos | Cada fila ocupa ~5 líneas (dos chips apilados); pestañas cortadas ("Program…") | Fila compacta: unidad + inquilino, fechas y monto en una línea, un solo indicador combinado; filtros que caben |
| U7 | Login / registro | Media pantalla verde sin función y el formulario aplastado abajo | Marca arriba en bloque compacto, formulario centrado con aire, Google como opción principal (ver 3.3) |
| U8 | Reportar pago | Título repetido (cabecera + título grande) | Un solo título |
| U9 | Pagos del inquilino | Los pagos "Reemplazado" ensucian el historial; datos de recaudo repetidos en Mi panel y Pagos | Reemplazados plegados; recaudo en una línea con copiar |
| U10 | Toda la app | Barra lateral de desplazamiento visible al hacer scroll | Ocultar indicadores de scroll en los componentes base de pantalla y lista |
| U11 | Bienvenida | Enlaces "Diagnóstico · Galería" visibles | Solo en desarrollo (`__DEV__`) |
| U12 | Alertas | Textos con tres formatos de fecha ("2026-10-01", "5/10/2026", "02/10/2026") | Un solo formato en los textos del servidor (B-81) |
| — | Aclaración | El engranaje gris flotante de las capturas es el botón de herramientas de **Expo Go**, no de RentCheck | No se toca |

### 2.2 Paneles
- **Arrendador:** las filas en 0 ("Sin pendientes") son ruido; error visible "Mantenimientos 2 · y 2 más" sin elementos; y, sobre todo, da totales sin responder **de quién** ni **cómo va el año**.
- **Inquilino:** no se parece al diseño A_Inquilino (bloque "Tu próximo pago" con botón, línea de tiempo de pagos, dónde pagar). La gráfica `LineaTiempoPeriodos` existe y nunca se usó.

### 2.3 Alertas
Se acumulan sin límite y la de mora se crea **cada día** mientras el período siga vencido (tres "Pago en mora" el mismo día en la captura).

## 3. Decisiones (02/10/2026)

### 3.1 Panel del arrendador: responde cuatro preguntas
1. **¿Qué tengo que hacer hoy?** Solo pendientes con conteo mayor que 0, accionables.
2. **¿Quién me debe?** Lista de contratos en mora: unidad, inquilino, días de mora (desde el período vencido más antiguo), monto.
3. **¿Cómo va el mes?** Anillo de recaudo (aprobado / en revisión / sin reportar) — ya existe.
4. **¿Cómo va el año?** Ingresos del año en curso frente al anterior (mes a mes), ingresos por inmueble y ocupación.
Las preguntas 2 y 4 necesitan datos nuevos del servidor (B-82, entrega B0.7).

### 3.2 Panel del inquilino
Bloque protagonista "Tu próximo pago" (monto, fecha límite, días que faltan, estado) con **Reportar pago**; línea de tiempo de sus períodos; accesos con icono (Mi contrato, Estado de cuenta, Documentos, Nueva solicitud); dónde pagar en una línea con copiar (llave Bre-B cuando exista, ver 3.4).

### 3.3 Entrar con Google (ambos roles) — B-83
- Arrendador: registrarse o entrar con Google; el teléfono y la cédula se completan después.
- Inquilino: valida primero su código de activación y luego crea la cuenta con Google (o con correo y contraseña); después entra con Google.
- Gratis (proyecto de Google Cloud, sin tarjeta), pero **no funciona en Expo Go**: requiere development build (verificado en la documentación de Expo el 02/10/2026). Por eso va después del rediseño y junto con push.

### 3.4 Pagos verificables, en dos fases
- **Fase A (gratis) — B-84:** el arrendador registra su **llave Bre-B** (y opcionalmente un QR); cada período tiene una **referencia única de RentCheck** que el inquilino escribe en la transferencia y que se muestra junto al comprobante para que el arrendador cruce sin dudas. Sigue habiendo comprobante (Bre-B no tiene API pública para comercios conocida al 02/10/2026).
- **Fase B (demo) — B-85:** pasarela **Wompi en modo pruebas** con confirmación automática por webhook. En producción cobra comisión por pago (según tarifas publicadas en septiembre de 2026: PSE 1,49% + $1.200; tarjeta 2,99% + IVA + $600) y **cada arrendador necesita su propia cuenta**: RentCheck nunca recibe ni reparte el dinero. Se reverifican costos y ambiente de pruebas en el diagnóstico de esa entrega.

### 3.5 Retención de alertas — B-80 y B-79
- Las alertas **leídas** desaparecen del feed a los **7 días** de leídas y se borran a los **60 días**. Las no leídas no se borran solas. Las alertas no tienen valor legal (los pagos y contratos sí, y no se tocan).
- La alerta de **mora** se repite como máximo **una vez cada 7 días** por contrato, período y destinatario mientras siga vencido (hoy se repite a diario).

### 3.6 Otras funciones
- **Zoom en todas las imágenes** (inventario, inmuebles, unidades, comprobantes, mantenimiento): un visor único reutilizable.
- **Duplicar unidad:** "Duplicar" abre el formulario de nueva unidad con los datos de otra (tipo, uso, habitaciones, baños, área...); solo cambia el nombre. Sin backend.

## 4. Orden de entregas

| # | Código | Repo | Qué | Notas |
|---|---|---|---|---|
| 1 | **D2** | — (lienzo de diseño) | Maquetas Medianoche reestructuradas: bienvenida/login, campo de formulario, panel arrendador, panel inquilino, inmuebles, detalle de contrato, lista de contratos, alertas | Jesús las aprueba antes de programar; se guardan como referencia de R1–R4 |
| 2 | **R1** | app | Piezas base: campo de formulario (U1), botones y grilla de acciones, fila compacta, visor de imágenes con zoom, scroll sin barra (U10), login/registro (U7), ocultar Diagnóstico/Galería (U11), título único (U8) | Toca casi todas las pantallas por herencia; dividir si pasa de ~22 archivos |
| 3 | **B0.7** | backend | Panel v2 (morosos con días y monto; ingresos del año vs. anterior y por inmueble; ocupación %) — B-82; retención de alertas — B-80; mora semanal — B-79; formato de fecha único en textos — B-81 | Puede ir en paralelo con R2. Diagnóstico corto primero. Sin migración prevista |
| 4 | **R2** | app | Pantallas del arrendador: inmuebles (U4), unidades con foto (U5) y duplicar unidad, detalle de contrato (U3), lista de contratos (U6) | |
| 5 | **R3** | app | Panel del arrendador v2 (3.1, usa B0.7), panel del inquilino (3.2), alertas con la retención | Regenerar tipos tras B0.7 |
| 6 | **R4** | app | Resto del inquilino: pagos (U9), reportar pago, solicitudes, mi contrato; revisión final de pantallas restantes con las piezas nuevas | |
| 7 | **P1-B / P1-A** | backend / app | Fase A de pagos: llave Bre-B y referencia única (B-84) | Una migración en P1-B |
| 8 | **B0.6-B3 + E10** | backend / app | Push (ya planeado) con **development build** | Requiere cuenta de Expo (gratis) y credenciales FCM |
| 9 | **G1-B / G1-A** | backend / app | Entrar con Google (B-83) sobre la development build | Proyecto de Google Cloud (gratis) |
| 10 | **B0.6-B4** | backend | Sesiones con renovación (B-25), antes de E12 | Ya planeado |
| 11 | **P2-B / P2-A** | backend / app | Fase B de pagos: Wompi en modo pruebas (B-85) | Verificar costos antes |

E11 (sin conexión), E12 (endurecimiento y APK), B0.6-B5 y E3-C siguen como estaban, después de esta lista.

## 5. Principios de diseño para R1–R4 (resumen para los prompts)
1. Un **protagonista** por pantalla (cifra, foto o acción principal); lo demás, secundario.
2. Listas como **filas** dentro de un contenedor, no una tarjeta por elemento.
3. Acciones frecuentes en **grilla con icono**; acciones raras en un menú; máximo un botón primario visible.
4. Etiquetas de campo **fuera** del campo; nunca superpuestas al valor.
5. Nada en 0 ocupa espacio protagonista; los estados vacíos explican qué hacer.
6. Fotos visibles y ampliables siempre que existan.
7. Densidad móvil: aprovechar el ancho (dos columnas para datos cortos), no apilar todo.
8. Mismos colores, tipografía (Manrope) y radios de `src/tema.ts`; no se cambia la identidad.
