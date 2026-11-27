-- Additive migration after universal_operations_v1. Do not edit deployed migrations.
begin;
lock table public.animal_sync_records in share row exclusive mode;
create or replace function ganaderov_private.track_record(o uuid,k text,id text,prev jsonb,body jsonb)
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
  foreach collection in array array['events','photos','forecasts'] loop
    for child in
      select coalesce(n.item->>'id',p.item->>'id') as id,n.item
      from jsonb_array_elements(prev->collection) p(item)
      full join jsonb_array_elements(body->collection) n(item) on p.item->>'id'=n.item->>'id'
      where p.item is distinct from n.item
    loop
      perform ganaderov_private.track_version(o,case collection when 'events' then 'event' when 'photos' then 'photo' else 'forecast' end,
        child.id,id,child.item);
    end loop;
  end loop;
end;
$$;
select ganaderov_private.track_version(a.owner_id,'forecast',f->>'id',a.animal_id,f)
from public.animal_sync_records a cross join lateral jsonb_array_elements(coalesce(a.payload->'forecasts','[]'::jsonb)) f
where a.deleted_at is null;
create or replace function ganaderov_private.valid_operation(p jsonb) returns boolean
language sql immutable set search_path='' as $$
  select extensions.jsonb_matches_schema($schema$
{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Ganaderov operation v1","type":"object","additionalProperties":false,"properties":{"protocolVersion":{"const":1},"operationId":{"type":"string","format":"uuid"},"action":{"enum":["animal.create","animal.update","animal.archive","animal.restore","event.create","event.update","event.delete","photo.create","photo.delete","journey.create","journey.attend","journey.finish","journey.resume","config.update","forecast.create","forecast.delete","animal.target.update"]},"entityId":{"type":"string","minLength":1,"maxLength":200},"ownerId":{"type":"string","format":"uuid"},"deviceId":{"type":"string","format":"uuid"},"baseRevision":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"capturedAt":{"type":"string","format":"date-time"},"changes":{"type":"object"}},"required":["protocolVersion","operationId","action","entityId","ownerId","deviceId","baseRevision","capturedAt","changes"],"allOf":[{"if":{"properties":{"action":{"const":"animal.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"animal.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.archive"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120},"exitReason":{"type":"string","maxLength":120},"exitNotes":{"type":"string","maxLength":2000}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.restore"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review"]},"date":{"type":"string","format":"date"},"weight":{"type":"number","minimum":0,"maximum":100000},"product":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["animalId","type","date"],"allOf":[{"if":{"properties":{"type":{"const":"weight"}}},"then":{"required":["weight"]},"else":{"not":{"required":["weight"]}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"event.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId","weight"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"reason":{"type":"string","minLength":1,"maxLength":2000}},"required":["animalId","reason"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"mime":{"enum":["image/jpeg","image/png","image/webp"]},"name":{"type":"string","maxLength":120},"primary":{"type":"boolean"}},"required":["animalId","mime","name"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"photo.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review"]},"date":{"type":"string","format":"date"},"animalIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}},"product":{"type":"string","maxLength":120},"dose":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["type","date","animalIds"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"journey.attend"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.finish"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"allowIncomplete":{"type":"boolean"}},"required":["allowIncomplete"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.resume"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{},"required":[]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"config.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"config":{"type":"object","minProperties":1}},"required":["config"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"forecast.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"baselineWeight":{"type":"number","minimum":0,"maximum":100000},"baselineDate":{"type":"string","format":"date"},"gainKgPerDay":{"type":"number","minimum":-100,"maximum":100},"days":{"type":"integer","minimum":1,"maximum":3650}},"required":["animalId","baselineWeight","baselineDate","gainKgPerDay","days"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"forecast.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.target.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"minimum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]},"maximum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]}},"required":["minimum","maximum"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}}]}
$schema$::json,p)
$$;
create function ganaderov_private.edit_target(o uuid,id text,c jsonb,a jsonb,actor jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare lo numeric:=(c->>'minimum')::numeric; hi numeric:=(c->>'maximum')::numeric;
begin
 if (lo is null)<>(hi is null) or lo>hi or not public.ganaderov_animal_status_active(o,a->>'status') then raise exception 'INVALID_TARGET' using errcode='P1001'; end if;
 a:=a-array['targetWeightMin','targetWeightMax'];
 if lo is not null then a:=a||jsonb_build_object('targetWeightMin',lo,'targetWeightMax',hi); end if;
 a:=a||jsonb_build_object('updatedAt',stamp,'updatedBy',actor);
 update public.animal_sync_records set payload=jsonb_set(payload,'{animal}',a) where owner_id=o and animal_id=id;
end;
$$;
create function ganaderov_private.edit_forecast(o uuid,id text,action text,c jsonb,body jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare parent text:=c->>'animalId'; items jsonb:=coalesce(body->'forecasts','[]'::jsonb); day date; span integer; predicted numeric;
begin
 if action='forecast.create' then
  if not public.ganaderov_animal_status_active(o,body->'animal'->>'status') then raise exception 'ANIMAL_INACTIVE' using errcode='P1001'; end if;
  day:=(c->>'baselineDate')::date;span:=(c->>'days')::integer;
  predicted:=(c->>'baselineWeight')::numeric+(c->>'gainKgPerDay')::numeric*span;
  if day<date '1900-01-01' or day>current_date or predicted<0 or predicted>100000 then raise exception 'INVALID_FORECAST' using errcode='P1001'; end if;
  items:=items||jsonb_build_array(c||jsonb_build_object('id',id,'status','pending','method','linear-gmd','source','manual-gmd','createdAt',stamp,'targetDate',to_char(day+span,'YYYY-MM-DD'),'predictedWeight',predicted,'sourceWeightEventIds','[]'::jsonb));
 else
  select coalesce(jsonb_agg(f order by pos),'[]'::jsonb) into items from jsonb_array_elements(items) with ordinality t(f,pos) where f->>'id'<>id;
 end if;
 update public.animal_sync_records set payload=jsonb_set(payload,'{forecasts}',items) where owner_id=o and animal_id=parent;
end;
$$;
-- Run AFTER worker validation: the worker may change events only. Server-derived
-- forecast fields are assigned later in the same BEFORE trigger chain.
create function ganaderov_private.evaluate_forecasts() returns trigger language plpgsql set search_path='' as $$
declare f jsonb; e jsonb; items jsonb:='[]'::jsonb; actual numeric; predicted numeric; err numeric;
begin
 if new.deleted_at is not null or jsonb_typeof(new.payload->'forecasts') is distinct from 'array' or jsonb_typeof(new.payload->'events') is distinct from 'array' then return new; end if;
 for f in select value from jsonb_array_elements(new.payload->'forecasts') loop
  if f->>'status'='pending' and f->>'animalId'=new.animal_id and jsonb_typeof(f->'predictedWeight')='number' and coalesce(f->>'targetDate','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and coalesce(f->>'createdAt','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
   begin
    select value into e from jsonb_array_elements(new.payload->'events')
    where value->>'type'='weight' and value->>'animalId'=new.animal_id and jsonb_typeof(value->'weight')='number'
      and (value->>'weight')::numeric between 0 and 100000 and coalesce(value->>'date','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (value->>'date')::date >= (f->>'targetDate')::date and (value->>'createdAt')::timestamptz >= (f->>'createdAt')::timestamptz
    order by (value->>'date')::date,(value->>'createdAt')::timestamptz,value->>'id' limit 1;
    if e is not null then
     actual:=(e->>'weight')::numeric;predicted:=(f->>'predictedWeight')::numeric;err:=actual-predicted;
     if predicted between 0 and 100000 then f:=f||jsonb_build_object('status','evaluated','actualDate',e->>'date','actualWeight',actual,'actualEventId',e->>'id','errorKg',err,'absoluteErrorKg',abs(err),'absoluteErrorPercent',case when predicted=0 then null else abs(err)/predicted*100 end,'evaluatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));end if;
    end if;
   exception when data_exception then null;
   end;
  end if;
  items:=items||jsonb_build_array(f);
 end loop;
 new.payload:=jsonb_set(new.payload,'{forecasts}',items);
 return new;
end;
$$;
create trigger zz_evaluate_forecasts before insert or update on public.animal_sync_records for each row execute function ganaderov_private.evaluate_forecasts();
create or replace function ganaderov_private.apply_operation(p jsonb)
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
    if kind in ('animal','event','photo','forecast') then
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
      if (kind<>'config' and h.data is null) or (kind in ('event','photo','forecast') and h.parent_id is distinct from parent) then raise exception 'ENTITY_NOT_AVAILABLE' using errcode='P1002'; end if;
      base_rev:=(p->>'baseRevision')::bigint;
      if base_rev<>coalesce(h.revision,0) then
        select data into base from ganaderov_private.entity_history where owner_id=o and entity_id=id and entity_history.kind=split_part(action,'.',1) and revision=base_rev;
        if not coalesce(ganaderov_private.can_merge(action,c,base,h.data),false) then raise exception 'REVISION_CONFLICT' using errcode='P1002'; end if;
      end if;
    end if;
    if action='event.create' then
      result:=ganaderov_private.apply_event_create(p);
      if result->>'status'<>'applied' then return result; end if;
    elsif action='animal.target.update' then perform ganaderov_private.edit_target(o,id,c,h.data,actor,received);
    elsif kind='forecast' then perform ganaderov_private.edit_forecast(o,id,action,c,a.payload,received);
    elsif kind='animal' then perform ganaderov_private.edit_animal(o,id,action,c,h.data,actor,received);
    elsif kind in ('event','photo','forecast') then perform ganaderov_private.edit_child(o,id,action,c,a.payload,h.data,actor,received);
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
revoke all on function ganaderov_private.edit_target(uuid,text,jsonb,jsonb,jsonb,text),ganaderov_private.edit_forecast(uuid,text,text,jsonb,jsonb,text),ganaderov_private.evaluate_forecasts() from public,anon,authenticated;
commit;
