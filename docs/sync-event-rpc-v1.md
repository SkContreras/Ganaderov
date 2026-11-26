# API transaccional — event.create (candidata de staging)

Archivo backend/sync_event_create_v1.sql. Aplicar después del esquema actual, solo en staging hasta completar respaldo, pruebas y revisión. No hay cambios de cliente en esta etapa. La función pública sync_apply_operation recibe p_operation JSONB con el contrato v1. La implementación privilegiada está en esquema no expuesto; comprueba auth.uid(), bloquea membresía y fila del animal, valida campos y roles, conserva triggers existentes, agrega un evento sin sustituir los demás. Recibo privado y evento en la misma transacción. Revisión 1 corresponde a la entidad evento nueva, no a la ficha padre; no es cursor incremental. No existe edición de eventos por RPC todavía. El rol authenticated tiene uso del esquema y ejecución de la función privada, no acceso a sus tablas; comprobar que esquema no se exponga por Data API. Los errores SQL/transportes desconocidos deben reintentarse con el mismo cuerpo/UUID. Rechazos/conflictos no se guardan como recibos definitivos. El reloj del servidor registra recepción y se acepta una tolerancia de un día para fechas del dispositivo; pendiente definir zona civil por rancho. Los IDs de eventos legados se comprueban en JSON; clientes antiguos con escrituras directas aún pueden vulnerar garantías globales y no deben considerarse protegidos por la API.

## Pruebas obligatorias
- Usuario anónimo no puede ejecutar RPC; otro rancho no accede ni recibe recibos.
- Worker activo crea evento válido, actor derivado de sesión; no puede inyectar actor.
- Reenvío idéntico devuelve duplicate con misma revisión y fecha; cuerpo distinto devuelve conflict.
- Dos operaciones distintas mismo animal simultáneamente conservan ambos eventos.
- Dos operaciones mismo entityId en animales diferentes: una sola se aplica.
- Revocación concurrente y animal eliminado/archivado: no aceptar nuevas operaciones no autorizadas.
- Error al insertar recibo revierte cambio del historial.
- Fecha inválida, peso negativo, campos extra, versión no soportada, UUID inválido.
- Compatibilidad con lectura de ambos clientes, trigger de modified_at y trabajador.
- Verificar permisos de esquema, tablas, funciones y advisors; no aplicar a producción antes de validar.

Esta es una propuesta SQL revisable, no una migración aplicada. No sustituye el paso de staging, ni completa auditoría general o retiro de escrituras directas.
