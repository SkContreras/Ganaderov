# Recuperación revisada de datos anteriores

La cola universal no convierte automáticamente las fichas antiguas ni reemplaza
el inventario con un JSON importado. La sección **Recuperar datos anteriores**
de **Operaciones de sincronización** compara cada registro con su revisión
actual del servidor y permite seleccionar los valores que se recuperarán.
La importación de un archivo `ganadero-backup` versión 1 abre la misma revisión.

## Fuentes y pertenencia

- El almacenamiento antiguo `ganadero-local-ranch-<owner>` se abre sin aumentar
  su versión, generar una clave, migrar sus filas, borrar datos ni modificar
  metadatos. Se admiten tanto filas antiguas en texto como filas ya cifradas.
- Una copia JSON se captura como una instantánea de sólo lectura. La importación
  no vacía ningún almacén del inventario.
- Los conflictos `conflict:<kind>:<id>` del almacenamiento actual conservan sus
  instantáneas. Si se recupera parte de un conflicto, los valores restantes
  continúan disponibles. Los respaldos en `legacyRecovery` también se enumeran
  cuando otro conflicto posterior reutiliza el identificador de la ficha.
- Las fuentes antiguas sin atribución requieren que el usuario sea el
  propietario del rancho y confirme expresamente que la copia le corresponde.
  Un administrador verificado puede revisar un conflicto ya atribuido al rancho
  actual. Se comprueban cuenta, rancho y proyecto antes y después de operaciones
  asíncronas y dentro de la escritura final.

La recuperación requiere conexión para leer una revisión auténtica mediante
`sync_read_entity`. No se deriva una revisión de `updatedAt`, del nombre del
archivo, de una ruta Storage ni de una suposición de que el servidor está vacío.
Una eliminación remota con revisión positiva impide recrear automáticamente
el mismo registro.

## Qué se puede convertir

| Registro | Conversión |
| --- | --- |
| Animal nuevo con UUID y arete válidos | `animal.create`; el servidor asigna el identificador interno y la autoría. |
| Campos de una ficha existente | Selección por campo, `animal.update`, reactivación antes de editar y archivo después de editar cuando corresponda. |
| Meta de peso | `animal.target.update` con mínimo y máximo validados. |
| Actividad independiente | Alta o corrección de fecha, peso, producto y notas; una corrección requiere motivo y conserva el tipo y animal originales. |
| Fotografía nueva | Original JPEG, PNG o WebP de hasta 10 MiB; `photo.create` y, si procede, un `photo.crop` dependiente de su recibo. |
| Fotografía existente | Encuadre y principal, comprobando la ruta canónica `owner/animal/photo`, su revisión y la principal actual del álbum. Los bytes remotos no se reemplazan. |
| Jornada | Alta, incorporación de animales, asistencias pendientes, reanudación de una jornada incompleta y cierre permitido. Las operaciones sucesivas toman su revisión del recibo anterior. |
| Configuración | `config.update` después de comparar la configuración completa con el servidor. |
| Estimación nueva | `forecast.create` a partir de su peso y fecha de referencia, ganancia diaria y número de días. El respaldo conserva las evaluaciones antiguas para revisarlas. |

Los metadatos de autoría, identificadores internos y marcas de recepción no se
suplantan con los de la copia. Las actividades conservan su fecha de actividad;
el servidor registra quién efectuó la recuperación y cuándo la recibió.

El módulo no convierte ausencias de un archivo en borrados. Un borrado definitivo
antiguo, una retirada de asistencia, una modificación de la cabecera de una
jornada, la corrección de un evento ligado a ella, una estimación existente que
se intentaría reemplazar o un alta con identificador inválido muestran una
explicación y conservan el original para revisión desde el formulario adecuado.
Una operación pendiente o un conflicto de la misma entidad deben resolverse
antes de efectuar otra recuperación sobre ella.

## Confirmación y concurrencia

1. Se muestra el valor de la copia y el actual del servidor. Si existe una base
   sincronizada, se muestra también; un campo cambiado en ambos lados se señala
   expresamente. Ninguna casilla de recuperación aparece preseleccionada.
2. Al confirmar, se vuelve a leer la fuente y el servidor. Un cambio en la copia,
   en la revisión remota, en la relación con el animal o en la principal del
   álbum cancela la conversión y exige otra revisión.
3. Para un conflicto del almacenamiento actual, `prepareConflict(snapshot)`
   conserva los metadatos y los originales cifrados en `legacyRecovery` y enlaza
   el respaldo **antes** de hacer visible cualquier operación. Así, una pestaña
   o un Service Worker que envíe inmediatamente no puede provocar que una
   descarga borre el único original sin respaldo.
4. `enqueueUniversalBatch` guarda las operaciones y los marcadores
   `legacy-recovery:<recoveryKey>` en la misma transacción protegida. Una
   reconversión idéntica, un doble clic o una carrera entre pestañas no generan
   dos altas. El marcador persiste después del reinicio y de la confirmación.
5. `reconcileConflict(snapshot, ids)` instala el estado confirmado usando una
   comparación atómica del estado local. Es idempotente por el respaldo de la
   instantánea. Si falla, la cola y la copia permanecen guardadas, y la interfaz
   permite reintentar la actualización de la ficha sin volver a encolar.

Las revisiones base, UUID, dependencias y originales usan el mismo motor
universal que el resto de la aplicación. Una dependencia fallida se presenta
como bloqueada; no se cambia silenciosamente la revisión de una operación ya
sellada. La conversión no llama directamente a escrituras de tablas o Storage.

El JSON completo se limita a 64 MiB, cada colección a 10 000 registros y una
conversión a 100 operaciones. La interfaz presenta hasta 100 registros por
página. Las fotografías antiguas se descifran individualmente; la búsqueda de
respaldos recorre sólo sus claves y metadatos, no todos sus originales a la vez.

## Integración

`sync/legacy-recovery.mjs` exporta:

```js
mountLegacyRecovery(container, {
  scope: {database, userId, ownerId, deviceId},
  projectUrl,
  verify,                  // Revalida sesión, membresía y ámbito actual.
  managerAllowed,
  readEntity,              // (kind, id) => {revision, data, parentId}
  readPhotos,              // (animalId) => metadata del álbum remoto
  animalFields,
  isActiveAnimal,
  configPayload,
  prepareConflict,         // Respaldo atómico anterior a enqueue; obligatorio en conflictos.
  reconcileConflict,       // Instalación canónica posterior, sin borrar el respaldo.
  onQueued,
  source                   // Opcional: backupRecoverySource(payload, fileName).
});
```

El módulo también expone `scanRecoverySource`, `reviewRecoveryEntry` y
`convertRecoveryReview` para pruebas y `conflictRecoveryBackupId(snapshot)`
para que los callbacks compartan el identificador del respaldo. Este último
ignora los campos administrativos de reconciliación y utiliza SHA-256 de
`{kind, entityId, base, local, remote, version}` con claves ordenadas.

## Verificación

```sh
node --test tests/legacy-recovery.test.mjs
node tests/browser/legacy-recovery.cjs
```

El navegador acepta `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH` y
`LEGACY_BROWSER_ARTIFACTS`. Produce un informe JSON y una captura de los controles
de revisión en una carpeta temporal. Usa IndexedDB, AES-GCM, Web Locks y controles
DOM reales, con lecturas del servidor sintéticas y todas las solicitudes
externas bloqueadas. Comprueba la conservación de fuentes en texto y cifradas,
reapertura del almacenamiento, duplicados, carreras de revisión y cuenta,
originales, dependencias, preservación previa al envío y recuperación parcial
de conflictos. Estas pruebas no sustituyen la integración con Supabase real
ni prueban la planificación del sistema operativo.
