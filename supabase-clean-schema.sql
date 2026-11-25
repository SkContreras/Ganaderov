-- Elimina la estructura creada por Ganadero.
-- Conserva los usuarios de auth.users y otros objetos ajenos al proyecto.
--
-- Antes de ejecutar, cambia el valor v_confirm para aceptar la eliminación.

do $$
declare
  v_confirm text := '';
begin
  if v_confirm is distinct from 'BORRAR-ESQUEMA' then
    raise exception 'Confirmación requerida: cambia v_confirm a BORRAR-ESQUEMA.';
  end if;
end;
$$;

begin;

delete from storage.objects
where bucket_id = 'animal-photos';

delete from storage.buckets
where id = 'animal-photos';

drop table if exists public.ranch_animal_configs cascade;
drop table if exists public.ranch_access_requests cascade;
drop table if exists public.ranch_members cascade;
drop table if exists public.ranches cascade;
drop table if exists public.animal_sync_records cascade;
drop table if exists public.journey_sync_records cascade;

drop function if exists public.set_animal_sync_modified_at();
drop function if exists public.set_journey_sync_updated_at();
drop function if exists public.is_ranch_member(uuid);
drop function if exists public.is_ranch_admin(uuid);
drop function if exists public.ranch_member_role(uuid);
drop function if exists public.is_current_ranch_actor(uuid, jsonb);
drop function if exists public.create_my_ranch(text, text);
drop function if exists public.request_ranch_access(text, text);
drop function if exists public.review_ranch_access_request(uuid, boolean);
drop function if exists public.revoke_ranch_worker(uuid);
drop function if exists public.get_my_ranch_context();
drop function if exists public.validate_worker_animal_sync_record();
drop function if exists public.validate_worker_journey_sync_record();
drop function if exists public.save_ranch_animal_config(uuid, integer, jsonb);
drop function if exists public.worker_editable_animal_fields();

commit;

notify pgrst, 'reload schema';
