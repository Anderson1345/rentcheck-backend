# RentCheck — 30 escenarios operativos: qué hace hoy el sistema y qué debería hacer

> **Versión 1.0 — 26 de septiembre de 2026.**
> Revisión hecha sobre el **código real** de `rentcheck-backend` (no sobre la documentación), después de la auditoría de la sección 3 del plan técnico y del merge de la migración de cédula única.
> **Para qué sirve este documento:** (1) cerrar huecos de lógica antes de construir la app móvil, y (2) servir como guion de pruebas manuales cuando cada bloque de la Fase 0 esté terminado.
> **Cómo leerlo:** cada escenario dice qué pasa hoy, qué debería pasar, y con qué identificador y bloque se corrige. Los identificadores **B-01 a B-31** ya están en el plan técnico; los **B-32 a B-46** son nuevos de esta revisión.

**Resumen:** de los 30 escenarios, **9 ya están cubiertos** por la Fase 0 tal como estaba planeada, **6 están parcialmente cubiertos** y **15 destaparon algo que no estaba en ningún documento**. Tres son problemas de privacidad o de pérdida de datos; el resto son huecos de comportamiento.

---

## A. Ciclo de vida del contrato

### 1. Llega la fecha de fin y ninguna de las partes hizo nada

**Hoy:** a las 23:55 UTC (6:55 pm en Colombia, o sea *antes* de que termine el día) el cron pasa el contrato a `VENCIDO`, libera la unidad y el inquilino pierde sus acciones operativas. El arrendador se enteró 30 días antes por una alerta, pero si no la vio, el arriendo simplemente se cortó en el sistema mientras el inquilino sigue viviendo ahí.

**Debería:** en vivienda urbana la Ley 820 dice lo contrario: sin aviso de ninguna parte, el contrato se prorroga solo. El sistema debe tener "aviso de no renovación" y, al terminar el día de fin en hora de Colombia, finalizar solo si hubo aviso; si no lo hubo, prorrogar por el mismo término y generar un otrosí.

`Crítico` · **B-12, B-19** · Bloque **0.3-A**

---

### 2. Se crea un contrato que empieza el mes que viene

**Hoy:** nada valida que `fecha_inicio` sea de hoy en adelante. El contrato nace `ACTIVO` de inmediato, así que bloquea la unidad desde ya (no se puede crear otro contrato para el inquilino que todavía la ocupa) y aparece en los listados como vigente aunque no haya empezado.

**Debería:** aceptar contratos con fecha futura, pero distinguirlos. Lo mínimo es que el estado de pago no cuente períodos antes del inicio (eso lo resuelve el estado de cuenta). Lo correcto es un estado propio, tipo `PROGRAMADO`, que pase a `ACTIVO` en su fecha de inicio y que **no** bloquee la unidad hasta entonces.

`Importante` · **B-41** (nuevo) · Bloque **0.3-A**

---

### 3. El arrendador escribió mal el canon o el día de pago y ya confirmó

**Hoy:** no hay forma de corregirlo. `ContratoController` solo tiene `GET`, `POST /contratos`, renovar, regenerar código y las de terminación. **No existe ningún `PATCH` de contrato.** Las únicas salidas son dejar el error, o terminar el contrato anticipadamente y crear otro, lo cual genera un historial falso.

**Debería:** permitir corregir los términos **mientras el contrato no esté vinculado** por el inquilino (es decir, antes de que la otra parte lo haya visto), regenerando el PDF. Una vez vinculado, un cambio de canon o de día de pago deja de ser una corrección y pasa a ser un otrosí que ambas partes deben conocer.

`Importante` · **B-35** (nuevo) · Bloque **0.3-A**

---

### 4. El arrendador hace clic dos veces en "renovar"

**Hoy:** se aplican **dos incrementos de IPC** seguidos y la fecha de fin se estira dos años. No hay ninguna validación de tiempo entre incrementos. Con el 9,28 % que está guardado en producción, dos clics suben el canon casi un 20 % en un segundo.

**Debería:** separar incremento y prórroga, y exigir 12 meses desde el último incremento (Ley 820, art. 20). Un segundo intento el mismo día responde 409 con la fecha en que sí se podrá aplicar.

`Crítico` · **B-09** · Bloque **0.3-A**

---

### 5. El inquilino se muda antes de tiempo

**Hoy:** el arrendador puede solicitar la terminación y **confirmarla él mismo** en dos llamadas seguidas, sin que el inquilino participe ni se enteren. Tampoco se valida que el contrato siga `ACTIVO` al confirmar, no hay fecha efectiva de entrega, y no se puede cancelar una solicitud.

**Debería:** confirma la contraparte (decisión D-2). Quien solicita indica motivo y fecha efectiva de entrega, y puede cancelar mientras no se confirme. Al confirmar, el contrato se cierra en la fecha efectiva, se genera un acta y queda pendiente la liquidación del depósito si aplica.

`Importante` · **B-13** · Bloque **0.3-A**

---

### 6. Falla la generación del PDF al crear el contrato

**Hoy:** está bien manejado a medias: el contrato se crea igual, el error se registra y `pdf_contrato_ruta` queda en `null`. El problema es lo que viene después: **no hay ningún endpoint para volver a generar ese PDF.** El contrato se queda sin documento descargable hasta que alguien lo renueve, que puede ser en un año. En el inquilino, "Mi Contrato" devuelve `pdf_contrato_url: null` sin explicar nada.

**Debería:** existir `POST /contratos/:id/regenerar-pdf` (solo el arrendador dueño), y que las pantallas muestren "documento no disponible, generar de nuevo" en vez de un espacio vacío.

`Importante` · **B-34** (nuevo) · Bloque **0.3-B**

---

### 7. El arrendador nunca registró su cédula

**Hoy:** el contrato se crea sin problema y el PDF sale con el texto literal `[cédula pendiente de registrar]` en la cláusula de identificación de las partes. O sea, un documento con valor legal sale incompleto y nadie avisa.

**Debería:** responder 409 al confirmar el contrato, con un mensaje que lleve al perfil. El asistente debe avisarlo en el paso 1, no al final.

`Crítico` · **B-16** · Bloque **0.3-A**

---

## B. Pagos y mora

### 8. El inquilino paga el 3 y su día de pago es el 5

**Hoy:** el 5 el ciclo actual pasa a ser "5 de este mes", el pago del día 3 queda *antes* de esa fecha, el cron no lo cuenta como cobertura y el contrato se marca `EN_MORA`. **El inquilino cumplido queda reportado como moroso.**

**Debería:** el pago se asocia a un **período** (el mes que cubre), no a una comparación de fechas. Un pago del día 3 para el período de este mes cubre ese período, sin importar que se haya reportado antes del día límite.

`Crítico` · **B-05** · Bloque **0.2**

---

### 9. Se crea un contrato el 20 y el día de pago es el 5

**Hoy:** esa misma noche el cron calcula que el ciclo actual venció el 5 de este mes, no encuentra pagos y marca el contrato `EN_MORA`. **Un contrato nuevo nace moroso**, antes de que el inquilino haya podido pagar nada.

**Debería:** el primer período vence en el primer día de pago igual o posterior a la fecha de inicio (decisión D-3). Un contrato que inicia el 20 con día de pago 5 no puede estar en mora hasta el 6 del mes siguiente.

`Crítico` · **B-05** · Bloque **0.2**

---

### 10. El inquilino paga menos del canon

**Hoy:** nada compara el monto con el canon. El arrendador aprueba el pago y el contrato pasa a `AL_DIA` **completo**, aunque solo se haya pagado la mitad. La deuda desaparece del sistema.

**Debería:** el período queda en estado `PARCIAL` y el contrato no pasa a al día hasta que la suma de pagos aprobados cubra el canon del período. La cola de validación debe mostrar "esperado vs. reportado" para que el arrendador vea la diferencia antes de aprobar.

`Crítico` · **B-05, B-07** · Bloque **0.2**

---

### 11. El inquilino debe septiembre y octubre, y reporta los dos el mismo día

**Hoy:** el segundo comprobante **reemplaza** al primero. La lógica de reemplazo busca "cualquier pago pendiente desde el ciclo actual" sin mirar a qué mes corresponde. El pago de septiembre queda marcado `REEMPLAZADO` y desaparece de la cola: el inquilino pagó dos meses y solo le queda uno registrado.

**Debería:** el reemplazo solo ocurre entre pagos pendientes **del mismo período**. Dos períodos distintos conviven sin tocarse.

`Crítico` · **B-07** · Bloque **0.2**

---

### 12. El arrendador aprueba un pago por error

**Hoy:** no hay reversa. `aprobar` exige que el pago esté `PENDIENTE`, así que un pago ya `APROBADO` no se puede rechazar después. El contrato queda `AL_DIA` con un pago que no existió, y la única salida es tocar la base de datos a mano.

**Debería:** permitir **anular** una aprobación dentro de una ventana razonable, como un cambio de estado que deja rastro (quién anuló y cuándo), nunca borrando el registro. El estado de pago del contrato se recalcula. Esto también es una de las acciones que debe quedar en la auditoría.

`Importante` · **B-45** (nuevo) · Bloque **0.6** (junto con la auditoría)

---

### 13. El contrato termina y el inquilino queda debiendo el último mes

**Hoy:** `POST /pagos` responde 409 "tu contrato ya no está activo". **El inquilino no puede reportar lo que debe** y el arrendador no tiene cómo registrar que le pagaron después. La deuda queda congelada como período vencido para siempre.

**Debería:** distinguir "no puede generar obligaciones nuevas" de "no puede pagar lo que ya debe". Con contrato terminado, el inquilino debe poder reportar pagos de **períodos anteriores al cierre** que sigan vencidos, y solo esos.

`Importante` · **B-38** (nuevo) · Bloque **0.2-B**

---

### 14. El inquilino reporta un pago con fecha de hace tres años

**Hoy:** solo se valida que la fecha no sea futura. Una fecha de 2023 se acepta sin problema, y como es anterior a cualquier ciclo, no cubre nada: el pago entra a la cola sin servir para nada y el contrato sigue en mora.

**Debería:** la fecha reportada no puede ser anterior a la fecha de inicio del contrato, y el período que cubre lo propone el servidor (el vencido más antiguo), no se deduce de la fecha.

`Menor` · **B-39** (nuevo) · Bloque **0.2-B**

---

### 15. Se aplica el incremento de IPC a mitad del contrato

**Hoy:** el canon del contrato se sobrescribe con el nuevo valor. Como no existe el concepto de período, **los meses anteriores quedan medidos contra el canon nuevo**: si alguien revisa un mes viejo, parece que pagó de menos.

**Debería:** cada período guarda o calcula el canon vigente **en su fecha límite**, según el historial de incrementos. Un incremento aplicado en junio no cambia lo que se debía en mayo.

`Crítico` · **B-05** (función de estado de cuenta) · Bloque **0.2-A**

---

## C. Identidad y acceso

### 16. El código de acceso se filtra: captura de pantalla, WhatsApp reenviado, alguien lo ve

**Hoy:** el código es `RC-<año>-` más 4 caracteres, o sea unas 1,7 millones de combinaciones, y solo tiene el límite general de 100 peticiones por minuto. Quien adivine un código de un contrato sin activar **se queda con la cuenta del inquilino**, porque es quien define el correo y la contraseña. El código no expira nunca y no se bloquea por intentos fallidos.

Además, "regenerar código" no revisa si la cuenta ya está activada: sobre un inquilino ya activo genera un código nuevo que no sirve para nada, sin avisar que la acción no tiene efecto.

**Debería:** 8 caracteres sin letras confundibles, expiración a los 7 días, bloqueo tras 5 intentos fallidos y límite de 5 intentos por minuto en los dos endpoints de activación. Regenerar sobre una cuenta ya vinculada debe responder que no aplica.

`Crítico` · **B-02** · Bloques **0.1** (límite) y **0.4-A** (formato y expiración)

---

### 17. El arrendador se equivoca en un dígito de la cédula

**Hoy:** se crea una ficha de inquilino con la cédula equivocada, y ahí queda. Si la cédula correcta ya existía en la plataforma, `POST /inquilinos` responde **500** (violación del índice único sin manejar). Y si el error se descubre después, no hay forma de corregirlo.

Hay un problema adicional de diagnóstico: en `POST /contratos`, cualquier violación de índice único se traduce a **"Esta unidad ya tiene un contrato activo"**, sin importar cuál índice falló. Un choque de cédula o de correo te muestra un mensaje sobre la unidad, y persigues el problema equivocado.

**Debería:** el arrendador puede corregir los datos del inquilino mientras el contrato no esté vinculado, y si corrige la cédula, el contrato se reasigna a la identidad correcta y el código se regenera. El manejo de errores únicos debe distinguir qué índice falló y responder 409 con un mensaje que corresponda.

`Crítico` · **B-14, B-17** · Bloque **0.4-A**

---

### 18. La misma persona arrienda con dos arrendadores distintos

**Hoy:** la cédula ya es única globalmente (se aplicó hoy), pero los servicios siguen filtrando por `arrendador_id`. El segundo arrendador **no puede crear la ficha**: el `create` choca con la cédula existente y responde 500. En la práctica, hoy una persona no puede arrendar con dos arrendadores en la plataforma.

**Debería:** el inquilino es una identidad global. El segundo arrendador escribe nombre, cédula y teléfono; el sistema reutiliza la identidad sin devolverle ningún dato que él no haya escrito, y cada arrendador solo ve sus propios contratos con esa persona.

`Crítico` · **B-14** · Bloque **0.4-A**

---

### 19. El inquilino ya tiene cuenta y recibe el código de un segundo contrato

**Hoy:** `validar-codigo` responde **409 "Esta cuenta ya fue activada"** y ahí termina. **El segundo contrato no se puede vincular nunca.** El inquilino inicia sesión y sigue viendo solo su contrato viejo, sin ninguna pista de que existe otro.

**Debería:** si la persona ya tiene cuenta, el mensaje la manda a iniciar sesión y usar "Agregar contrato con código", y `POST /inquilino/contratos/vincular` hace el enlace. El selector de contratos aparece cuando tiene más de uno.

`Crítico` · **B-14, B-17** · Bloque **0.4**

---

### 20. El inquilino pierde el teléfono con la sesión abierta

**Hoy:** el token dura 7 días y **no se puede revocar**. Quien tenga el teléfono entra a la cuenta hasta que el token expire solo. Cambiar la contraseña no invalida los tokens ya emitidos, porque la validación es únicamente por firma.

**Debería:** token de acceso corto más token de renovación guardado en la base de datos, con "cerrar sesión en todos los dispositivos", y desbloqueo con biometría en la app para las acciones sensibles.

`Importante` · **B-25** · Bloque **0.6**

---

### 21. El contrato terminó: ¿qué sigue viendo el inquilino?

**Hoy:** aquí hay un problema de privacidad que no estaba en ningún documento. `GET /inquilino/mi-contrato` **no se bloquea por estado** (eso es correcto y deliberado), pero devuelve **`datos_recaudo` siempre**, sin importar si el contrato está activo. O sea: los datos bancarios del arrendador (cuenta, Nequi, Daviplata) siguen expuestos a un inquilino que se fue hace meses. La regla 11 del contexto dice explícitamente que esos datos solo se muestran con contrato activo.

Y hay un segundo hueco en el mismo endpoint: solo devuelve las fotos de **entrega**, nunca las de **devolución**. El inquilino no puede ver la evidencia del estado en que entregó el inmueble, que es justo lo que necesitaría si discute un descuento del depósito.

**Debería:** `datos_recaudo` solo con contrato activo. Las fotos de devolución se devuelven cuando existan, en un grupo aparte. Lo demás (condiciones, historial de IPC, PDF) sigue siempre visible.

`Crítico` (privacidad) · **B-32, B-40** (nuevos) · Bloque **0.1-B** para `datos_recaudo` (es una fuga viva y la corrección son tres líneas) y **0.4-B** para las fotos de devolución

---

## D. Archivos y almacenamiento

### 22. Supabase está pausado o caído y el arrendador abre "Validar Pagos"

**Hoy:** cada elemento con archivo genera una llamada a Supabase para firmar su URL, y el listado las agrupa con `Promise.all`. Si **una sola** falla, se rechaza toda la promesa y `GET /pagos` responde **500**: el arrendador no ve ni los pagos que sí estaban bien. Con 50 pagos son 50 llamadas de red en una sola petición, así que además es lento y frágil por diseño.

El proyecto gratuito de Supabase se pausa tras 7 días sin actividad, y el ping actual solo cubre de 7 am a 11 pm.

**Debería:** si la firma de un archivo falla, ese elemento se devuelve con la URL en `null` y el resto de la lista se entrega igual, registrando el error. Firmar en lote o bajo demanda, no una llamada por elemento. Y paginar.

`Importante` · **B-37** (nuevo), **B-27** · Bloque **0.5**

---

### 23. El bucket llega al límite de 1 GB

**Hoy:** nada lo vigila. Y hay una fuga silenciosa: los comprobantes de pagos **reemplazados y rechazados** se quedan en el bucket para siempre, igual que los de contratos terminados. Cuando el bucket se llene, **toda subida empieza a fallar** en producción sin ninguna advertencia previa.

**Debería:** comprimir las imágenes en la app antes de subirlas (eso baja el consumo mucho más que cualquier limpieza), y tener una política escrita de retención: qué se conserva por valor legal o fiscal y qué se puede purgar y cuándo. Un aviso al arrendador cuando su portafolio se acerque al límite.

`Importante` · **B-42** (nuevo) · Bloque **0.5** para la política; la compresión va en la app (E1 y E7)

---

### 24. Alguien manda una ruta de archivo ajena en un `PATCH`

**Hoy:** `foto_portada_ruta`, `foto_principal_url` y `foto_cedula_url` son campos de entrada que el cliente puede escribir. Con `PATCH /inmuebles/:id { "foto_portada_ruta": "contratos/<otro-id>/contrato.pdf" }`, el siguiente `GET` devuelve una **URL firmada del PDF de un contrato ajeno**. Y si después se sube una portada nueva, el código borra la ruta anterior: **se destruye el contrato de otra persona.**

**Debería:** ninguna ruta de archivo entra por el cliente. Se quitan esos campos de los DTO y toda ruta la genera el servidor en su endpoint de subida.

`Crítico` · **B-03** · Bloques **0.1** (quitar los campos) y **0.4-B** (endpoints de subida)

---

### 25. El arrendador descarga el ZIP en diciembre, con tres años de historial

**Hoy:** el ZIP baja **cada archivo a memoria** uno por uno desde Supabase y lo va agregando. Con tres años de comprobantes son cientos de descargas seguidas en una sola petición HTTP: se acumula en la memoria de una instancia gratuita de Render y es muy probable que se agote el tiempo de la petición o la memoria antes de terminar. Además incluye comprobantes **rechazados y reemplazados**, que no sirven para una declaración de renta y pueden confundir.

**Debería:** solo comprobantes aprobados; permitir filtrar por año; y para portafolios grandes, generar el ZIP aparte y entregarlo por enlace en vez de en la misma petición. En la app, descargar solo con Wi-Fi.

`Importante` · **B-23, B-44** (nuevo) · Bloque **0.5**

---

## E. Integridad y eliminaciones

### 26. Eliminar un inmueble que tiene documentos cargados

**Hoy:** `eliminar` solo cuenta unidades. Si el inmueble no tiene unidades pero sí tiene documentos (certificado de tradición, predial), el `delete` choca con la llave foránea de `DocumentoInmueble` y responde **500**, sin explicar nada.

Hay un detalle de recorrido que lo empeora: al crear un inmueble se crea automáticamente una unidad principal, así que **para borrar un inmueble hay que borrar primero esa unidad** que el sistema creó solo. El mensaje "elimínalas primero" no dice eso.

**Debería:** revisar también documentos, fotos y cualquier hijo antes de intentar el borrado, y responder 409 con un mensaje que diga exactamente qué falta quitar. Los archivos del bucket se eliminan junto con los registros.

`Importante` · **B-33** (nuevo) · Bloque **0.1-B** (el 500 es lo urgente) y **0.5** (la limpieza de archivos)

---

### 27. Se quiere cambiar el uso de una unidad que tiene un contrato activo

**Hoy:** se permite. Una unidad arrendada como local comercial puede pasar a residencial con un `PATCH`, mientras el contrato vigente sigue apuntando a la plantilla legal de local. El contrato y la unidad quedan contándose historias distintas.

También se permite editar la unidad principal, que el sistema creó con 0 m² y 0 habitaciones, valores que su propio validador rechazaría si se los enviaran (`metros_cuadrados` exige mínimo 1). El sistema genera datos que no aceptaría de un usuario.

**Debería:** bloquear el cambio de `uso_permitido` y de `tipo` mientras exista un contrato `ACTIVO` sobre la unidad. Y que la unidad principal se cree con valores que pasen las mismas validaciones, o que quede marcada como "pendiente de completar".

`Menor` · **B-26, B-43** (nuevo) · Bloque **0.3-A**

---

### 28. El inquilino pide que borren su cuenta

**Hoy:** no existe ningún endpoint. La cuenta queda para siempre, con su cédula, su correo y su foto de cédula. La Ley 1581 de 2012 da al titular el derecho a solicitar la supresión de sus datos, y Google Play exige una forma de borrar la cuenta para publicar la app.

**Debería:** una baja que respete las dos obligaciones que chocan: los contratos y los comprobantes son evidencia fiscal y no se borran, pero los datos personales que no son parte de esa evidencia (correo, contraseña, foto de cédula, teléfono) sí se pueden eliminar o anonimizar. Hay que escribir la política antes de programarla.

`Importante` (bloquea publicar en tienda) · **B-46** (nuevo) · Antes de manejar usuarios reales

---

## F. Concurrencia e infraestructura

### 29. Dos acciones simultáneas sobre lo mismo

**Hoy:** depende del caso, y la diferencia es instructiva.

- **Dos contratos para la misma unidad al mismo tiempo:** bien resuelto. El índice único condicional de la base de datos rechaza el segundo y el servicio lo traduce a 409. Es la pieza más sólida del sistema, justamente porque la regla vive en la base de datos y no en el código.
- **Doble clic en "aprobar", o dos sesiones del arrendador aprobando el mismo pago:** mal resuelto. Se lee el pago, se verifica que esté `PENDIENTE`, y *después* se actualiza. Entre la lectura y la escritura no hay nada que impida que la segunda petición pase la misma verificación. El mismo patrón está en el cambio de estado de mantenimiento y en la confirmación de terminación.
- **Dos sesiones editando el mismo inmueble:** gana la última en escribir, sin aviso. El primero cree que guardó y su cambio desapareció.

**Debería:** las transiciones de estado se hacen con una escritura condicional (actualizar **solo si** el estado sigue siendo el esperado) y, si no afectó ninguna fila, responder 409. Para las ediciones normales, el patrón adecuado es un campo de versión: quien llega con una versión vieja recibe 409 en vez de sobrescribir.

`Importante` · **B-36** (nuevo) · Bloque **0.1-B** (transiciones de estado); la versión en ediciones, en **0.5**

---

### 30. A medianoche Render está dormido, o el deploy se cae a mitad

**Hoy:** las 6 tareas diarias son `@Cron` dentro del proceso. En el plan gratuito, Render duerme el servicio tras 15 minutos sin tráfico, y el ping externo solo corre de 7 am a 11 pm. **Las tareas están programadas a medianoche y a las 23:55, justo en la franja sin ping.** Si el servicio está dormido a esa hora, ese día no corren, nada lo detecta y nada las recupera: no hay transición de vencimiento, no hay recálculo de mora, no hay alertas. Un contrato puede quedarse `ACTIVO` semanas después de vencer.

Sobre el deploy: si una migración falla, Render mantiene arriba la versión anterior, así que el servicio no se cae. Pero una migración de datos a medio aplicar sí puede dejar registros inconsistentes, y hoy no hay forma de saberlo salvo mirando.

**Debería:** un solo endpoint interno protegido con un secreto, que ejecute las tareas en orden y pueda correrse dos veces sin duplicar nada, llamado por cron-job.org a las 00:05 hora de Colombia con reintento. Así el propio cron externo despierta el servicio, y queda registro de cada ejecución. Toda migración de datos muestra el conteo antes de aplicarse, y se prueba en local y en la base de pruebas antes de producción.

`Crítico` · **B-20, B-19** · Bloque **0.5**

---

## Hallazgos nuevos de esta revisión

| ID | Qué es | Severidad | Bloque |
|---|---|---|---|
| B-32 | `mi-contrato` expone `datos_recaudo` con el contrato ya terminado (viola la regla 11) | Crítico | 0.1-B |
| B-33 | Eliminar un inmueble con documentos responde 500 por llave foránea | Importante | 0.1-B |
| B-34 | No existe forma de regenerar el PDF si su generación falló | Importante | 0.3-B |
| B-35 | No existe `PATCH` de contrato: un dato mal escrito es imposible de corregir | Importante | 0.3-A |
| B-36 | Transiciones de estado sin escritura condicional (doble aprobación) y ediciones sin control de versión | Importante | 0.1-B / 0.5 |
| B-37 | Un fallo al firmar un solo archivo tumba el listado completo con 500 | Importante | 0.5 |
| B-38 | Con contrato terminado, el inquilino no puede reportar lo que quedó debiendo | Importante | 0.2-B |
| B-39 | `fecha_reportada` no se valida contra la fecha de inicio del contrato | Menor | 0.2-B |
| B-40 | `mi-contrato` nunca devuelve las fotos de devolución | Importante | 0.4-B |
| B-41 | Un contrato con fecha de inicio futura nace `ACTIVO` y bloquea la unidad | Importante | 0.3-A |
| B-42 | Comprobantes reemplazados y rechazados se acumulan en el bucket sin política de retención | Importante | 0.5 |
| B-43 | La unidad principal se crea con valores que el propio validador rechazaría | Menor | 0.3-A |
| B-44 | El ZIP descarga todo a memoria en una sola petición: riesgo de tiempo agotado | Importante | 0.5 |
| B-45 | No se puede anular una aprobación de pago equivocada | Importante | 0.6 |
| B-46 | No existe baja de cuenta (Ley 1581 y requisito de Google Play) | Importante | Antes de usuarios reales |

**Efecto en la Fase 0:** el bloque 0.1 se partió en dos. **0.1-A** queda como estaba (no filtrar datos, no aceptar rutas del cliente, infraestructura de errores) y **0.1-B** es una entrega nueva con B-32, B-33 y las escrituras condicionales de B-36: tres correcciones distintas que comparten un mismo tema, que ninguna operación deje datos inconsistentes ni responda 500. B-32 se adelantó desde 0.4-B porque es una fuga de datos viva en producción y la corrección son tres líneas. De los demás bloques, **0.3-A** suma B-35, B-41 y B-43; **0.4-B** suma B-40; **0.5** suma B-37, B-42, B-44 y el control de versión de B-36.

## Cómo usar este documento al probar

Cuando termine cada bloque, los escenarios que le corresponden se prueban **a mano**, no solo con las pruebas automáticas. Varios de estos casos (el pago anticipado, el contrato nuevo que nace moroso, los datos bancarios visibles tras el cierre) compilan perfecto y pasan las pruebas actuales: la única forma de verlos es recorrerlos como los recorrería una persona.

Un orden útil por bloque:

- **0.1-A** → escenario 24.
- **0.1-B** → escenarios 21 (la parte de `datos_recaudo`), 26 y 29.
- **0.2** → escenarios 8, 9, 10, 11, 13, 14, 15. Son los más importantes de todos: si el motor de pagos queda mal, el sistema cobra mal.
- **0.3** → escenarios 1, 2, 3, 4, 5, 6, 7, 27.
- **0.4** → escenarios 16, 17, 18, 19, 21 (la parte de las fotos de devolución).
- **0.5** → escenarios 22, 23, 25, 30.
- **0.6** → escenarios 12, 20.
- **Antes de usuarios reales** → escenario 28.
