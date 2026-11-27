# Descarga incremental

Para habilitarla en un entorno de pruebas, instala `backend/incremental_sync_v1.sql` y después `backend/incremental_retention_v1.sql`. Si el feed ya existe, aplica únicamente el segundo archivo. Activa `SYNC_INCREMENTAL_V1=true` en la compilación Web o configura `syncIncrementalV1: true` en el archivo local de configuración.

La RPC autenticada `sync_pull_changes` entrega hasta 100 cambios por página. El contador por rancho avanza en la misma transacción que el registro. Una actualización devuelve la fila completa. Una eliminación física devuelve su identificador. Las escrituras directas por clientes anteriores pasan por los mismos triggers. El feed requiere que las eliminaciones se realicen por fila.

Cada 10 000 cambios posteriores al último punto de control, el servidor conserva la última fila de cada entidad vigente, rota la época y vuelve a numerar las páginas. Al recibir `reset_required`, el cliente reinicia la descarga del rancho. Los historiales de versiones y los recibos de operaciones tienen un ciclo de vida independiente.

La Web guarda cada página validada y su cursor en una transacción IndexedDB, por proyecto, cuenta y rancho. Antes de confirmar compara el cursor con el que utilizó al solicitar la página. Las fichas, jornadas y configuración se reconcilian con la copia local al terminar la descarga. Las escrituras siguen las rutas habilitadas para cada operación. La copia remota se serializa en un solo registro por ámbito. El coste de esa copia con inventarios grandes queda pendiente de medición.
