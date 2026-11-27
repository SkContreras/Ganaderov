-- CLI: supabase migration new universal_completion_v1 (2.121.0).
-- Append after D4; previously published candidates remain byte-for-byte unchanged.
begin;
create table ganaderov_private.animal_internal_id_counters (
 owner_id uuid primary key references public.ranches(owner_id) on delete cascade,
 last_number bigint not null check(last_number between 0 and 9007199254740991)
);
alter table ganaderov_private.animal_internal_id_counters enable row level security;
revoke all on ganaderov_private.animal_internal_id_counters from public,anon,authenticated;

create function ganaderov_private.allocate_animal_internal_id(o uuid) returns text
language plpgsql set search_path='' as $$
declare current_max bigint; historic_max bigint; assigned bigint;
begin
 -- apply_operation already holds the ranch lock; keep this helper safe in isolation.
 perform 1 from public.ranches where owner_id=o for no key update;
 select coalesce(max(substring(payload->'animal'->>'internalId' from 5)::bigint),0)
 into current_max from public.animal_sync_records
 where owner_id=o and payload->'animal'->>'internalId' ~ '^ANM-[0-9]{1,15}$';
 if not exists(select 1 from ganaderov_private.animal_internal_id_counters where owner_id=o) then
  select coalesce(max(substring(data->>'internalId' from 5)::bigint),0) into historic_max
   from ganaderov_private.entity_history where owner_id=o and kind='animal'
   and data->>'internalId' ~ '^ANM-[0-9]{1,15}$';
  insert into ganaderov_private.animal_internal_id_counters values(o,greatest(current_max,historic_max))
   on conflict(owner_id) do nothing;
 end if;
 update ganaderov_private.animal_internal_id_counters
 set last_number=greatest(last_number,current_max)+1 where owner_id=o returning last_number into assigned;
 return 'ANM-'||lpad(assigned::text,greatest(5,length(assigned::text)),'0');
end;
$$;
revoke all on function ganaderov_private.allocate_animal_internal_id(uuid) from public,anon,authenticated;

create or replace function ganaderov_private.valid_operation(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select extensions.jsonb_matches_schema($schema$
{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Ganaderov operation v1","type":"object","additionalProperties":false,"properties":{"protocolVersion":{"const":1},"operationId":{"type":"string","format":"uuid"},"action":{"enum":["animal.create","animal.update","animal.archive","animal.restore","event.create","event.update","event.delete","photo.create","photo.delete","journey.create","journey.attend","journey.finish","journey.resume","config.update","forecast.create","forecast.delete","animal.target.update","journey.add_animals","photo.crop","photo.primary"]},"entityId":{"type":"string","minLength":1,"maxLength":200},"ownerId":{"type":"string","format":"uuid"},"deviceId":{"type":"string","format":"uuid"},"baseRevision":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"capturedAt":{"type":"string","format":"date-time"},"changes":{"type":"object"}},"required":["protocolVersion","operationId","action","entityId","ownerId","deviceId","baseRevision","capturedAt","changes"],"allOf":[{"if":{"properties":{"action":{"const":"animal.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"animal.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.archive"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120},"exitReason":{"type":"string","maxLength":120},"exitNotes":{"type":"string","maxLength":2000}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.restore"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review","note","other"]},"date":{"type":"string","format":"date"},"weight":{"type":"number","minimum":0,"maximum":100000},"product":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["animalId","type","date"],"allOf":[{"if":{"properties":{"type":{"const":"weight"}}},"then":{"required":["weight"]},"else":{"not":{"required":["weight"]}}},{"if":{"properties":{"type":{"const":"note"}}},"then":{"required":["notes"],"properties":{"notes":{"minLength":1}}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"event.update"}},"required":["action"]},"then":{"properties":{"changes":{"anyOf":[{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId","weight"]},{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000},"date":{"type":"string","format":"date"},"product":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000},"reason":{"type":"string","minLength":1,"maxLength":2000}},"required":["animalId","reason"],"anyOf":[{"required":["date"]},{"required":["product"]},{"required":["notes"]},{"required":["weight"]}]}]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"reason":{"type":"string","minLength":1,"maxLength":2000}},"required":["animalId","reason"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"mime":{"enum":["image/jpeg","image/png","image/webp"]},"name":{"type":"string","maxLength":120},"primary":{"type":"boolean"}},"required":["animalId","mime","name"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"photo.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review","other"]},"date":{"type":"string","format":"date"},"animalIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}},"product":{"type":"string","maxLength":120},"dose":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000},"name":{"type":"string","maxLength":120}},"required":["type","date","animalIds"],"allOf":[{"if":{"properties":{"type":{"const":"other"}}},"then":{"required":["name"],"properties":{"name":{"minLength":1}}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"journey.attend"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.finish"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"allowIncomplete":{"type":"boolean"}},"required":["allowIncomplete"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.resume"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{},"required":[]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"config.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"config":{"type":"object","minProperties":1}},"required":["config"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"forecast.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"baselineWeight":{"type":"number","minimum":0,"maximum":100000},"baselineDate":{"type":"string","format":"date"},"gainKgPerDay":{"type":"number","minimum":-100,"maximum":100},"days":{"type":"integer","minimum":1,"maximum":3650}},"required":["animalId","baselineWeight","baselineDate","gainKgPerDay","days"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"forecast.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.target.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"minimum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]},"maximum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]}},"required":["minimum","maximum"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.add_animals"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"required":["animalIds"],"properties":{"animalIds":{"type":"array","minItems":1,"maxItems":1000,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}}}},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.crop"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"cropX":{"type":"number","minimum":0,"maximum":100},"cropY":{"type":"number","minimum":0,"maximum":100},"cropZoom":{"type":"number","minimum":1,"maximum":3}},"required":["animalId","cropX","cropY","cropZoom"]},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.primary"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"previousPrimaryId":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]}},"required":["animalId","previousPrimaryId"]},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}}]}
$schema$::json,p)
$$;

create or replace function ganaderov_private.edit_animal(o uuid,id text,action text,c jsonb,a jsonb,actor jsonb,stamp text)
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
    result:=result||jsonb_build_object('internalId',ganaderov_private.allocate_animal_internal_id(o));
    insert into public.animal_sync_records(owner_id,animal_id,payload) values(o,id,jsonb_build_object('animal',result,'events','[]'::jsonb,'photos','[]'::jsonb,'forecasts','[]'::jsonb));
  else
    update public.animal_sync_records set payload=jsonb_set(payload,'{animal}',result) where owner_id=o and animal_id=id and deleted_at is null;
  end if;
end;
$$;

create or replace function ganaderov_private.apply_event_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  owner uuid;
  op uuid;
  entity uuid;
  device uuid;
  actor jsonb;
  member public.ranch_members%rowtype;
  a public.animal_sync_records%rowtype;
  prior ganaderov_private.event_operation_receipts%rowtype;
  changes jsonb;
  typ text;
  event_date date;
  captured timestamptz;
  received timestamptz := clock_timestamp();
  ev jsonb;
  canonical jsonb;
  revision bigint := 1;
  v_animal_id text;
  status text := 'rejected';
  code text := 'INVALID_REQUEST';
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>16384 then
    raise exception 'Invalid operation envelope' using errcode='22023';
  end if;
  -- Validate identifiers before casting, and reject extra or missing fields.
  if coalesce(p->>'operationId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid operationId' using errcode='22023';
  end if;
  op := (p->>'operationId')::uuid;
  <<validate_and_apply>>
  begin
    if not (p ?& array['protocolVersion','operationId','action','entityId','ownerId','deviceId','baseRevision','capturedAt','changes'])
      or (p - array['protocolVersion','operationId','action','entityId','ownerId','deviceId','baseRevision','capturedAt','changes']) <> '{}'::jsonb
      or p->'protocolVersion' is distinct from '1'::jsonb
      or p->>'action' is distinct from 'event.create'
      or p->'baseRevision' is distinct from 'null'::jsonb
      or jsonb_typeof(p->'changes') is distinct from 'object' then exit validate_and_apply; end if;
    if exists(select 1 from unnest(array['operationId','ownerId','deviceId','entityId','capturedAt','action']) k where jsonb_typeof(p->k) is distinct from 'string') then exit validate_and_apply; end if;
    if coalesce(p->>'ownerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p->>'deviceId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p->>'entityId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then exit validate_and_apply; end if;
    owner := (p->>'ownerId')::uuid;
    entity := (p->>'entityId')::uuid;
    device := (p->>'deviceId')::uuid;
    -- Serialize against membership revocation; no caller-supplied actor.
    select * into member from public.ranch_members m
      where m.owner_id=owner and m.user_id=uid and m.status='active' and m.role in ('owner','admin','worker') for share;
    if not found then code:='MEMBERSHIP_REQUIRED'; exit validate_and_apply; end if;
    canonical := p || jsonb_build_object('operationId',op::text,'ownerId',owner::text,'entityId',entity::text,'deviceId',device::text);
    -- Serialize receipt lookup even if the same operation targets different animals.
    perform pg_advisory_xact_lock(hashtextextended(owner::text||':'||op::text,0));
    select * into prior from ganaderov_private.event_operation_receipts x where x.owner_id=owner and x.operation_id=op;
    if found then
      if prior.actor_id=uid and prior.request=canonical then
        status:='duplicate'; code:='OK'; revision:=prior.revision; received:=prior.received_at;
      else status:='conflict'; code:='OPERATION_ID_REUSED'; end if;
      exit validate_and_apply;
    end if;
    changes := p->'changes';
    if not (changes ?& array['animalId','type','date'])
      or (changes - array['animalId','type','date','weight','product','notes']) <> '{}'::jsonb
      or exists(select 1 from unnest(array['animalId','type','date']) k where jsonb_typeof(changes->k) is distinct from 'string')
      or (changes ? 'product' and jsonb_typeof(changes->'product') is distinct from 'string')
      or (changes ? 'notes' and jsonb_typeof(changes->'notes') is distinct from 'string') then exit validate_and_apply; end if;
    v_animal_id:=changes->>'animalId'; typ:=changes->>'type';
    if length(v_animal_id) not between 1 and 200 or typ not in ('weight','bath','vaccine','deworm','injection','medication','review','note','other')
      or length(coalesce(changes->>'product',''))>120 or length(coalesce(changes->>'notes',''))>2000 then exit validate_and_apply; end if;
    if typ in ('note','other') and member.role not in ('owner','admin') then code:='PERMISSION_DENIED'; exit validate_and_apply; end if;
    if typ='note' and trim(coalesce(changes->>'notes',''))='' then code:='NOTE_REQUIRED'; exit validate_and_apply; end if;
    if typ='weight' then
      if jsonb_typeof(changes->'weight') is distinct from 'number' then exit validate_and_apply; end if;
      if (changes->>'weight')::numeric not between 0 and 100000 then exit validate_and_apply; end if;
    elsif changes ? 'weight' then exit validate_and_apply; end if;
    if coalesce(changes->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(p->>'capturedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then exit validate_and_apply; end if;
    begin
      event_date := (changes->>'date')::date;
      captured := (p->>'capturedAt')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then exit validate_and_apply;
    end;
    -- No device-clock last-write-wins. Civil date may differ by timezone.
    if event_date < date '1900-01-01' or event_date > (received at time zone 'UTC')::date+1
      or captured > received+interval '1 day' or captured < timestamptz '1900-01-01 00:00:00+00' then exit validate_and_apply; end if;
    -- Serialize entity identity across separate operation IDs.
    perform pg_advisory_xact_lock(hashtextextended(owner::text||':event:'||entity::text,0));
    if exists(select 1 from ganaderov_private.event_operation_receipts x where x.owner_id=owner and x.entity_id=entity::text) then
      status:='conflict'; code:='ENTITY_ID_REUSED'; exit validate_and_apply;
    end if;
    select * into a from public.animal_sync_records x where x.owner_id=owner and x.animal_id=v_animal_id for update;
    if not found or a.deleted_at is not null then code:='ANIMAL_NOT_AVAILABLE'; exit validate_and_apply; end if;
    if a.payload->'animal'->>'id' is distinct from v_animal_id or jsonb_typeof(a.payload->'events') is distinct from 'array' then
      code:='INVALID_ANIMAL_RECORD'; exit validate_and_apply;
    end if;
    if not public.ganaderov_animal_status_active(owner,a.payload->'animal'->>'status') then code:='ANIMAL_INACTIVE'; exit validate_and_apply; end if;
    -- Legacy clients can still introduce IDs directly; check across the ranch.
    if exists(select 1 from public.animal_sync_records x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.payload->'events')='array' then x.payload->'events' else '[]'::jsonb end) e where x.owner_id=owner and e->>'id'=entity::text) then
      status:='conflict'; code:='ENTITY_ID_REUSED'; exit validate_and_apply;
    end if;
    actor:=jsonb_build_object('authUserId',uid::text,'email',coalesce(auth.jwt()->>'email',''),'label',member.display_name);
    ev:=jsonb_build_object('id',entity::text,'animalId',v_animal_id,'type',typ,'date',event_date::text,
      'createdAt',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'performedAt',to_char(captured at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'performedBy',actor);
    if typ='weight' then ev:=ev||jsonb_build_object('weight',changes->'weight'); end if;
    if length(trim(coalesce(changes->>'product','')))>0 then ev:=ev||jsonb_build_object('label',trim(changes->>'product')); end if;
    if length(trim(coalesce(changes->>'notes','')))>0 then ev:=ev||jsonb_build_object('notes',trim(changes->>'notes')); end if;
    -- Existing triggers still validate worker changes using auth.uid().
    update public.animal_sync_records x set payload=jsonb_set(x.payload,'{events}',(x.payload->'events')||jsonb_build_array(ev))
      where x.owner_id=owner and x.animal_id=v_animal_id and x.deleted_at is null;
    if not found then raise exception 'Concurrent animal change' using errcode='40001'; end if;
    insert into ganaderov_private.event_operation_receipts(owner_id,operation_id,actor_id,entity_id,request,applied_event,actor_role,animal_id,received_at,revision)
      values(owner,op,uid,entity::text,canonical,ev,member.role,v_animal_id,received,revision);
    status:='applied'; code:='OK';
  end validate_and_apply;
  return jsonb_build_object('protocolVersion',1,'operationId',op::text,'status',status,'serverReceivedAt',
    to_char(received at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'revision',case when status in ('applied','duplicate') then revision else null end,'code',code);
end;
$fn$;

create or replace function ganaderov_private.edit_child(o uuid,id text,action text,c jsonb,row_data jsonb,prior jsonb,actor jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare parent text:=c->>'animalId'; collection text; items jsonb; item jsonb; path text;
begin
  if not public.ganaderov_animal_status_active(o,row_data->'animal'->>'status') then raise exception 'ANIMAL_INACTIVE' using errcode='P1001'; end if;
  if action in ('event.update','event.delete') and prior ? 'journeyId' then
    raise exception 'USE_JOURNEY_CORRECTION' using errcode='P1001';
  end if;
  if action='event.update' then
    if c-array['animalId','weight']='{}'::jsonb and c ? 'weight' then
      -- Exact legacy envelope remains immutable and keeps its original worker policy.
      if prior->>'type' is distinct from 'weight' then raise exception 'WEIGHT_EVENT_REQUIRED' using errcode='P1001'; end if;
      item:=prior||jsonb_build_object('weight',c->'weight','weightUpdatedAt',stamp,'weightUpdatedBy',actor);
    else
    if not public.is_ranch_admin(o) then raise exception 'PERMISSION_DENIED' using errcode='P1001'; end if;
    if trim(coalesce(c->>'reason',''))='' then raise exception 'REASON_REQUIRED' using errcode='P1001'; end if;
    if not (c ?| array['date','product','notes','weight']) then raise exception 'NO_CHANGES' using errcode='P1001'; end if;
    item:=prior;
    if c ? 'date' then
      if c->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (c->>'date')::date not between date '1900-01-01' and current_date+1 then
        raise exception 'INVALID_DATE' using errcode='P1001';
      end if;
      item:=jsonb_set(item,'{date}',c->'date');
    end if;
    if c ? 'weight' then
      if prior->>'type' is distinct from 'weight' then raise exception 'WEIGHT_EVENT_REQUIRED' using errcode='P1001'; end if;
      item:=jsonb_set(item,'{weight}',c->'weight');
    end if;
    if c ? 'product' then
      if trim(c->>'product')='' then item:=item-'label'; else item:=jsonb_set(item,'{label}',to_jsonb(trim(c->>'product'))); end if;
    end if;
    if c ? 'notes' then
      if trim(c->>'notes')='' then item:=item-'notes'; else item:=jsonb_set(item,'{notes}',to_jsonb(trim(c->>'notes'))); end if;
    end if;
    if prior->>'type'='note' and trim(coalesce(item->>'notes',''))='' then raise exception 'NOTE_REQUIRED' using errcode='P1001'; end if;
    if item=prior then raise exception 'NO_CHANGES' using errcode='P1001'; end if;
    item:=item||jsonb_build_object('updatedAt',stamp,'updatedBy',actor,'updateReason',trim(c->>'reason'));
    if c ? 'weight' then item:=item||jsonb_build_object('weightUpdatedAt',stamp,'weightUpdatedBy',actor); end if;
    end if;
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


-- Keep the immutable legacy request intact while recording why an older capture
-- lacks the reason now required by the extended editor.
alter table ganaderov_private.operation_audit add column reason text;
create function ganaderov_private.record_operation_reason() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.request->>'action' in ('event.update','event.delete') then
  new.reason:=coalesce(nullif(trim(new.request->'changes'->>'reason'),''),'Legacy v1 weight correction; original capture had no reason field');
 end if;
 return new;
end;
$$;
revoke all on function ganaderov_private.record_operation_reason() from public,anon,authenticated;
create trigger operation_audit_reason before insert on ganaderov_private.operation_audit
 for each row execute function ganaderov_private.record_operation_reason();

-- Bounded authenticated revision prefetch. Every value is canonical entity history,
-- never a feed cursor. Clients must compare data to their local snapshot.
create function ganaderov_private.read_entities(o uuid, targets jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:='[]'; target jsonb; h ganaderov_private.entity_history; k text; id text;
begin
 if auth.uid() is null or not public.is_ranch_member(o) then raise exception 'Membresía requerida' using errcode='42501'; end if;
 if jsonb_typeof(targets) is distinct from 'array' or jsonb_array_length(targets)>100 then raise exception 'INVALID_TARGETS' using errcode='22023'; end if;
 for target in select value from jsonb_array_elements(targets) loop
  if jsonb_typeof(target) is distinct from 'object' or target-array['kind','id']<>'{}'::jsonb
    or jsonb_typeof(target->'kind') is distinct from 'string' or jsonb_typeof(target->'id') is distinct from 'string' then
    raise exception 'INVALID_TARGETS' using errcode='22023';
  end if;
  k:=target->>'kind'; id:=target->>'id';
  if k<>all(array['animal','event','photo','forecast','journey','config']) or length(id) not between 1 and 200 then raise exception 'INVALID_TARGETS' using errcode='22023'; end if;
  if k='config' and id<>o::text then raise exception 'INVALID_SCOPE' using errcode='42501'; end if;
  h:=ganaderov_private.current_entity(o,k,id);
  result:=result||jsonb_build_array(jsonb_build_object('kind',k,'id',id,'revision',coalesce(h.revision,0),'data',h.data,'parentId',h.parent_id));
 end loop;
 return result;
end;
$$;
revoke all on function ganaderov_private.read_entities(uuid,jsonb) from public,anon,authenticated;
grant execute on function ganaderov_private.read_entities(uuid,jsonb) to authenticated;
create function public.sync_read_entities(p_owner uuid,p_entities jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select ganaderov_private.read_entities(p_owner,p_entities) $$;
revoke all on function public.sync_read_entities(uuid,jsonb) from public,anon;
grant execute on function public.sync_read_entities(uuid,jsonb) to authenticated;
commit;
