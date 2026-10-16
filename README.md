# Ganadero

Aplicación para administrar el inventario y los expedientes individuales del ganado bovino. Los datos se guardan primero en el navegador y, al iniciar sesión y tener conexión, se sincronizan con Supabase para compartirlos entre dispositivos.

El logo y el icono de la pestaña se sirven desde [`ganaderov-icon.svg`](./ganaderov-icon.svg), que también se incluye en el caché de la aplicación para uso offline.

## Iconografía e interfaz accesible

Los iconos de la interfaz usan símbolos SVG sólidos en una biblioteca común, con el mismo color, proporciones y remates, de acuerdo con la guía visual del proyecto. Conserva los `id` y atributos `data-*` existentes al cambiar su presentación. No uses emojis ni caracteres como sustitutos de iconos de navegación. Los iconos decorativos deben ocultarse a lectores de pantalla cuando el botón ya tenga un nombre accesible. Las acciones destructivas deben comunicar claramente qué dato eliminan; los estados se muestran con texto, icono y color, nunca solo con color.

## Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. En un proyecto nuevo, en **SQL Editor**, ejecuta [`supabase-schema.sql`](./supabase-schema.sql). Para un proyecto ya configurado que contiene datos, crea primero una copia de seguridad y prueba la migración aditiva [`supabase-ranch-access-migration.sql`](./supabase-ranch-access-migration.sql) en una instancia de pruebas restaurada desde esa copia. Esta migración cambia las políticas RLS existentes para permitir miembros aprobados; no borra filas ni fotos, pero sí cambia el acceso al aplicarla. No la ejecutes directamente en producción sin validar antes todas las cuentas y políticas.
3. En **Project Settings → API**, copia la **Project URL** y la clave **anon/public**. En [`config.js`](./config.js), colócalas en `supabaseUrl` y `supabaseAnonKey`.
4. Publica de nuevo estos archivos en Vercel. La clave `anon/public` está diseñada para el navegador y las políticas RLS limitan los datos a la cuenta autenticada. **Nunca pongas una clave `service_role` en `config.js`.**
5. En **Authentication → URL Configuration**, agrega la URL de la app desplegada como sitio/redirección permitida.
6. Abre la app con conexión, elige **Crear cuenta**, y confirma el correo si Supabase lo solicita. Inicia sesión con esa misma cuenta en los demás dispositivos.

El archivo `config.js` contiene solo valores públicos del proyecto; no contiene contraseñas. Si se usa un repositorio público, no agregues claves privadas ni credenciales de administrador.

## Sincronización y conflictos

- Cada animal tiene una fecha y hora de última modificación, que también se actualiza al cambiar su historial o sus fotografías.
- La fotografía principal se encuadra sin deformarla; el propietario o administrador puede ajustar su posición horizontal y vertical desde **Ajustar encuadre**. El encuadre se guarda y sincroniza con la ficha, y forma parte de las copias de seguridad.
- Los cambios se guardan en IndexedDB en el dispositivo y se envían cuando hay conexión. La app debe haberse abierto al menos una vez con conexión para instalar el modo sin conexión.
- Si el mismo animal cambió en la nube y en el dispositivo desde la última sincronización, Ganadero pregunta qué versión conservar. **Aceptar** sube la versión de este dispositivo; **Cancelar** descarga la versión de la nube. La decisión reemplaza la ficha completa del animal, incluido su historial y sus fotos.
- Los cambios en animales diferentes se sincronizan por separado. Las eliminaciones también se propagan a los demás dispositivos.
- Usa **Crear copia de seguridad** periódicamente. El archivo JSON incluye animales, historial, jornadas, estimaciones, fotos codificadas dentro del archivo y tombstones de animales eliminados. Las fotos pueden hacer crecer considerablemente la copia. **Importar copia** reemplaza los datos locales del dispositivo; las eliminaciones se propagan a la nube en la siguiente sincronización.

## Jornadas de manejo

El inventario muestra solo animales activos. Los marcados como vendidos, fallecidos, dados de baja, «Otro» o desaparecidos se excluyen de la lista y de los conteos del inventario, pero sus fichas, eventos y jornadas anteriores se conservan. El botón **Ver archivo** permite buscarlos, abrir sus expedientes y, con permisos de propietario o administrador, reactivarlos. Al reactivarlos vuelven al inventario y pueden incluirse en jornadas nuevas. Tampoco se pueden incluir en jornadas nuevas ni agregarse a una jornada en curso mientras estén archivados. Si alguno ya estaba en una jornada activa, deja de aparecer en la lista operativa y ya no cuenta como pendiente; la participación histórica no se elimina.

En **Jornadas** puedes crear jornadas de baño, vacunación, desparasitación, inyección, medicamento, pesaje, revisión veterinaria u otra actividad. La lista se toma de los animales activos al iniciar la jornada y puedes incorporar animales activos después sin reemplazar el progreso existente. Las marcas se guardan en IndexedDB y la jornada puede continuar sin internet.

Al finalizar una jornada incompleta, puedes abrirla desde el historial y pulsar **Reanudar jornada**. Los animales ya atendidos quedan bloqueados para evitar marcarlos o registrar su actividad dos veces; se atienden solo los pendientes y se finaliza de nuevo. Los registros de atención usan un identificador estable por jornada y animal, por lo que la sincronización y una reapertura actualizan el mismo registro, no crean otro evento. En jornadas de pesaje, al seleccionar un animal pendiente aparece la captura de peso en la misma pantalla; el peso se guarda localmente y marca al animal como atendido. También se puede corregir el peso de un animal atendido mientras la jornada está activa o reanudada; al finalizarla de nuevo, el historial conserva el mismo evento y no duplica el pesaje.

Cada marca guarda la hora y la cuenta autenticada disponible. Sin sesión, queda indicada como «Usuario local (sin sesión)»; esa etiqueta no verifica la identidad de una persona. La finalización también conserva responsable y hora. La información se sincroniza con Supabase al recuperar conexión, pero la sincronización entre dos dispositivos necesita una configuración real de Supabase y no se da por probada solo porque funcione el guardado local.

Para proteger el historial, un animal que tenga registros o esté incluido en una jornada no se puede eliminar definitivamente desde la interfaz; se puede dar de baja manteniendo su ficha y participación. Las jornadas se incluyen en las copias de seguridad.

## Acceso y usuarios del rancho

La pantalla de acceso permite iniciar sesión, crear una cuenta con confirmación de contraseña y solicitar recuperación por correo. Las contraseñas deben tener al menos 8 caracteres y cumplir también la política configurada en Supabase. Si la confirmación por correo está habilitada, el usuario verá un mensaje que le indica que confirme la dirección antes de iniciar sesión; el enlace de recuperación permite definir y confirmar una contraseña nueva. Para que estos enlaces regresen a Ganaderov, agrega el origen y la URL desplegada en **Authentication → URL Configuration → Redirect URLs** de Supabase.

Después de iniciar sesión, el usuario puede crear el primer perfil y rancho, o solicitar acceso con un código compartido por el propietario. La solicitud no concede acceso hasta que el propietario la apruebe. El propietario puede revisar solicitudes, retirar trabajadores y consultar los perfiles del rancho. Una cuenta solo puede pertenecer a un rancho activo. El rol trabajador puede registrar pesos, tratamientos y jornadas, pero no editar fichas, borrar registros, administrar permisos ni modificar fotografías. El propietario conserva la administración completa. Una vez aplicada la migración, sus políticas RLS y triggers hacen cumplir estas restricciones en el servidor, además de los controles de interfaz.

El almacenamiento local se separa por identificador del rancho. Al asociar por primera vez una cuenta, los datos locales anteriores se copian al almacén aislado de ese rancho y solo se vacía el almacén anterior después de confirmar la copia local. Conserva una copia de seguridad antes de ese primer cambio como protección adicional. Una sesión offline previamente reconocida reutiliza el perfil cacheado del rancho; al reconectar, Ganadero consulta de nuevo la membresía y Supabase vuelve a aplicar RLS.

### Aplicar la migración de usuarios en forma segura

1. Descarga una copia desde la aplicación y conserva el archivo original fuera del navegador.
2. Restaura una copia de la base de datos/proyecto en Supabase Staging, o crea un proyecto temporal y migra allí los datos actuales.
3. Ejecuta `supabase-ranch-access-migration.sql` en staging. Verifica que las filas de `animal_sync_records`, `journey_sync_records` y los objetos del bucket `animal-photos` permanezcan intactos.
4. Con dos cuentas de prueba, comprueba que el propietario pueda crear el perfil, que un trabajador solicite acceso, que la aprobación habilite solo ese rancho y que una cuenta de otro rancho no pueda leer datos, jornadas ni fotos.
5. Comprueba también que el trabajador pueda añadir pesajes, tratamientos y jornadas, pero no alterar datos base del animal, borrar eventos, cambiar fotos, dar de baja animales ni modificar roles.
6. Solo después de verificar el respaldo, las políticas y las cuentas, programa la ejecución del mismo archivo en producción. La aplicación no ejecuta la migración por sí sola.

La migración solo añade tablas y funciones y reemplaza las políticas indicadas; no ejecuta `DELETE`, `TRUNCATE`, `DROP TABLE` ni modifica los `owner_id` existentes. Las cuentas que ya tienen datos conservan su `owner_id`: después de crear su perfil de rancho, ese mismo identificador funciona como propietario y mantiene sus filas. Hasta aplicar la migración, la aplicación reconoce el esquema anterior y no habilita la administración multiusuario.

### Estado de validación y publicación

- El código de perfiles/rancho y la migración están preparados localmente. La migración no se ha ejecutado en Supabase ni se ha validado contra PostgreSQL en un proyecto de pruebas.
- No se han probado cuentas reales, confirmaciones o recuperación por correo, separación RLS entre dos ranchos, ni la aprobación/revocación con trabajadores reales.
- No se ha comprobado sincronización entre dos dispositivos, pérdida y restauración de conexión, ni respaldo/restauración de una fotografía real.
- Los cambios de esta etapa no están publicados en Vercel; antes de publicarlos hay que completar las pruebas de staging y autorizar el despliegue.

## Crecimiento y peso objetivo

La ficha individual muestra los pesajes reales y la fecha de la última pesada. Para estimar la ganancia media diaria (GMD), Ganaderov toma todas las fechas distintas dentro de los 30 días anteriores a la pesada más reciente, promedia las mediciones hechas en el mismo día y calcula el cambio entre el primer y el último peso de esa ventana dividido por los días reales transcurridos. Con una sola pesada, fechas repetidas o sin dos fechas distintas en la ventana no se calcula una GMD automática. Si hay varios intervalos recientes con aumentos y pérdidas, se advierte que la GMD resume un ritmo variable.

Cuando hay GMD reciente, la ficha muestra su proyección lineal a 90 días. Una GMD negativa permanece negativa y puede producir una estimación de pérdida de peso; la app no la sustituye por una ganancia positiva. Si pasan 30 días o más desde la última pesada, la ficha y la calculadora muestran un aviso para recordar que la información puede ser antigua. La proyección es una estimación matemática, no una garantía, y no considera alimentación, genética, salud o manejo. No se usan modelos de Brody, Gompertz o Richards.

En la ficha se puede indicar fecha de nacimiento confirmada o, en su lugar, una edad aproximada en años y meses. La edad aproximada se guarda con la fecha en que fue registrada, se conserva como estimación y nunca se convierte en una fecha de nacimiento inventada.

El rango de peso objetivo se configura por animal, se guarda en su ficha y se sincroniza junto con los datos existentes. Es opcional y puede quitarse dejando vacíos ambos límites. Ningún rango de mercado se impone como universal.

No se utiliza todavía un modelo de Brody, Gompertz o Richards. La aplicación no estima parámetros de crecimiento ni trata una edad aproximada como fecha de nacimiento confirmada; un modelo por edad requiere primero datos de edad confiables y validación adecuada para el hato.

## Calculadora de peso y valor de mercado

En **Gestión → Calculadora** puedes seleccionar un animal y cargar su última pesada. Si hay dos o más fechas distintas en los 30 días anteriores a la última pesada, propone la GMD calculada con las fechas y los días reales de esa ventana; esta GMD se puede modificar. Una pesada por sí sola no produce una tendencia. También acepta peso y GMD manuales, pero estos valores se identifican como supuestos y no como crecimiento medido. Al indicar los días de espera, estima el peso futuro con `peso actual + GMD × días`. Una proyección inferior a cero se muestra como tal y no se utiliza para estimar valor de mercado.

Puedes guardar una estimación para un animal desde la calculadora, incluso sin completar una cotización. Se conserva el peso y fecha base, GMD y su origen, las pesadas usadas, el plazo, el peso estimado y la fecha objetivo. Una pesada individual posterior o una jornada de pesaje compara la primera pesada registrada después de la estimación que tenga fecha igual o posterior a la fecha objetivo, y registra el peso real, la fecha de esa pesada, el error firmado (`real − estimado`), el error absoluto y el error porcentual absoluto cuando se puede calcular. Este registro permite comparar estimaciones con resultados reales; no modifica los pesajes ni representa una validación científica del modelo.

La cotización se captura manualmente: categoría actual, fecha y precios mínimo, promedio y máximo por kg. Opcionalmente puedes ingresar el siguiente rango de peso y sus precios; si el peso proyectado alcanza el umbral, se usa el precio promedio de esa categoría, a menos que se capture un precio futuro supuesto. La pantalla compara el valor bruto de vender hoy con el bruto del escenario de espera y resta el costo diario por el plazo indicado. No incluye transporte, comisiones, mermas ni otros gastos.

La calculadora enlaza a [México Ganadero](https://www.mexicoganadero.com/precios/) como referencia, pero no descarga sus datos automáticamente: la página consultada no ofrece una respuesta estructurada accesible para integrarla con fiabilidad desde esta aplicación estática. Verifica la categoría, clasificación, fecha y región antes de capturar precios. Las cotizaciones, precios futuros y costos se usan solo durante la sesión de la calculadora; no se guardan, sincronizan ni incluyen en las copias de seguridad. Las estimaciones de crecimiento guardadas sí se conservan en el dispositivo, se incluyen en la sincronización por animal y en las copias de seguridad. Son referencias editables, no ofertas ni predicciones de mercado.

## Uso local

Abre `index.html` en una versión reciente de Chrome o Edge. Sin configurar Supabase, la app conserva el modo local de un solo dispositivo. Las fotos se almacenan en IndexedDB cuando está sin conexión y en el bucket privado de Supabase al sincronizar.
