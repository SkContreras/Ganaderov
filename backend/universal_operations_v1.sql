-- Apply after event RPC, entity projection, journey transitions and incremental feed.
begin;
create extension if not exists pg_jsonschema with schema extensions;
lock table public.animal_sync_records, public.journey_sync_records, public.ranch_animal_configs
  in share row exclusive mode;

-- Immutable versions include legacy edits and tombstones. A history row refers to one
-- entity inside the ranch, independently of changes to its parent or siblings.
create table ganaderov_private.entity_history (
  owner_id uuid not null references public.ranches on delete cascade,
  kind text not null, entity_id text not null, revision bigint not null check (revision between 1 and 9007199254740991),
  parent_id text, data jsonb, actor_id uuid, recorded_at timestamptz not null default clock_timestamp(),
  primary key (owner_id,kind,entity_id,revision)
);
create table ganaderov_private.operation_audit (
  owner_id uuid not null references public.ranches on delete cascade,
  operation_id uuid not null, actor_id uuid not null, actor_role text not null,
  request jsonb not null, receipt jsonb not null, before_data jsonb, after_data jsonb,
  primary key (owner_id,operation_id)
);
alter table ganaderov_private.entity_history enable row level security;
alter table ganaderov_private.operation_audit enable row level security;
revoke all on ganaderov_private.entity_history,ganaderov_private.operation_audit from public,anon,authenticated;

create function ganaderov_private.track_version(o uuid,k text,id text,parent text,body jsonb)
returns void language plpgsql set search_path='' as $$
declare last_version ganaderov_private.entity_history;
begin
  select * into last_version from ganaderov_private.entity_history h
    where (h.owner_id,h.kind,h.entity_id)=(o,k,id) order by h.revision desc limit 1;
  if found and last_version.parent_id is distinct from parent then
    raise exception 'Identificador duplicado en el rancho para %: %',k,id using errcode='23505';
  end if;
  if last_version.data is not distinct from body and last_version.revision is not null then return; end if;
  insert into ganaderov_private.entity_history(owner_id,kind,entity_id,parent_id,revision,data,actor_id)
    values(o,k,id,parent,coalesce(last_version.revision,0)+1,body,auth.uid());
end;
$$;

create function ganaderov_private.track_record(o uuid,k text,id text,prev jsonb,body jsonb)
returns void language plpgsql set search_path='' as $$
declare collection text; child record;
begin
  if k<>'animal' then
    perform ganaderov_private.track_version(o,k,id,null,body);
    return;
  end if;
  if prev->'animal' is distinct from body->'animal' or prev is null or body is null then
    perform ganaderov_private.track_version(o,k,id,null,body->'animal');
  end if;
  foreach collection in array array['events','photos'] loop
    for child in
      select coalesce(n.item->>'id',p.item->>'id') as id,n.item
      from jsonb_array_elements(prev->collection) p(item)
      full join jsonb_array_elements(body->collection) n(item) on p.item->>'id'=n.item->>'id'
      where p.item is distinct from n.item
    loop
      perform ganaderov_private.track_version(o,case collection when 'events' then 'event' else 'photo' end,
        child.id,id,child.item);
    end loop;
  end loop;
end;
$$;

create function ganaderov_private.track_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare prev jsonb; curr jsonb; k text:=tg_argv[0]; id_key text:=tg_argv[1]; payload_key text:=tg_argv[2];
begin
  if tg_op<>'INSERT' then prev:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then curr:=to_jsonb(new); end if;
  if tg_op='UPDATE' and (prev->>'owner_id',prev->>id_key) is distinct from (curr->>'owner_id',curr->>id_key) then
    raise exception 'La identidad del registro es inmutable' using errcode='22023';
  end if;
  -- A parent ranch may already have been deleted by a cascading foreign key.
  if tg_op='DELETE' and not exists(select 1 from public.ranches where owner_id=(prev->>'owner_id')::uuid) then return null; end if;
  perform ganaderov_private.track_record((coalesce(curr,prev)->>'owner_id')::uuid,k,coalesce(curr,prev)->>id_key,
    case when prev->>'deleted_at' is null then prev->payload_key end,
    case when curr->>'deleted_at' is null then curr->payload_key end);
  return null;
end;
$$;
select ganaderov_private.track_record(owner_id,'animal',animal_id,null,case when deleted_at is null then payload end) from public.animal_sync_records;
select ganaderov_private.track_record(owner_id,'journey',journey_id,null,payload) from public.journey_sync_records;
select ganaderov_private.track_record(owner_id,'config',owner_id::text,null,config) from public.ranch_animal_configs;
create trigger version_animal after insert or update or delete on public.animal_sync_records for each row execute function ganaderov_private.track_source('animal','animal_id','payload');
create trigger version_journey after insert or update or delete on public.journey_sync_records for each row execute function ganaderov_private.track_source('journey','journey_id','payload');
create trigger version_config after insert or update or delete on public.ranch_animal_configs for each row execute function ganaderov_private.track_source('config','owner_id','config');

create function ganaderov_private.current_entity(o uuid,k text,id text)
returns ganaderov_private.entity_history language sql stable set search_path='' as $$
  select h from ganaderov_private.entity_history h
    where (h.owner_id,h.kind,h.entity_id)=(o,k,id) order by h.revision desc limit 1
$$;
create function ganaderov_private.read_entity(o uuid,k text,id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h ganaderov_private.entity_history;
begin
  if not public.is_ranch_member(o) then raise exception 'Membresía requerida' using errcode='42501'; end if;
  h:=ganaderov_private.current_entity(o,k,id);
  return jsonb_build_object('revision',coalesce(h.revision,0),'data',h.data,'parentId',h.parent_id);
end;
$$;
create function public.sync_read_entity(p_owner uuid,p_kind text,p_id text)
returns jsonb language sql security invoker set search_path='' as $$
  select ganaderov_private.read_entity(p_owner,p_kind,p_id)
$$;

-- The schema literal is identical to contracts/sync/v1/operation.schema.json.
create function ganaderov_private.valid_operation(p jsonb) returns boolean
language sql immutable set search_path='' as $$
  select extensions.jsonb_matches_schema($schema$
{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Ganaderov operation v1","type":"object","additionalProperties":false,"properties":{"protocolVersion":{"const":1},"operationId":{"type":"string","format":"uuid"},"action":{"enum":["animal.create","animal.update","animal.archive","animal.restore","event.create","event.update","event.delete","photo.create","photo.delete","journey.create","journey.attend","journey.finish","journey.resume","config.update"]},"entityId":{"type":"string","minLength":1,"maxLength":200},"ownerId":{"type":"string","format":"uuid"},"deviceId":{"type":"string","format":"uuid"},"baseRevision":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"capturedAt":{"type":"string","format":"date-time"},"changes":{"type":"object"}},"required":["protocolVersion","operationId","action","entityId","ownerId","deviceId","baseRevision","capturedAt","changes"],"allOf":[{"if":{"properties":{"action":{"const":"animal.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"animal.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.archive"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120},"exitReason":{"type":"string","maxLength":120},"exitNotes":{"type":"string","maxLength":2000}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.restore"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review"]},"date":{"type":"string","format":"date"},"weight":{"type":"number","minimum":0,"maximum":100000},"product":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["animalId","type","date"],"allOf":[{"if":{"properties":{"type":{"const":"weight"}}},"then":{"required":["weight"]},"else":{"not":{"required":["weight"]}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"event.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId","weight"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"reason":{"type":"string","minLength":1,"maxLength":2000}},"required":["animalId","reason"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"mime":{"enum":["image/jpeg","image/png","image/webp"]},"name":{"type":"string","maxLength":120},"primary":{"type":"boolean"}},"required":["animalId","mime","name"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"photo.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review"]},"date":{"type":"string","format":"date"},"animalIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}},"product":{"type":"string","maxLength":120},"dose":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["type","date","animalIds"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"journey.attend"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.finish"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"allowIncomplete":{"type":"boolean"}},"required":["allowIncomplete"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.resume"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{},"required":[]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"config.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"config":{"type":"object","minProperties":1}},"required":["config"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}}]}
$schema$::json,p)
$$;

create function ganaderov_private.edit_animal(o uuid,id text,action text,c jsonb,a jsonb,actor jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare fields jsonb:=c->'fields'; result jsonb; key text; val jsonb; options jsonb; parent text;
begin
  if action in ('animal.archive','animal.restore') then
    if public.ganaderov_animal_status_active(o,a->>'status') <> (action='animal.archive')
       or public.ganaderov_animal_status_active(o,c->>'status') <> (action='animal.restore') then
      raise exception 'INVALID_TRANSITION' using errcode='P1001';
    end if;
    fields:=c;
    if action='animal.restore' then a:=a-array['exitReason','exitNotes']; end if;
  elsif a is not null and not public.ganaderov_animal_status_active(o,a->>'status') then
    raise exception 'ANIMAL_INACTIVE' using errcode='P1001';
  end if;
  for key,val in select * from jsonb_each(fields) loop
    if key<>all(array['tag','name','sex','breed','color','cross','markings','officialId','birthDate','birthEstimated','estimatedAge',
      'entryDate','originType','originName','motherId','fatherId','weaningDate','status','lot','paddock','pen','locationSince',
      'responsible','exitReason','exitNotes','generalNotes']) then raise exception 'INVALID_FIELD' using errcode='P1001'; end if;
    if key='birthEstimated' then
      if jsonb_typeof(val)<>'boolean' then raise exception 'INVALID_FIELD' using errcode='P1001'; end if;
    elsif key='estimatedAge' then
      if jsonb_typeof(val) not in ('number','object','null') then raise exception 'INVALID_FIELD' using errcode='P1001'; end if;
    elsif jsonb_typeof(val) not in ('string','null') or length(fields->>key)>4000 then
      raise exception 'INVALID_FIELD' using errcode='P1001';
    end if;
    if key in ('birthDate','entryDate','weaningDate','locationSince') and nullif(fields->>key,'') is not null then
      if fields->>key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'INVALID_DATE' using errcode='P1001'; end if;
      perform (fields->>key)::date;
    end if;
    if key in ('fatherId','motherId') then
      parent:=nullif(fields->>key,'');
      if parent is not null and (parent=id or not exists(select 1 from ganaderov_private.animals_v1 x
        where x.owner_id=o and x.animal_id=parent and x.deleted_at is null)) then raise exception 'INVALID_PARENT' using errcode='P1001'; end if;
    end if;
  end loop;
  result:=coalesce(a,jsonb_build_object('id',id,'status','Activo','createdAt',stamp,'createdBy',actor)) || fields;
  if fields ? 'status' then
    select config->'lists'->'status' into options from public.ranch_animal_configs where owner_id=o;
    if jsonb_typeof(options)='array' and jsonb_array_length(options)>0 then
      if not exists(select 1 from jsonb_array_elements(options) s where s->>'value'=fields->>'status' and s->'enabled'='true') then raise exception 'INVALID_STATUS' using errcode='P1001'; end if;
    elsif coalesce(fields->>'status','') not in ('Activo','Vendido','Fallecido','Desaparecido','Otro','Baja','Otros') then raise exception 'INVALID_STATUS' using errcode='P1001'; end if;
    if action='animal.update' and public.ganaderov_animal_status_active(o,a->>'status') is distinct from public.ganaderov_animal_status_active(o,result->>'status') then
      raise exception 'USE_LIFECYCLE_OPERATION' using errcode='P1001'; end if;
  end if;
  if action='animal.create' and nullif(trim(result->>'tag'),'') is null then raise exception 'TAG_REQUIRED' using errcode='P1001'; end if;
  result:=result||jsonb_build_object('updatedAt',stamp,'updatedBy',actor);
  if action='animal.create' then
    insert into public.animal_sync_records(owner_id,animal_id,payload) values(o,id,jsonb_build_object('animal',result,'events','[]'::jsonb,'photos','[]'::jsonb,'forecasts','[]'::jsonb));
  else
    update public.animal_sync_records set payload=jsonb_set(payload,'{animal}',result) where owner_id=o and animal_id=id and deleted_at is null;
  end if;
end;
$$;

create function ganaderov_private.edit_child(o uuid,id text,action text,c jsonb,row_data jsonb,prior jsonb,actor jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare parent text:=c->>'animalId'; collection text; items jsonb; item jsonb; path text;
begin
  if not public.ganaderov_animal_status_active(o,row_data->'animal'->>'status') then raise exception 'ANIMAL_INACTIVE' using errcode='P1001'; end if;
  if action='event.update' then
    if prior->>'type' is distinct from 'weight' then raise exception 'WEIGHT_EVENT_REQUIRED' using errcode='P1001'; end if;
    item:=prior||jsonb_build_object('weight',c->'weight','weightUpdatedAt',stamp,'weightUpdatedBy',actor);
  end if;
  if action in ('event.update','event.delete') and prior ? 'journeyId' then
    raise exception 'USE_JOURNEY_CORRECTION' using errcode='P1001';
  end if;
  if action='event.delete' and trim(c->>'reason')='' then raise exception 'REASON_REQUIRED' using errcode='P1001'; end if;
  if action='photo.create' then
    if parent ~ '[/\\]' then raise exception 'INVALID_PHOTO_PATH' using errcode='P1001'; end if;
    path:=o::text||'/'||parent||'/'||id;
    perform 1 from storage.objects s where s.bucket_id='animal-photos' and s.name=path
      and s.metadata->>'mimetype'=c->>'mime' and (s.metadata->>'size')::bigint between 1 and 10485760 for share;
    if not found then raise exception 'PHOTO_NOT_AVAILABLE' using errcode='P1001'; end if;
    item:=jsonb_build_object('id',id,'animalId',parent,'name',c->>'name','mime',c->>'mime','storagePath',path,
      'createdAt',stamp,'primary',coalesce((c->>'primary')::boolean,false) or coalesce(jsonb_array_length(row_data->'photos'),0)=0);
  end if;
  collection:=case when action like 'event.%' then 'events' else 'photos' end;
  select coalesce(jsonb_agg(
    case when e->>'id'=id then item
         when action='photo.create' and item->'primary'='true' then e||'{"primary":false}'::jsonb else e end
    order by pos),'[]'::jsonb) into items
    from jsonb_array_elements(row_data->collection) with ordinality src(e,pos)
    where e->>'id'<>id or action='event.update';
  if action='photo.create' then items:=items||jsonb_build_array(item); end if;
  if action='photo.delete' and jsonb_array_length(items)>0 and not exists(select 1 from jsonb_array_elements(items) e where e->'primary'='true') then
    items:=jsonb_set(items,'{0,primary}','true');
  end if;
  update public.animal_sync_records set payload=jsonb_set(payload,array[collection],items) where owner_id=o and animal_id=parent;
end;
$$;

create function ganaderov_private.edit_journey(o uuid,id text,action text,c jsonb,j public.journey_sync_records,actor jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare roster jsonb; item jsonb; pos integer; day date;
begin
  if action='journey.create' then
    day:=(c->>'date')::date;
    if c->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or day not between date '1900-01-01' and current_date+1 then raise exception 'INVALID_DATE' using errcode='P1001'; end if;
    -- Lock in stable order against a concurrent archive or removal.
    perform 1 from public.animal_sync_records a where a.owner_id=o and c->'animalIds' ? a.animal_id order by a.animal_id for share;
    select jsonb_agg(jsonb_build_object('id',a.animal_id,'tag',a.fields->>'tag','name',a.fields->>'name','color',a.fields->>'color',
      'sex',a.fields->>'sex','status',a.fields->>'status','attended',false) order by entry.pos) into roster
      from jsonb_array_elements_text(c->'animalIds') with ordinality entry(animal_id,pos)
      join ganaderov_private.animals_v1 a on a.owner_id=o and a.animal_id=entry.animal_id
      where a.deleted_at is null and public.ganaderov_animal_status_active(o,a.fields->>'status');
    if coalesce(jsonb_array_length(roster),0)<>jsonb_array_length(c->'animalIds') then raise exception 'ANIMAL_NOT_AVAILABLE' using errcode='P1001'; end if;
    insert into public.journey_sync_records(owner_id,journey_id,payload) values(o,id,
      (c-'animalIds')||jsonb_build_object('id',id,'roster',roster,'name',coalesce(c->>'name',''),'status','in_progress',
      'createdAt',stamp,'updatedAt',stamp,'completedAt',null));
    return;
  end if;
  if action='journey.resume' then
    if j.payload->>'status' is distinct from 'incomplete' then raise exception 'INVALID_TRANSITION' using errcode='P1001'; end if;
    perform public.resume_ranch_journey_v1(o,id,j.updated_at);
    return;
  end if;
  if j.payload->>'status' is distinct from 'in_progress' then raise exception 'INVALID_TRANSITION' using errcode='P1001'; end if;
  if action='journey.finish' then
    perform public.finish_ranch_journey_v1(o,id,j.updated_at,(c->>'allowIncomplete')::boolean);
    return;
  end if;
  select e,(idx-1)::integer into item,pos from jsonb_array_elements(j.payload->'roster') with ordinality slot(e,idx) where e->>'id'=c->>'animalId';
  if not found then raise exception 'NOT_IN_ROSTER' using errcode='P1001'; end if;
  perform 1 from public.animal_sync_records a where a.owner_id=o and a.animal_id=c->>'animalId' and a.deleted_at is null
    and public.ganaderov_animal_status_active(o,a.payload->'animal'->>'status') for share;
  if not found then raise exception 'ANIMAL_NOT_AVAILABLE' using errcode='P1001'; end if;
  if (j.payload->>'type'='weight') <> (c ? 'weight') then raise exception 'INVALID_WEIGHT' using errcode='P1001'; end if;
  if item->'attended' is distinct from 'true'::jsonb then item:=item||jsonb_build_object('attended',true,'attendedBy',actor,'attendedAt',stamp); end if;
  if c ? 'weight' then item:=item||jsonb_build_object('weight',c->'weight','weightUpdatedAt',stamp,'weightUpdatedBy',actor); end if;
  update public.journey_sync_records set payload=jsonb_set(payload,array['roster',pos::text],item)||jsonb_build_object('updatedAt',stamp) where owner_id=o and journey_id=id;
end;
$$;

-- Never merge against a client-supplied base. Reuse only independent animal fields
-- or roster entries whose historical values and journey lifecycle still agree.
create function ganaderov_private.can_merge(action text,c jsonb,base jsonb,latest jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if base is null or latest is null then return false; end if;
  if action='animal.update' then
    return base->'status' is not distinct from latest->'status' and not exists(
      select 1 from jsonb_object_keys(c->'fields') key where base->key is distinct from latest->key);
  elsif action='journey.attend' then
    return latest->>'status'='in_progress' and base->>'status'='in_progress'
      and (base - array['roster','updatedAt'])=(latest - array['roster','updatedAt'])
      and (select e from jsonb_array_elements(base->'roster') e where e->>'id'=c->>'animalId')
        = (select e from jsonb_array_elements(latest->'roster') e where e->>'id'=c->>'animalId');
  end if;
  return false;
end;
$$;

create function ganaderov_private.apply_operation(p jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  o uuid; op uuid; uid uuid:=auth.uid(); member public.ranch_members;
  action text:=p->>'action'; kind text:=split_part(action,'.',1); id text:=p->>'entityId'; parent text;
  c jsonb:=p->'changes'; base_rev bigint; h ganaderov_private.entity_history; base jsonb;
  a public.animal_sync_records; j public.journey_sync_records; cfg public.ranch_animal_configs;
  prior ganaderov_private.operation_audit; old_receipt ganaderov_private.event_operation_receipts;
  stamp timestamptz:=clock_timestamp(); captured timestamptz; received text:=to_char(stamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  actor jsonb; result jsonb; before_data jsonb; code text; rev bigint; uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p is null or octet_length(p::text)>524288 or coalesce(p->>'operationId','') !~* uuid_pattern then raise exception 'Invalid envelope' using errcode='22023'; end if;
  op:=(p->>'operationId')::uuid;
  begin
    if coalesce(p->>'ownerId','') !~* uuid_pattern then raise exception 'INVALID_REQUEST' using errcode='P1001'; end if;
    o:=(p->>'ownerId')::uuid;
    select * into member from public.ranch_members where owner_id=o and user_id=uid and status='active' for share;
    if not found then raise exception 'MEMBERSHIP_REQUIRED' using errcode='P1001'; end if;
    perform 1 from public.ranches where owner_id=o for no key update;
    select * into prior from ganaderov_private.operation_audit where owner_id=o and operation_id=op;
    if found then
      if uid<>prior.actor_id or prior.request<>p then raise exception 'OPERATION_ID_REUSED' using errcode='P1002'; end if;
      return prior.receipt||'{"status":"duplicate"}';
    end if;
    select * into old_receipt from ganaderov_private.event_operation_receipts where owner_id=o and operation_id=op;
    if found then
      if uid<>old_receipt.actor_id or old_receipt.request<>p then raise exception 'OPERATION_ID_REUSED' using errcode='P1002'; end if;
      return ganaderov_private.apply_event_create(p);
    end if;
    if not ganaderov_private.valid_operation(p) or coalesce(p->>'deviceId','') !~* uuid_pattern
       or (action like '%.create' and id !~* uuid_pattern)
       or p->>'capturedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'INVALID_REQUEST' using errcode='P1001'; end if;
    captured:=(p->>'capturedAt')::timestamptz;
    if captured not between timestamptz '1900-01-01' and stamp+interval '1 day' then raise exception 'INVALID_DATE' using errcode='P1001'; end if;
    if member.role='worker' and action not in ('event.create','event.update','journey.attend','journey.create') then raise exception 'PERMISSION_DENIED' using errcode='P1001'; end if;
    actor:=jsonb_build_object('authUserId',uid,'email',coalesce(auth.jwt()->>'email',''),'label',member.display_name);
    parent:=case when kind='animal' then id else c->>'animalId' end;
    if kind in ('animal','event','photo') then
      select * into a from public.animal_sync_records where owner_id=o and animal_id=parent for update;
      if action<>'animal.create' and (a.animal_id is null or a.deleted_at is not null) then raise exception 'ANIMAL_NOT_AVAILABLE' using errcode='P1001'; end if;
    elsif kind='journey' then
      select * into j from public.journey_sync_records where owner_id=o and journey_id=id for update;
    elsif kind='config' then
      if id<>o::text then raise exception 'INVALID_SCOPE' using errcode='P1001'; end if;
      select * into cfg from public.ranch_animal_configs where owner_id=o for update;
    end if;
    h:=ganaderov_private.current_entity(o,kind,id);
    before_data:=h.data;
    if action like '%.create' then
      if h.revision is not null or (kind='animal' and a.animal_id is not null) then raise exception 'ENTITY_ID_REUSED' using errcode='P1002'; end if;
    else
      if (kind<>'config' and h.data is null) or (kind in ('event','photo') and h.parent_id is distinct from parent) then raise exception 'ENTITY_NOT_AVAILABLE' using errcode='P1002'; end if;
      base_rev:=(p->>'baseRevision')::bigint;
      if base_rev<>coalesce(h.revision,0) then
        select data into base from ganaderov_private.entity_history where owner_id=o and entity_id=id and entity_history.kind=split_part(action,'.',1) and revision=base_rev;
        if not coalesce(ganaderov_private.can_merge(action,c,base,h.data),false) then raise exception 'REVISION_CONFLICT' using errcode='P1002'; end if;
      end if;
    end if;
    if action='event.create' then
      result:=ganaderov_private.apply_event_create(p);
      if result->>'status'<>'applied' then return result; end if;
    elsif kind='animal' then perform ganaderov_private.edit_animal(o,id,action,c,h.data,actor,received);
    elsif kind in ('event','photo') then perform ganaderov_private.edit_child(o,id,action,c,a.payload,h.data,actor,received);
    elsif kind='journey' then perform ganaderov_private.edit_journey(o,id,action,c,j,actor,received);
    else
      if (c->'config') - array['schemaVersion','configVersion','modules','fields','layout','lists'] <> '{}'::jsonb then raise exception 'INVALID_FIELD' using errcode='P1001'; end if;
      perform public.save_ranch_animal_config(o,coalesce(cfg.revision,0),c->'config');
    end if;
    h:=ganaderov_private.current_entity(o,kind,id);
    if h.revision is null then raise exception 'Missing entity version'; end if;
    result:=coalesce(result,jsonb_build_object('protocolVersion',1,'operationId',op,'status','applied','revision',h.revision,'serverReceivedAt',received,'code','OK'));
    insert into ganaderov_private.operation_audit values(o,op,uid,member.role,p,result,before_data,h.data);
    return result;
  exception
    when sqlstate 'P1001' or sqlstate 'P1002' then
      code:=sqlerrm;
      return jsonb_build_object('protocolVersion',1,'operationId',op,'serverReceivedAt',received,'status',case sqlstate when 'P1002' then 'conflict' else 'rejected' end,'revision',null,'code',code);
    when data_exception or check_violation or insufficient_privilege then code:='INVALID_REQUEST';
    when unique_violation then code:='ENTITY_ID_REUSED';
  end;
  return jsonb_build_object('protocolVersion',1,'operationId',op,'serverReceivedAt',received,'status',case code when 'ENTITY_ID_REUSED' then 'conflict' else 'rejected' end,'revision',null,'code',code);
end;
$$;
create or replace function public.sync_apply_operation(p_operation jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select ganaderov_private.apply_operation(p_operation) $$;

-- Do not expose the former single-action sender alongside the universal receipt namespace.
revoke execute on function ganaderov_private.apply_event_create(jsonb) from authenticated;
revoke all on function ganaderov_private.track_version(uuid,text,text,text,jsonb),
  ganaderov_private.track_record(uuid,text,text,jsonb,jsonb),ganaderov_private.track_source(),
  ganaderov_private.current_entity(uuid,text,text),ganaderov_private.valid_operation(jsonb),
  ganaderov_private.edit_animal(uuid,text,text,jsonb,jsonb,jsonb,text),
  ganaderov_private.edit_child(uuid,text,text,jsonb,jsonb,jsonb,jsonb,text),
  ganaderov_private.edit_journey(uuid,text,text,jsonb,public.journey_sync_records,jsonb,text),
  ganaderov_private.can_merge(text,jsonb,jsonb,jsonb),ganaderov_private.apply_operation(jsonb),
  ganaderov_private.read_entity(uuid,text,text),public.sync_read_entity(uuid,text,text) from public,anon,authenticated;
grant execute on function ganaderov_private.apply_operation(jsonb),ganaderov_private.read_entity(uuid,text,text),
  public.sync_read_entity(uuid,text,text) to authenticated;
commit;
