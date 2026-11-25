-- Limpia solo los datos de Ganadero.
-- Conserva tablas, funciones, trigger, políticas y usuarios de Supabase.
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

delete from storage.objects
where bucket_id = 'animal-photos';

delete from public.ranch_animal_configs;
delete from public.ranch_access_requests;
delete from public.ranch_members;
delete from public.ranches;
delete from public.animal_sync_records;
delete from public.journey_sync_records;

commit;

notify pgrst, 'reload schema';
