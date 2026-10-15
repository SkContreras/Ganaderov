# Ganadero

Aplicación para administrar el inventario y los expedientes individuales del ganado bovino. Los datos se guardan primero en el navegador y, al iniciar sesión y tener conexión, se sincronizan con Supabase para compartirlos entre dispositivos.

## Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. En **SQL Editor**, ejecuta el contenido de [`supabase-schema.sql`](./supabase-schema.sql). Esto crea la tabla protegida por usuario y el almacenamiento privado de fotografías.
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

## Uso local

Abre `index.html` en una versión reciente de Chrome o Edge. Sin configurar Supabase, la app conserva el modo local de un solo dispositivo. Las fotos se almacenan en IndexedDB cuando está sin conexión y en el bucket privado de Supabase al sincronizar.
