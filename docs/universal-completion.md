# Ampliación de la sincronización universal

Este cambio completa las rutas de desarrollo pendientes de Web y Mobile sobre
el protocolo universal v1. La instalación del backend, el despliegue del gateway
y la activación de flags en producción son una fase independiente. Los workflows
de este cambio sólo utilizan servicios desechables y datos de prueba.

## Alcance

| Área | Comportamiento implementado |
| --- | --- |
| Escrituras Web | `animal.create`, `animal.update`, `animal.archive`, `animal.restore`, `event.create`, `event.update`, `event.delete`, `config.update` y `photo.create` pasan por la cola universal. Las operaciones previas de metas, fotografías, jornadas y estimaciones usan el mismo motor de entrega. |
| Historial Mobile | Editor de actividades independientes con fecha, producto, notas, peso cuando corresponde y motivo obligatorio para corregir o eliminar. Conserva tipo, animal y procedencia. Los eventos derivados de jornadas se gestionan desde su jornada. |
| Configuración Mobile | Editor de cuatro módulos, 31 campos y cinco listas. Comparte formato con Web y aplica etiquetas, obligatoriedad, nivel del formulario y visibilidad del detalle. |
| Trabajo offline | Altas, edición, archivo y restauración; jornadas, incorporación, asistencia, cierre y reanudación. Las operaciones sobre entidades recién creadas esperan el recibo de su predecesora. |
| Segundo plano | Motor universal compartido en Android y Service Worker Web. La PWA cerrada utiliza una capability acotada; los originales se entregan mediante un gateway que valida autorización y bytes. |
| Capturas anteriores | Revisión de cambios legados y copias JSON. Selección explícita de valores, revisión remota auténtica, preservación cifrada de los originales y marcadores atómicos contra duplicados. |
| Estimaciones Web | Eliminación explícita desde el historial mediante `forecast.delete`, sin borrar pesajes ni otras actividades. |

## Capturas, confirmación y dependencias

La aplicación distingue la instantánea confirmada y los cambios pendientes.
Un alta offline aparece marcada como pendiente; las métricas y los eventos
confirmados no se fabrican a partir de un borrador. Las fotografías conservan
el Blob original en un almacén cifrado separado. El servidor asigna el ID
interno del animal al confirmar el alta.

Cada operación mantiene su UUID y su cuerpo. Una operación que necesita la
revisión de otra conserva una dependencia duradera; obtiene esa revisión del
recibo exacto y se sella antes del primer envío. Un reintento reutiliza el mismo
cuerpo. No se sustituye la revisión de una operación que ya entró en conflicto.
Las dependencias rechazadas quedan bloqueadas y visibles para revisión.

La revisión base del servidor se compara con la copia canónica local. Dos
pestañas no pueden sobrescribir silenciosamente una configuración o una ficha
que cambió mientras el formulario permanecía abierto. La recarga offline vuelve
a proyectar los pendientes después de restaurar los permisos de la misma cuenta.
Los permisos locales verificados caducan a las 24 horas; el siguiente envío
comprueba de nuevo la membresía real.

La revisión de una actividad independiente conserva su tipo y animal. Corregir
o eliminar exige motivo. La compatibilidad del sobre anterior de pesaje
`{animalId, weight}` se mantiene para clientes ya publicados. Las notas y otras
actividades administrativas respetan los permisos del servidor.

## Recuperación y originales

La importación de una copia en la ruta universal abre una comparación. No vacía
el inventario ni atribuye automáticamente una base antigua a la sesión actual.
Las fuentes sin propietario comprobado requieren que el propietario confirme
su pertenencia. Un conflicto actual conserva sus instantáneas y los originales
antes de hacer visible cualquier operación de recuperación.

Los campos que no se seleccionan siguen disponibles, incluso si otra pestaña
entrega la operación y descarga el estado confirmado antes de completar la
reconciliación. Una recuperación repetida usa un marcador persistente y no
genera dos altas. La copia preservada permite continuar después de un error.
Consulta [recuperación de datos anteriores](./legacy-recovery-v1.md) para los
tipos admitidos y las conversiones que requieren revisión manual.

Un original distinto en una ruta de fotografía ya ocupada queda como conflicto
revisable y descargable. No se sobrescriben bytes remotos ni se mantiene un
reintento indefinido de ese conflicto.

## Segundo plano

Web registra un Service Worker de tipo módulo. La autorización limitada está
ligada a cuenta, rancho, dispositivo y sesión, dura una hora por defecto y puede
revocarse. El registro del worker no almacena tokens generales de Auth. Cada
ejecución limita el número de intentos, incluidos fallos y conflictos. El cierre
de sesión invalida primero la entrega local y conserva la revocación remota si
no existe conexión.

Android reutiliza el motor universal y SQLite cifrado con el access token
vigente del almacenamiento seguro. El worker no rota refresh tokens. Ambos
clientes conservan UUID, dependencias, recibos y originales.

La ejecución depende del navegador o del sistema operativo; no existe garantía
de horario ni de trabajo tras un cierre forzoso. Una autorización caducada
requiere volver a abrir la aplicación. Consulta [entrega Web en segundo
plano](./background-sync-v1.md) y la documentación equivalente de Mobile.

## Backend y activación

El manifiesto [backend/release-manifest.json](../backend/release-manifest.json)
define la base y las 12 migraciones ordenadas. Las dos incorporaciones de esta
ampliación son:

- `20261127035958_universal_completion_v1.sql`: validaciones y lecturas de
  revisiones compatibles con todas las capturas.
- `20261127040000_background_capabilities_v1.sql`: emisión, validación,
  revocación y entrega con permisos acotados.

El gateway `supabase/functions/sync-background-photo` valida la capability y
la vinculación entre animal, ruta, tipo, tamaño y bytes. Su credencial
administrativa permanece en el servidor. `verify_jwt=false` permite recibir la
capability y no omite su validación.

La ruta universal requiere `syncEventRpcV1`; el envío Web cerrado requiere además
`syncBackgroundV1`. Los flags de pull incremental, escrituras estrictas y
resolución manual se conservan. Debe verificarse la compatibilidad del backend
antes de habilitarlos. Este PR no cambia las variables de producción.

## Verificación reproducible

El workflow `Web checks` ejecuta:

1. Sintaxis, pruebas Node y hashes del manifiesto SQL.
2. Navegadores con IndexedDB, WebCrypto y Web Locks reales: regresiones D4,
   dependencias universales, sesión y concurrencia, recuperación y un evento
   Sync real con cero ventanas PWA abiertas. Estos harnesses declaran su
   transporte sintético.
3. Una instalación desechable de Supabase con Auth, PostgREST, Storage,
   PostgreSQL y Edge Runtime reales. Ejecuta SQL, escritores concurrentes,
   integración HTTP, formularios Web con corte de red y reconexión y el
   repositorio Flutter fijado a un commit exacto.

La integración de ambos clientes comparte fixtures para comprobar que los
cambios confirmados por Web se leen desde Mobile. La interfaz Web se opera con
controles reales; la instrumentación añadida al proceso de prueba sólo lee
estado y hashes. Los informes indican explícitamente los casos omitidos o
fallidos y no se consideran evidencia de un dispositivo Android físico.

Para las pruebas de navegador locales se admiten `PLAYWRIGHT_MODULE` y
`CHROMIUM_EXECUTABLE_PATH`. Los informes y capturas se escriben fuera del
repositorio mediante las variables `D4_BROWSER_ARTIFACTS`,
`UNIVERSAL_BROWSER_ARTIFACTS`, `BACKGROUND_BROWSER_ARTIFACTS` y
`LEGACY_BROWSER_ARTIFACTS`. Los workflows excluyen credenciales de los artefactos.
