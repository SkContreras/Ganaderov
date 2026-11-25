-- Reinicio de datos del proyecto Ganadero.
-- Conserva toda la estructura de la base de datos.
-- Conserva usuarios de Auth, buckets y archivos.
-- Realizar un respaldo antes de ejecutar.

BEGIN;

DO $$
DECLARE
    v_confirm TEXT := '';
BEGIN
    IF v_confirm IS DISTINCT FROM 'VACIAR-DATOS' THEN
        RAISE EXCEPTION
            'Confirmación requerida: cambia v_confirm a VACIAR-DATOS.';
    END IF;
END;
$$;

TRUNCATE TABLE
    public.ranch_animal_configs,
    public.ranch_access_requests,
    public.ranch_members,
    public.ranches,
    public.animal_sync_records,
    public.journey_sync_records
RESTART IDENTITY RESTRICT;

COMMIT;