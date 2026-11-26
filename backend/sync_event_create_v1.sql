-- Candidate migration: apply only in an isolated staging database.
-- Keeps current animal JSON format and worker triggers.
begin;
create schema if not exists ganaderov_private;
revoke all on schema ganaderov_private from public, anon, authenticated;
-- This candidate supersedes the previous uninstalled candidate.
create table ganaderov_private.event_operation_receipts (
  owner_id uuid not null,
  operation_id uuid not null,
  actor_id uuid not null,
  entity_id text not null,
  request jsonb not null,
  applied_event jsonb not null,
  actor_role text not null check (actor_role in ('owner','admin','worker')),
  animal_id text not null,
  received_at timestamptz not null default clock_timestamp(),
  revision bigint not null check (revision between 1 and 9007199254740991),
  primary key(owner_id,operation_id),
  unique(owner_id,entity_id)
);
alter table ganaderov_private.event_operation_receipts enable row level security;
revoke all on ganaderov_private.event_operation_receipts from public, anon, authenticated;

-- Private implementation: privileged access is limited to this one action.
-- Explicit membership check and row lock are mandatory because owner bypasses RLS.
create function ganaderov_private.apply_event_create(p jsonb)
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
    if length(v_animal_id) not between 1 and 200 or typ not in ('weight','bath','vaccine','deworm','injection','medication','review')
      or length(coalesce(changes->>'product',''))>120 or length(coalesce(changes->>'notes',''))>2000 then exit validate_and_apply; end if;
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
revoke all on function ganaderov_private.apply_event_create(jsonb) from public, anon, authenticated;
-- SECURITY INVOKER wrapper exposes only the narrowly scoped private function.
grant usage on schema ganaderov_private to authenticated;
grant execute on function ganaderov_private.apply_event_create(jsonb) to authenticated;
create function public.sync_apply_operation(p_operation jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select ganaderov_private.apply_event_create(p_operation); $$;
revoke all on function public.sync_apply_operation(jsonb) from public, anon;
grant execute on function public.sync_apply_operation(jsonb) to authenticated;
-- Manager-only audit feed. No direct table grants, no access to other ranches.
create function ganaderov_private.read_event_audit(p_owner uuid,p_limit integer default 50,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $audit$
declare
  v_uid uuid:=auth.uid();
  v_result jsonb;
begin
  if v_uid is null or not exists(select 1 from public.ranch_members m where m.owner_id=p_owner and m.user_id=v_uid and m.status='active' and m.role in ('owner','admin')) then
    raise exception 'Audit access denied' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before is null) <> (p_before_id is null) then
    raise exception 'Invalid audit page' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.received_at desc,q.operation_id desc),'[]'::jsonb) into v_result
  from (select r.operation_id,r.entity_id,r.actor_id,r.actor_role,r.animal_id,r.received_at,r.revision,
        r.request->>'deviceId' as device_id,r.request->>'capturedAt' as captured_at,
        r.applied_event
        from ganaderov_private.event_operation_receipts r
        where r.owner_id=p_owner and (p_before is null or (r.received_at,r.operation_id)<(p_before,p_before_id))
        order by r.received_at desc,r.operation_id desc limit p_limit) q;
  return v_result;
end;
$audit$;
create index event_receipts_audit_page on ganaderov_private.event_operation_receipts(owner_id,received_at desc,operation_id desc);
revoke all on function ganaderov_private.read_event_audit(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function ganaderov_private.read_event_audit(uuid,integer,timestamptz,uuid) to authenticated;
create function public.sync_read_event_audit(p_owner uuid,p_limit integer default 50,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql security invoker set search_path=''
as $$ select ganaderov_private.read_event_audit(p_owner,p_limit,p_before,p_before_id); $$;
revoke all on function public.sync_read_event_audit(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.sync_read_event_audit(uuid,integer,timestamptz,uuid) to authenticated;
commit;
