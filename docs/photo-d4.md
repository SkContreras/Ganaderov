# D4: fotografía principal y encuadre

D4 incorpora `photo.crop` y `photo.primary` al contrato de 20 acciones. El encuadre guarda posición horizontal/vertical de 0 a 100 y acercamiento de 1 a 3. El original no se recodifica, sustituye ni elimina al encuadrar. La ficha y la galería aplican estos valores; el visor abre el original completo.

## Editor de encuadre

**Ajustar encuadre** abre un editor con la misma proporción que la imagen de la ficha. La fotografía se mueve arrastrándola con ratón o dedo. La pinza de dos dedos y la rueda ajustan el acercamiento alrededor del punto elegido; los botones **− / +** ofrecen una alternativa sin gestos. Los límites mantienen la imagen cubriendo todo el marco.

Con el marco enfocado, las flechas desplazan la imagen, **Mayús + flecha** amplía el paso, **+ / −** ajusta el zoom e **Inicio** restablece el encuadre. **Restablecer** sólo cambia la vista previa. **Cancelar**, cerrar el editor o pulsar **Escape** descarta la vista previa; únicamente **Guardar encuadre** genera el cambio persistente.

El selector del alta usa un botón accesible, indica cuántas fotografías se han seleccionado y conserva las miniaturas con su acción de quitar. El botón de la galería también admite teclado. El editor y su módulo se guardan en la caché de la PWA para usarlos sin conexión.

## Captura y sincronización

Con `syncEventRpcV1: true`, encuadrar, cambiar la principal y eliminar una foto utilizan operaciones persistentes. La sincronización o la primera edición online guarda una revisión confirmada de esa fotografía, vinculada a su contenido, usuario y rancho. Después puede capturarse el cambio sin red. Una foto nueva que todavía no tiene revisión confirmada debe sincronizarse primero.

Los controles permiten previsualizar y restablecer el encuadre antes de pulsar **Guardar encuadre**. Se acepta una operación de fotografía sin resolver por animal; la interfaz muestra el estado pendiente y desactiva la siguiente modificación hasta confirmar o revisar un conflicto. La comprobación y el encolado son atómicos entre pestañas.

El cambio pendiente se proyecta sobre la galería, pero no modifica los registros confirmados que usa la sincronización de bundles. IndexedDB cifra la revisión, la operación y los originales en el ámbito del usuario/rancho. La proyección sobrevive al reinicio y a una recarga offline mediante el Service Worker. Un recibo aplicado o duplicado conserva esa proyección hasta que una lectura posterior del servidor coincide con la copia canónica y alcanza la revisión del recibo.

Un conflicto conserva la intención y muestra la versión confirmada. **Revisar sincronización → Archivar / conservar servidor** permite descartarla explícitamente; después puede hacerse un nuevo ajuste. No se cambia automáticamente la revisión base de una operación rechazada ni se reutiliza su identificador para otra intención.

El alta de fotografías mantiene la ruta existente. Se aceptan JPEG, PNG y WebP de hasta 10 MiB por archivo. Las actualizaciones de metadatos reutilizan el Blob original local; las descargas necesarias son secuenciales. La recolección de objetos Storage continúa deshabilitada.

## Servidor

La migración `backend/photo_operations_d4.sql` se aplica después de las migraciones previas, incluida D3, siguiendo el orden de `.github/workflows/web-checks.yml`. El servidor verifica permisos, animal activo, padre y revisión de la foto. La selección de principal compara también `previousPrimaryId`: dos clientes que eligen fotos diferentes no se sobrescriben silenciosamente. Se admiten fotos heredadas sin `animalId` interno cuando el bundle y el historial ya establecen su padre; un padre explícito incorrecto se rechaza.

La incorporación de estos archivos no instala SQL ni activa las banderas en una base de producción. Mantener la configuración del entorno correspondiente y comprobar la migración en staging antes de habilitar la ruta RPC.

## Pruebas de regresión

- `tests/photo-outbox.test.mjs`: revisiones por ámbito y contenido, proyección sin mutar los originales, recibos, conflictos, principal y borrado.
- `tests/photo-framing.test.mjs`: geometría compatible con el encuadre existente, límites, arrastre y conservación del punto focal al acercar.
- `tests/sql/photo_operations_d4.sql`: contrato, permisos, aislamiento, objetos originales, compatibilidad heredada, límites del encuadre y revisiones.
- `tests/photo_concurrency_staging.py`: carreras de principal, recorte, envío duplicado y recorte frente a borrado. Sólo contra una base desechable de pruebas, con las variables y guardas que usa CI.
- `tests/browser/photo-d4.cjs`: gestos reales, teclado, selección de archivos, cancelación, navegador real, IndexedDB cifrado, recarga offline, dos pestañas, confirmación y conflictos, con servidor y cuentas sintéticas locales.

La suite Node se ejecuta con `node --test tests/*.test.cjs tests/*.test.mjs`. Las suites SQL y de concurrencia se ejecutan en CI contra Supabase local. El navegador usa Playwright; no requiere credenciales de un rancho real.
