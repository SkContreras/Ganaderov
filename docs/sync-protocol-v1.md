# Ganaderov — contrato de sincronización v1 (propuesta versionada)

Estado: especificación, no API activa. Fuente canónica: repositorio Ganaderov Web, directorio contracts/sync/v1. Mobile conserva una copia idéntica. Cambios incompatibles requieren v2 y negociación explícita. No aplicar migraciones ni enviar operaciones hasta implementar y probar la RPC en staging. El respaldo y staging del paso 1 todavía están pendientes.

## Identidad y ámbito
Cada operación tiene UUID v4 generado una sola vez antes de persistir, distinto del identificador de entidad. Una instalación tiene deviceId aleatorio estable, no identificador de hardware. No es una credencial. El ámbito de idempotencia es (ownerId, operationId); actor autenticado y cuerpo canónico inmutable se vinculan al recibo. El servidor deriva actor de auth.uid() y membresía activa, nunca de campos enviados; comprueba ámbito antes de devolver recibos. Un UUID repetido con contenido o actor distintos produce OPERATION_ID_REUSED. No reutilizar UUID para resolver conflictos. No guardar tokens en outbox. IDs de entidades nuevas son UUID; IDs existentes pueden ser texto legado (incluidos eventos de jornada). Todos los IDs se validan y se limitan al rancho. No aceptar ownerId, actor, revision, id o audit metadata dentro de fields/config como campos editables; aplicar allowlist del catálogo real en servidor.

## Revisiones y tiempos
baseRevision se refiere a la entidad identificada por entityId, no a la ficha padre; null únicamente en creación. Revisiones son enteros monotónicos asignados por servidor; no derivar de reloj del dispositivo. capturedAt es el momento de captura declarado; date es fecha de actividad civil del rancho. serverReceivedAt lo genera PostgreSQL. Validar formatos, fechas imposibles, precisión y límites del reloj; no ordenar conflictos por timestamps del cliente. La RPC futura debe conservar revisiones/recibos y cambios de forma atómica. No usar secuencias ordinarias sin un diseño que impida saltarse commits concurrentes en el cursor de descarga.

## Operaciones
- animal.create
- animal.update
- animal.archive
- animal.restore
- event.create
- event.update
- event.delete
- photo.create
- photo.delete
- journey.create
- journey.attend
- journey.finish
- journey.resume
- config.update
event.update v1 solo corrige peso; event.delete requiere motivo y permiso de administrador, con tombstone/auditoría. archive cambia estado de negocio, no borra datos. photo.create registra metadatos de archivo ya subido mediante ruta determinada por rancho/animal/UUID; nunca sustituir bytes, verificar integridad y permisos antes de confirmar. photo.delete desvincula metadatos, limpieza diferida. journey.attend identifica jornada con entityId y animal dentro de changes; peso obligatorio si jornada de pesaje, prohibido para otras. journey.finish/resume requieren transición válida, evento determinista journey:<journeyId>:<animalId> compatible con historial anterior y transacción que abarque jornada y eventos. No permitir campos arbitrarios de actor ni saltarse los triggers actuales. Roles owner/admin para configuración, cambios de ficha, fotos y borrados; worker puede agregar eventos autorizados y corregir pesos según políticas existentes; cierre/reanudación solo manager hasta definir reglas verificadas.

## Resolución
Crear eventos distintos con IDs distintos: conservar ambos, aun si cambia la ficha padre. Mismo ID de evento con datos diferentes: conflicto. Mismo peso o campo modificado concurrentemente: conflicto; no gana el reloj más reciente. Combinar cambios de campos distintos solo si el servidor tiene base histórica verificable. Sin base, conservar conflicto. Borrado concurrente con modificación: conflicto, no resucitar tombstone. Animal archivado o revocación: rechazar nueva operación según reglas actuales; conservar local para revisión. No realizar escrituras directas que eludan el protocolo una vez completada la transición.

## Recibos y estado local
Resultado por operación: applied, duplicate (solo recibo exitoso previo del mismo actor y cuerpo), conflict, rejected, retryable. Un recibo aplicado y su modificación deben confirmarse en una misma transacción. En un timeout o pérdida de respuesta, reenviar exactamente el mismo cuerpo/UUID; no generar otro. Conflictos y rechazos no se reintentan indefinidamente; conservarlos en outbox y crear una operación nueva solo tras resolución explícita. Un recibo de rechazo/conflicto no implica que se haya aplicado un cambio. No borrar pendientes hasta recibir éxito verificable; conservar registro mínimo de confirmación local. Dependencias entre operaciones: crear entidad antes de sus eventos; no adelantar operaciones dependientes. Reintento con backoff y jitter, coordinar entre pestañas/isolate; tratar errores de transporte como resultado desconocido. El cliente conserva datos pendientes separados de confirmados, y al descargar aplica operaciones locales sobre la nueva base sin descartarlas. Nunca sustituir el outbox por una descarga.

## Migración y pruebas
Primero RPC event.create sobre tablas existentes; luego adaptar web y móvil, verificar doble envío y concurrencia, retirar escrituras antiguas solo cuando todos los clientes estén actualizados. Normalización de tablas y cursor incremental después. Las definiciones JSON Schema son contrato de transporte; no reemplazan las comprobaciones de permisos, reglas de dominio, integridad referencial ni validaciones SQL. Validar formatos de JSON Schema explícitamente. Los campos de animal/config se validarán contra catálogo versionado en el paso 3. Casos mínimos: respuesta perdida, UUID reutilizado con payload diferente, dos eventos concurrentes, cambio de cuenta, revocación offline, animal archivado, conflicto de edición, jornada incompleta, foto huérfana, fechas imposibles, versiones desconocidas. No desplegar ni probar con registros reales hasta completar respaldo y staging.
