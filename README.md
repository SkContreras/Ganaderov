# Ganadero

Aplicación para administrar el inventario y los expedientes individuales del ganado bovino. Los datos se guardan primero en el navegador y, al iniciar sesión y tener conexión, se sincronizan con Supabase para compartirlos entre dispositivos.

## Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. En **SQL Editor**, ejecuta el contenido de [`supabase-schema.sql`](./supabase-schema.sql). Esto crea las tablas protegidas por usuario y el almacenamiento privado de fotografías. Si ya configuraste Supabase anteriormente, vuelve a ejecutar el archivo para añadir la tabla de jornadas.
3. En **Project Settings → API**, copia la **Project URL** y la clave **anon/public**. En [`config.js`](./config.js), colócalas en `supabaseUrl` y `supabaseAnonKey`.
4. Publica de nuevo estos archivos en Vercel. La clave `anon/public` está diseñada para el navegador y las políticas RLS limitan los datos a la cuenta autenticada. **Nunca pongas una clave `service_role` en `config.js`.**
5. En **Authentication → URL Configuration**, agrega la URL de la app desplegada como sitio/redirección permitida.
6. Abre la app con conexión, elige **Crear cuenta**, y confirma el correo si Supabase lo solicita. Inicia sesión con esa misma cuenta en los demás dispositivos.

El archivo `config.js` contiene solo valores públicos del proyecto; no contiene contraseñas. Si se usa un repositorio público, no agregues claves privadas ni credenciales de administrador.

## Sincronización y conflictos

- Cada animal tiene una fecha y hora de última modificación, que también se actualiza al cambiar su historial o sus fotografías.
- Los cambios se guardan en IndexedDB en el dispositivo y se envían cuando hay conexión. La app debe haberse abierto al menos una vez con conexión para instalar el modo sin conexión.
- Si el mismo animal cambió en la nube y en el dispositivo desde la última sincronización, Ganadero pregunta qué versión conservar. **Aceptar** sube la versión de este dispositivo; **Cancelar** descarga la versión de la nube. La decisión reemplaza la ficha completa del animal, incluido su historial y sus fotos.
- Los cambios en animales diferentes se sincronizan por separado. Las eliminaciones también se propagan a los demás dispositivos.
- Usa **Crear copia de seguridad** periódicamente. Las copias descargadas siguen siendo una protección adicional ante pérdida de acceso a la cuenta.

## Jornadas de manejo

En **Jornadas** puedes crear jornadas de baño, vacunación, desparasitación, inyección, medicamento, pesaje, revisión veterinaria u otra actividad. La lista de animales se toma del inventario al iniciar la jornada. Las marcas y el progreso se guardan automáticamente; puedes cerrar la app y continuar una jornada en progreso después. Al finalizar, solo los animales marcados reciben el evento en su historial; los pendientes se muestran en el resumen. Para las jornadas de pesaje, se registra el peso individual al marcar cada animal. Las jornadas también se incluyen en las copias de seguridad y, al configurar Supabase, se sincronizan con la misma cuenta.

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
