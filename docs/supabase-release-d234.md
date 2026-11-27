# Validación y preparación de la activación D2–D4

Este documento fija el backend y la configuración que se deben probar antes de
activar pronósticos, jornadas y edición de fotografías. El workflow de este
repositorio crea un Supabase desechable. No aplica SQL al proyecto alojado ni
modifica variables de Vercel.

## Estado comprobado el 26 de noviembre de 2026

Auditoría de solo lectura capturada el 27 de noviembre a las 03:07:56 UTC
(26 de noviembre, 21:07:56, America/Matamoros):

- Web D4 integrado en `d19da276339ddb46f40f4d102c3e3abb8f7ffad2`.
- Mobile D4 integrado en `a5ea401d21516e7c71449b810712a4ff4f2cb11f`.
- Supabase tiene la migración `20261125073916_ganaderov_current_schema`.
  El esquema `ganaderov_private` y las seis RPC de sincronización/transición
  enumeradas por `scripts/supabase-audit.sql` todavía no están instalados.
- Las seis tablas de la aplicación tienen RLS habilitada y cero registros.
  Los siete contadores de incompatibilidad de la proyección son cero.
- El bucket `animal-photos` es privado. No tiene límite de tamaño ni lista MIME
  configurados en el bucket; los límites actuales de los clientes son otra capa.
- `pg_jsonschema` está disponible como versión `0.3.3`, pero no está instalado.
  La migración universal instala la extensión.
- Las cinco opciones generadas en la web publicada están desactivadas.
- No existe un proyecto o una rama de Supabase separados para staging.
  Las variables de conexión de Vercel se comparten entre production, preview y
  development. Una preview, por sí sola, no aísla la base de datos.

Es una instantánea, no una condición permanente. Repetir la auditoría antes de
cualquier activación y comprobar el proyecto de destino mediante su referencia.
La configuración de un APK ya instalado en un teléfono no se puede deducir de
los valores predeterminados del repositorio.

## Archivos exactos y orden

`backend/release-manifest.json` contiene las rutas y SHA-256 de la versión
revisada. Verificarla desde la raíz del repositorio:

```bash
python3 scripts/check-backend-release.py
python3 scripts/check-backend-release.py --paths
```

El programa verifica todos los archivos antes de imprimir rutas. No se conecta
a una base ni ejecuta SQL.

| Orden | Archivo en `backend/` | Cambio |
| --- | --- | --- |
| 1 | `sync_event_create_v1.sql` | Recibos idempotentes de eventos y auditoría por rancho |
| 2 | `entity_projection_v1.sql` | Proyección privada de animales, fotografías y jornadas |
| 3 | `incremental_sync_v1.sql` | Feed ordenado por rancho y cursor |
| 4 | `incremental_retention_v1.sql` | Compactación y rotación de época |
| 5 | `journey_transitions_v1.sql` | Finalización y reanudación atómicas de jornadas |
| 6 | `universal_operations_v1.sql` | Revisiones, historial y operaciones universales |
| 7 | `security_hardening_v1.sql` | `search_path` de triggers, permisos del helper y protección del código de acceso |
| 8 | `forecast_operations_v1.sql` | D2: pronósticos, evaluación y objetivos de peso |
| 9 | `journey_operations_d3.sql` | D3: creación, asistencia y ampliación de jornadas |
| 10 | `photo_operations_d4.sql` | D4: encuadre, fotografía principal y eliminación de metadatos |

`supabase-schema.sql` solo se agrega al inicio para una base desechable vacía.
La opción `--include-base` del verificador existe para ese caso. No se debe
reinstalar el esquema inicial sobre producción: puede restablecer permisos que
las migraciones posteriores han restringido.

Estos archivos contienen transacciones individuales y algunos objetos se crean
una sola vez. No son un instalador idempotente. Registrar cada migración exitosa
en el historial de Supabase, detenerse ante el primer error y revisar el estado
antes de continuar. No reiniciar ciegamente desde el primer archivo ni envolver
todos los archivos en una transacción exterior.

## Pruebas desechables

El job `protocol` de `.github/workflows/web-checks.yml` usa Supabase CLI `2.75.0`
en un runner con Docker, instala los archivos del manifiesto y ejecuta las
pruebas SQL y de concurrencia existentes. Después, el harness HTTP verifica
Auth, PostgREST y Storage reales:

```bash
umask 077
supabase status -o json > "$RUNNER_TEMP/supabase-status.private.json"
GANADEROV_DISPOSABLE_DB=YES \
GANADEROV_SUPABASE_STATUS="$RUNNER_TEMP/supabase-status.private.json" \
python3 tests/integration/http_e2e.py --keep-fixtures --output "$RUNNER_TEMP/d234"
```

La clave administrativa solo crea y elimina usuarios de prueba confirmados.
Las operaciones de la aplicación se ejecutan con JWT obtenidos mediante login
real. El harness crea dos ranchos y un trabajador, y comprueba:

- Aislamiento entre ranchos, autorización de RPC, acceso a tablas y a originales.
- D2: cálculo en servidor, evaluación histórica estable, objetivos y conflictos.
- D3: permisos, asistencias concurrentes, ampliación, finalización incompleta,
  reanudación y reintento sin duplicados.
- D4: carga del original, encuadre, selección concurrente de principal,
  reenvío idempotente, versiones antiguas y conservación del SHA-256 del archivo.
- Revocación de acceso incluso conservando un JWT de Auth todavía válido.

El script rechaza la referencia de producción. Otro destino remoto necesita
una selección explícita de host y la marca de entorno desechable. No usar el
harness de creación de fixtures en producción, aunque las tablas estén vacías.

`http-report.json` es publicable. `fixtures.private.json` contiene contraseñas
temporales y `supabase-status.private.json` contiene credenciales administrativas:
no subirlos como artefactos, no registrarlos en git y no imprimirlos. El workflow
los elimina y descarta los servicios al terminar. El JSON cliente se produce
después de superar las pruebas; contiene únicamente URL y clave de cliente.

En el mismo job, `tests/integration/browser/run.cjs` abre la aplicación real con
el SDK oficial de Supabase fijado por versión y SHA-256. Inicia sesión por el
formulario, descarga originales, guarda un encuadre sin red, recarga sin conexión,
reconecta y cambia la principal. Otro contexto limpio verifica el resultado
remoto. La instrumentación solo lee el estado local y sus hashes; las mutaciones
siguen los controles de la interfaz y las RPC reales. Su informe y capturas se
guardan junto al informe HTTP. Esta prueba de navegador no sustituye una prueba
en un teléfono Android físico.

## Configuración de la primera prueba conjunta

Asignar una URL y una clave publicable del mismo Supabase desechable. Para una
preview alojada, crear un override limitado a su rama o entorno de pruebas y
verificar el `config.js` servido después del despliegue. No usar la conexión
heredada de production.

| Función | Web: variable de build | Valor inicial |
| --- | --- | --- |
| Operaciones D2 y D4 | `SYNC_EVENT_RPC_V1` | `true` |
| Jornadas universales D3 | `SYNC_JOURNEY_UNIVERSAL_V1` | `true` |
| Feed incremental | `SYNC_INCREMENTAL_V1` | `false` |
| Entrega en segundo plano | `SYNC_BACKGROUND_V1` | `false` |
| Exigir únicamente RPC | `SYNC_RPC_ONLY_V1` | `false` |

Los valores web se comparan exactamente con la cadena `true`. D2 y D4 no tienen
interruptores independientes. D3 necesita también el motor de operaciones.
Conservar `SYNC_RPC_ONLY_V1=false`: todavía existen capturas que usan el camino
de escritura de bundles, incluida la incorporación de nuevas fotografías.

El APK de pruebas utiliza `SYNC_UNIVERSAL_V1=true`. Incremental, segundo plano y
los caminos RPC antiguos de evento/jornada permanecen desactivados en ese
perfil nuevo. Las opciones Dart se incorporan al compilar; cambiar variables
del servidor no altera un APK ya construido. Consultar las instrucciones del
flavor `d4test` en Ganaderov-Mobile para recrear y comprobar su backend exacto.

## Paso a producción: propuesta para ejecutar después de la validación

1. Confirmar el commit candidato de ambos clientes y los resultados de CI.
   Completar la prueba de un teléfono real con el APK y otro cliente web,
   incluyendo modo avión, reinicio y reconexión.
2. Repetir `scripts/supabase-audit.sql` con una conexión administrativa de solo
   lectura. Revisar los contadores, RLS, catálogo, historial y referencia del
   proyecto. Si cambió el estado inicial, revisar de nuevo el plan de migración.
3. Comprobar la disponibilidad de una copia recuperable de la base y acordar
   una ventana de instalación. Las migraciones de proyección y feed toman
   bloqueos breves sobre sus tablas fuente.
4. Mantener las opciones de los clientes desactivadas e instalar las diez
   migraciones del manifiesto, una por una, usando el mecanismo de migraciones
   de Supabase. Conservar su nombre y resultado en el historial.
5. Repetir la auditoría. Todas las RPC esperadas deben existir; las tablas
   privadas deben tener RLS y no conceder acceso directo a clientes. Revisar
   además `tests/sql/entity_projection_parity.sql`: las cuatro discrepancias
   deben ser cero y no debe haber identificadores ambiguos. No ejecutar aquí
   las suites SQL que insertan fixtures.
6. Habilitar primero el piloto con las opciones de la tabla anterior y la
   conexión correcta. Verificar permisos, operaciones confirmadas, conflictos
   y bytes de originales desde los dos clientes antes de ampliar el uso.

La revisión de Supabase señaló los dos triggers con `search_path` mutable y
permisos del helper `rls_auto_enable`; el archivo de endurecimiento ya incluido
atiende esos puntos. Las RPC administrativas previstas para usuarios
autenticados conservan sus comprobaciones de pertenencia y rol. Las advertencias
sobre esas RPC no justifican retirarles indiscriminadamente `EXECUTE`.

Si falla el piloto, detener nuevas operaciones del perfil afectado, conservar
las colas pendientes y corregir o revertir la configuración del cliente. No
eliminar el historial de operaciones, las proyecciones o los originales para
resolver un conflicto. Desactivar una opción no equivale a deshacer una
migración ni a confirmar lo que queda en una cola local.

La instalación productiva y la activación de opciones son acciones pendientes;
este documento y las pruebas desechables no las realizan automáticamente.
