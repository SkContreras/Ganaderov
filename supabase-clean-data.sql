-- Limpia solo los datos de Ganadero.
-- Conserva tablas, funciones, trigger, políticas, fotos y usuarios de Supabase.
-- Vacía las fotos por separado usando la API de Storage; no borres storage.objects desde SQL.
--
-- Antes de ejecutar, cambia el valor v_confirm para aceptar la eliminación.

do $$
declare
  v_confirm text := '';
begin
  if v_confirm is distinct from 'BORRAR-DATOS' then
    raise exception 'Confirmación requerida: cambia v_confirm a BORRAR-DATOS.';
  end if;
end;
$$;

begin;

delete from public.ranch_animal_configs;
delete from public.ranch_access_requests;
delete from public.ranch_members;
delete from public.ranches;
delete from public.animal_sync_records;
delete from public.journey_sync_records;

commit;

notify pgrst, 'reload schema';
