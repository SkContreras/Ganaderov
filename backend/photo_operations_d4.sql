begin;
create or replace function ganaderov_private.valid_operation(p jsonb) returns boolean
language sql immutable set search_path='' as $$
  select extensions.jsonb_matches_schema($schema$
{"$schema":"https://json-schema.org/draft/2020-12/schema","title":"Ganaderov operation v1","type":"object","additionalProperties":false,"properties":{"protocolVersion":{"const":1},"operationId":{"type":"string","format":"uuid"},"action":{"enum":["animal.create","animal.update","animal.archive","animal.restore","event.create","event.update","event.delete","photo.create","photo.delete","journey.create","journey.attend","journey.finish","journey.resume","config.update","forecast.create","forecast.delete","animal.target.update","journey.add_animals","photo.crop","photo.primary"]},"entityId":{"type":"string","minLength":1,"maxLength":200},"ownerId":{"type":"string","format":"uuid"},"deviceId":{"type":"string","format":"uuid"},"baseRevision":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"capturedAt":{"type":"string","format":"date-time"},"changes":{"type":"object"}},"required":["protocolVersion","operationId","action","entityId","ownerId","deviceId","baseRevision","capturedAt","changes"],"allOf":[{"if":{"properties":{"action":{"const":"animal.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"animal.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"fields":{"type":"object","minProperties":1}},"required":["fields"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.archive"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120},"exitReason":{"type":"string","maxLength":120},"exitNotes":{"type":"string","maxLength":2000}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.restore"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"status":{"type":"string","maxLength":120}},"required":["status"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review"]},"date":{"type":"string","format":"date"},"weight":{"type":"number","minimum":0,"maximum":100000},"product":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000}},"required":["animalId","type","date"],"allOf":[{"if":{"properties":{"type":{"const":"weight"}}},"then":{"required":["weight"]},"else":{"not":{"required":["weight"]}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"event.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId","weight"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"event.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"reason":{"type":"string","minLength":1,"maxLength":2000}},"required":["animalId","reason"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"mime":{"enum":["image/jpeg","image/png","image/webp"]},"name":{"type":"string","maxLength":120},"primary":{"type":"boolean"}},"required":["animalId","mime","name"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"photo.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"type":{"enum":["weight","bath","vaccine","deworm","injection","medication","review","other"]},"date":{"type":"string","format":"date"},"animalIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}},"product":{"type":"string","maxLength":120},"dose":{"type":"string","maxLength":120},"notes":{"type":"string","maxLength":2000},"name":{"type":"string","maxLength":120}},"required":["type","date","animalIds"],"allOf":[{"if":{"properties":{"type":{"const":"other"}}},"then":{"required":["name"],"properties":{"name":{"minLength":1}}}}]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"journey.attend"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"weight":{"type":"number","minimum":0,"maximum":100000}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.finish"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"allowIncomplete":{"type":"boolean"}},"required":["allowIncomplete"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.resume"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{},"required":[]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"config.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"config":{"type":"object","minProperties":1}},"required":["config"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"forecast.create"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"baselineWeight":{"type":"number","minimum":0,"maximum":100000},"baselineDate":{"type":"string","format":"date"},"gainKgPerDay":{"type":"number","minimum":-100,"maximum":100},"days":{"type":"integer","minimum":1,"maximum":3650}},"required":["animalId","baselineWeight","baselineDate","gainKgPerDay","days"]},"baseRevision":{"type":"null"},"entityId":{"type":"string","format":"uuid"}}}},{"if":{"properties":{"action":{"const":"forecast.delete"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200}},"required":["animalId"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"animal.target.update"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"minimum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]},"maximum":{"anyOf":[{"type":"number","minimum":0,"maximum":100000},{"type":"null"}]}},"required":["minimum","maximum"]},"baseRevision":{"type":"integer","minimum":0,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"journey.add_animals"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"required":["animalIds"],"properties":{"animalIds":{"type":"array","minItems":1,"maxItems":1000,"uniqueItems":true,"items":{"type":"string","minLength":1,"maxLength":200}}}},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.crop"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"cropX":{"type":"number","minimum":0,"maximum":100},"cropY":{"type":"number","minimum":0,"maximum":100},"cropZoom":{"type":"number","minimum":1,"maximum":3}},"required":["animalId","cropX","cropY","cropZoom"]},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}},{"if":{"properties":{"action":{"const":"photo.primary"}},"required":["action"]},"then":{"properties":{"changes":{"type":"object","additionalProperties":false,"properties":{"animalId":{"type":"string","minLength":1,"maxLength":200},"previousPrimaryId":{"anyOf":[{"type":"string","minLength":1,"maxLength":200},{"type":"null"}]}},"required":["animalId","previousPrimaryId"]},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}}}}]}
$schema$::json,p)
$$;
create function ganaderov_private.edit_photo_presentation(o uuid,id text,action text,c jsonb,body jsonb,stamp text)
returns void language plpgsql set search_path='' as $$
declare parent text:=c->>'animalId'; items jsonb; primary_id text; primary_count integer;
begin
 if not public.ganaderov_animal_status_active(o,body->'animal'->>'status') then raise exception 'ANIMAL_INACTIVE' using errcode='P1001'; end if;
 -- Legacy child objects may omit animalId; their locked bundle and versioned
 -- parent already establish ownership. Match the projection's identity rules.
 if not exists(select 1 from jsonb_array_elements(body->'photos') e where e->>'id'=id
   and (not e ? 'animalId' or e->>'animalId'=parent)) then raise exception 'PHOTO_NOT_AVAILABLE' using errcode='P1001'; end if;
 if action='photo.primary' then
  select count(*),min(e->>'id') into primary_count,primary_id from jsonb_array_elements(body->'photos') e where e->'primary'='true'::jsonb;
  if primary_count>1 or primary_id is distinct from c->>'previousPrimaryId' then raise exception 'PRIMARY_CHANGED' using errcode='P1002'; end if;
  select jsonb_agg(e||jsonb_build_object('primary',e->>'id'=id) order by pos) into items from jsonb_array_elements(body->'photos') with ordinality t(e,pos);
 else
  select jsonb_agg(case when e->>'id'=id then e||jsonb_build_object('cropX',c->'cropX','cropY',c->'cropY','cropZoom',c->'cropZoom') else e end order by pos) into items from jsonb_array_elements(body->'photos') with ordinality t(e,pos);
 end if;
 update public.animal_sync_records set payload=jsonb_set(payload,'{photos}',items) where owner_id=o and animal_id=parent;
end;
$$;
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
    if member.role='worker' and action not in ('event.create','event.update','journey.attend','journey.create','journey.add_animals') then raise exception 'PERMISSION_DENIED' using errcode='P1001'; end if;
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
    elsif action in ('photo.crop','photo.primary') then perform ganaderov_private.edit_photo_presentation(o,id,action,c,a.payload,received);
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
revoke all on function ganaderov_private.edit_photo_presentation(uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
commit;
