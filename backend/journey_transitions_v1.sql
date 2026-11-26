-- Review and test in staging before applying. No trigger bypass or service-role key.
begin;
create or replace function public.finish_ranch_journey_v1(p_owner_id uuid,p_journey_id text,p_expected_version timestamptz,p_allow_incomplete boolean)
returns jsonb
language plpgsql security invoker set search_path = ''
as $fn$
declare
  j public.journey_sync_records%rowtype;
  a public.animal_sync_records%rowtype;
  item jsonb;
  ev jsonb;
  old_event jsonb;
  actor jsonb;
  context jsonb;
  stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  pending integer;
  attended integer := 0;
  result jsonb;
  event_id text;
begin
  if auth.uid() is null or not public.is_ranch_admin(p_owner_id) then
    raise exception 'Solo un administrador puede finalizar jornadas desde esta versión.' using errcode='42501';
  end if;
  context := public.get_my_ranch_context();
  if context->>'owner_id' is distinct from p_owner_id::text or context->>'status' is distinct from 'active' then
    raise exception 'Membresía inválida' using errcode='42501';
  end if;
  actor := jsonb_build_object('authUserId',auth.uid(),'email',coalesce(auth.jwt()->>'email',''),'label',context->>'display_name');
  select * into j from public.journey_sync_records where owner_id=p_owner_id and journey_id=p_journey_id for update;
  if not found then raise exception 'Jornada no encontrada'; end if;
  if j.payload->>'status' in ('completed','incomplete') then return j.payload; end if;
  if j.updated_at is distinct from p_expected_version or j.payload->>'status' is distinct from 'in_progress' then
    raise exception 'La jornada cambió; actualiza antes de finalizar' using errcode='40001';
  end if;
  if j.payload->>'id' is distinct from p_journey_id or coalesce(j.payload->>'type','') not in ('weight','bath','vaccine','deworm','injection','medication','review','other') or jsonb_typeof(j.payload->'roster') is distinct from 'array' then raise exception 'Jornada inválida'; end if;
  if (select count(*) from jsonb_array_elements(j.payload->'roster')) <> (select count(distinct value->>'id') from jsonb_array_elements(j.payload->'roster')) then raise exception 'Animales duplicados'; end if;
  if coalesce(j.payload->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Fecha inválida' using errcode='22023';
  end if;
  perform (j.payload->>'date')::date;
  select count(*) into pending from jsonb_array_elements(j.payload->'roster') where value->'attended' is distinct from 'true'::jsonb;
  if pending>0 and p_allow_incomplete is distinct from true then raise exception 'Confirma el cierre incompleto' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(j.payload->'roster') where value->'attended'='true'::jsonb order by value->>'id'
  loop
    select * into a from public.animal_sync_records where owner_id=p_owner_id and animal_id=item->>'id' and deleted_at is null for update;
    if not found or a.payload->'animal'->>'id' is distinct from a.animal_id or jsonb_typeof(a.payload->'events') is distinct from 'array' then raise exception 'Ficha no disponible: %',item->>'id'; end if;
    if jsonb_typeof(item->'attendedBy') is distinct from 'object' or coalesce(item->>'attendedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception 'Atención sin auditoría'; end if;
    if j.payload->>'type'='weight' then
      if jsonb_typeof(item->'weight') is distinct from 'number' then raise exception 'Peso inválido'; end if;
      if (item->>'weight')::numeric not between 0 and 100000 then raise exception 'Peso inválido'; end if;
    end if;
    event_id := 'journey:'||p_journey_id||':'||a.animal_id;
    ev := jsonb_build_object('id',event_id,'animalId',a.animal_id,'journeyId',p_journey_id,'type',j.payload->>'type','date',j.payload->>'date','label',case when j.payload->>'type'='other' then coalesce(j.payload->>'name','') else coalesce(j.payload->>'product','') end,'product',case when j.payload->>'type'='other' then coalesce(j.payload->>'product','') else '' end,'dose',coalesce(j.payload->>'dose',''),'notes',coalesce(j.payload->>'notes',''),'createdAt',item->>'attendedAt','performedAt',item->>'attendedAt','performedBy',item->'attendedBy');
    if j.payload->>'type'='weight' then
      ev:=ev||jsonb_build_object('weight',item->'weight');
      if item ? 'weightUpdatedAt' then ev:=ev||jsonb_build_object('weightUpdatedAt',item->'weightUpdatedAt'); end if;
      if item ? 'weightUpdatedBy' then ev:=ev||jsonb_build_object('weightUpdatedBy',item->'weightUpdatedBy'); end if;
    end if;
    select value into old_event from jsonb_array_elements(a.payload->'events') where value->>'id'=event_id;
    if found then
      if old_event is distinct from ev then
        if j.payload->>'type' <> 'weight'
          or (old_event - array['weight','weightUpdatedAt','weightUpdatedBy'])
             is distinct from (ev - array['weight','weightUpdatedAt','weightUpdatedBy'])
          or item->'weightUpdatedBy' is null or item->'weightUpdatedAt' is null then
          raise exception 'Conflicto con evento existente: %',event_id using errcode='40001';
        end if;
        update public.animal_sync_records set payload=jsonb_set(payload,'{events}',(
          select jsonb_agg(case when e->>'id'=event_id then ev else e end order by pos)
          from jsonb_array_elements(payload->'events') with ordinality entries(e,pos)
        )) where owner_id=p_owner_id and animal_id=a.animal_id;
      end if;
    else
      update public.animal_sync_records set payload=jsonb_set(payload,'{events}',(payload->'events')||jsonb_build_array(ev)) where owner_id=p_owner_id and animal_id=a.animal_id;
      if not found then raise exception 'No se pudo guardar historial'; end if;
    end if;
    attended:=attended+1;
  end loop;
  result:=j.payload||jsonb_build_object('status',case when pending=0 then 'completed' else 'incomplete' end,'completedAt',stamp,'completedBy',actor,'updatedAt',stamp);
  update public.journey_sync_records set payload=result where owner_id=p_owner_id and journey_id=p_journey_id;
  if not found then raise exception 'No se pudo cerrar jornada'; end if;
  return result;
end;
$fn$;
revoke all on function public.finish_ranch_journey_v1(uuid,text,timestamptz,boolean) from public,anon;
grant execute on function public.finish_ranch_journey_v1(uuid,text,timestamptz,boolean) to authenticated;
-- Resume only an incomplete journey, retaining attendance and its prior events.
create function public.resume_ranch_journey_v1(p_owner_id uuid,p_journey_id text,p_expected_version timestamptz)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare j public.journey_sync_records%rowtype; result jsonb;
begin
 if auth.uid() is null or not public.is_ranch_admin(p_owner_id) then raise exception 'Permiso denegado' using errcode='42501'; end if;
 select * into j from public.journey_sync_records where owner_id=p_owner_id and journey_id=p_journey_id for update;
 if not found then raise exception 'Jornada no encontrada'; end if;
 if j.updated_at is distinct from p_expected_version or j.payload->>'status' is distinct from 'incomplete' then raise exception 'Actualiza la jornada' using errcode='40001'; end if;
 if not exists(select 1 from jsonb_array_elements(j.payload->'roster') e where e->'attended' is distinct from 'true'::jsonb) then raise exception 'No hay animales pendientes'; end if;
 result:=(j.payload-'completedBy')||jsonb_build_object('status','in_progress','completedAt',null,'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 update public.journey_sync_records set payload=result where owner_id=p_owner_id and journey_id=p_journey_id;
 return result;
end;
$fn$;
revoke all on function public.resume_ranch_journey_v1(uuid,text,timestamptz) from public,anon;
grant execute on function public.resume_ranch_journey_v1(uuid,text,timestamptz) to authenticated;
commit;
