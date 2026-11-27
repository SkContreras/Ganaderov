# Sesión y estados de sincronización Web

## Coordinación del ciclo

La comprobación de permisos forma parte del mismo ciclo que la descarga y el
envío. El ciclo se reserva antes de iniciar `get_my_ranch_context`. Las llamadas
simultáneas a `syncData` esperan su finalización y solicitan un pase posterior;
no vuelven a poner `ranchReady=false` mientras otra transferencia está activa.

Los eventos de Auth de la misma cuenta usan esa coordinación. Hay un solo
listener de visibilidad para reanudar la sincronización. Una actualización
manual de permisos espera el ciclo activo, y las comprobaciones simultáneas
comparten una petición por usuario y generación de sesión.

Un cambio real de cuenta conserva la invalidación inmediata de la vista y los
controles de usuario, rancho, base local y permisos. Las respuestas y los
temporizadores de una sesión anterior no deben modificar la vista de la
siguiente. Los errores HTTP de autorización no restauran permisos desde caché.

## Confirmación y conciliación

Un recibo confirmado significa que el servidor aceptó la operación. La
conciliación termina después de comprobar una instantánea del servidor que
coincide con la copia canónica local. Son pasos diferentes.

Las operaciones `photo.*` usan `photoSettled`; las demás usan `settled`. Una foto
puede tener `photoSettled=true` y `settled=false`: el segundo indicador no debe
mantener su etiqueta en «actualizando ficha». La ventana de operaciones usa el
indicador correspondiente y se actualiza después de refrescar los datos locales.
Las selecciones de recuperación permanecen en su propio formulario.

La ventana presenta nombres de actividades y del animal. Los identificadores,
recibos y cuerpos técnicos se consultan en los detalles, sin sustituir los
controles existentes de conflicto, recuperación y descarga del original.

## Regresiones reproducibles

`tests/browser/sync-lifecycle.cjs` ejecuta la inicialización real de la aplicación
con Auth y transporte simulados, manteniendo IndexedDB y el navegador reales.
`tests/browser/sync-dialog.cjs` verifica los estados y la actualización de la
ventana, incluida la combinación de indicadores de fotografías ya conciliadas.
Ambas pruebas forman parte de `Web checks`; sus artefactos se escriben fuera del
repositorio mediante `SYNC_LIFECYCLE_ARTIFACTS` y `SYNC_DIALOG_ARTIFACTS`.

Estas regresiones no requieren cambiar datos ni permisos del rancho en
producción. El cambio no modifica SQL, el protocolo de operaciones ni los
originales de las fotografías.
