# Entrega universal Web en segundo plano

Con `syncBackgroundV1: true` y `syncEventRpcV1: true`, el Service Worker puede
entregar la cola universal sin una ventana de la PWA abierta, si el navegador
admite Background Sync. Utiliza el mismo `deliverUniversal` que el primer plano,
los mismos UUID y cuerpos sellados, IndexedDB cifrada y el Web Lock
`ganaderov-outbox:<owner>:<user>`. El worker es un módulo ES y se registra con
`{type: 'module'}`.

## Autorización limitada

Una sesión en primer plano obtiene `sync_issue_background_capability` después
de verificar la membresía. La autorización está ligada a usuario, rancho,
dispositivo y sesión Auth; dura una hora por defecto y como máximo seis. No
permite consultar tablas ni reutilizar una sesión Auth general. El registro
`ganaderov-background-v1` cifra la capability y la configuración pública con
AES-GCM; no almacena access tokens ni refresh tokens de Auth.

El worker invoca `sync_apply_background_operation`. Para `photo.create` envía
un multipart con `capability`, `operation` y el Blob original al gateway
`/functions/v1/sync-background-photo`. El gateway sube y aplica; su respuesta es
el recibo universal del servidor. No se sustituye el original ni se fabrica un
recibo local. Un conflicto de bytes se conserva para revisión.

Requiere la migración `backend/20261127040000_background_capabilities_v1.sql` y
la función `supabase/functions/sync-background-photo`. La función valida la
capability; su credencial administrativa existe únicamente en el servidor. La
configuración `verify_jwt=false` de esa función no sustituye esa validación.
Estos archivos y las pruebas no instalan servicios ni activan producción.

Cerrar sesión, cambiar de cuenta/rancho o desactivar el flag invalida primero
el registro local. Si no hay red, la revocación remota permanece cifrada y se
envía después mediante `sync_revoke_background_token`. Una emisión tardía no
puede reactivar una sesión invalidada. El servidor comprueba caducidad, sesión,
membresía, rol, ámbito y cuota en cada entrega. Un 401, 403 o 429 pausa el envío
sin convertir la operación válida en un rechazo. Una solicitud ya recibida por
el servidor puede terminar; su UUID permite reconocer el duplicado al volver.

## Dependencias, reintentos y límites

Una operación dependiente obtiene su revisión exclusivamente del recibo de su
predecesora y se sella antes del primer envío. No se recalcula una revisión tras
un conflicto. Las confirmaciones siguen visibles localmente hasta descargar
una instantánea posterior. El worker limita cada ejecución a ocho operaciones.
Los fallos transitorios conservan el cuerpo y solicitan reintento; las
dependencias rechazadas quedan bloqueadas para revisión.

Background Sync no está disponible en todos los navegadores y no garantiza
horarios ni ejecución tras cerrar forzosamente el navegador o el sistema. Al
caducar la capability se necesita abrir la aplicación para verificar una sesión
y emitir otra. El envío en primer plano permanece disponible. Los trabajos de
otro dispositivo importados no se entregan con la capability actual.

## Evidencia y pruebas

- `node --test tests/background-universal.test.mjs`: ámbitos, TTL, claves
  públicas, originales, revocación en vuelo y códigos de autorización.
- `node tests/browser/background-universal.cjs`: Service Worker de producción,
  evento `sync` real despachado por CDP, IndexedDB/WebCrypto/Web Locks reales y
  cero ventanas PWA al entregar una cadena y una foto. El servidor de este test
  es sintético y sólo loopback; no acredita el planificador del sistema.
- El navegador admite `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH` y
  `BACKGROUND_BROWSER_ARTIFACTS` para dejar un informe portable en CI.

Referencias de plataforma:
[MDN Background Synchronization](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API),
[módulos en workers](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules/Modules_on_the_web)
y [CDP ServiceWorker](https://chromedevtools.github.io/devtools-protocol/tot/ServiceWorker/).
