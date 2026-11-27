-- CLI: supabase migration new background_capabilities_v1 (2.121.0).
-- Restricted, revocable delegation for an outbox worker. No Auth JWT or refresh
-- token is stored here or returned. Apply only after universal_completion_v1.
begin;
create extension if not exists pgcrypto with schema extensions;

create table ganaderov_private.background_capabilities (
 id uuid primary key default gen_random_uuid(),
 token_hash bytea not null unique check(octet_length(token_hash)=32),
 actor_id uuid not null, owner_id uuid not null, device_id uuid not null, session_id uuid not null,
 allowed_actions text[] not null,
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 deliveries integer not null default 0 check(deliveries between 0 and 5000),
 unique_operations integer not null default 0 check(unique_operations between 0 and 2000),
 upload_bytes bigint not null default 0 check(upload_bytes between 0 and 104857600),
 check(expires_at>issued_at and expires_at<=issued_at+interval '6 hours')
);
-- No cascading Auth/session FK: session deletion must not acquire capability
-- locks in the opposite order. Every request checks and locks the real session.
create index background_capabilities_scope on ganaderov_private.background_capabilities(actor_id,session_id,owner_id,device_id);
create index background_capabilities_expiry on ganaderov_private.background_capabilities(expires_at);
create table ganaderov_private.background_operation_bindings (
 owner_id uuid not null, operation_id uuid not null, actor_id uuid not null,
 request_hash bytea not null check(octet_length(request_hash)=32),
 first_capability_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,operation_id)
);
create table ganaderov_private.background_upload_bindings (
 owner_id uuid not null, operation_id uuid not null, actor_id uuid not null,
 request jsonb not null, object_path text not null, mime text not null,
 bytes bigint not null check(bytes between 1 and 10485760),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(owner_id,operation_id)
);
alter table ganaderov_private.background_capabilities enable row level security;
alter table ganaderov_private.background_operation_bindings enable row level security;
alter table ganaderov_private.background_upload_bindings enable row level security;
revoke all on ganaderov_private.background_capabilities,ganaderov_private.background_operation_bindings,
 ganaderov_private.background_upload_bindings from public,anon,authenticated;

create function ganaderov_private.background_actions(role_name text) returns text[]
language sql immutable set search_path='' as $$
 select case when role_name in ('owner','admin') then array[
  'animal.create','animal.update','animal.archive','animal.restore','event.create','event.update','event.delete',
  'photo.create','photo.delete','journey.create','journey.attend','journey.finish','journey.resume','config.update',
  'forecast.create','forecast.delete','animal.target.update','journey.add_animals','photo.crop','photo.primary']
 when role_name='worker' then array['event.create','event.update','journey.create','journey.attend','journey.add_animals']
 else array[]::text[] end
$$;
revoke all on function ganaderov_private.background_actions(text) from public,anon,authenticated;

create function ganaderov_private.issue_background_capability(o uuid,d uuid,ttl integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); session uuid; member public.ranch_members;
 token text; cap ganaderov_private.background_capabilities;
 issued timestamptz:=clock_timestamp(); deadline timestamptz; auth_session jsonb;
begin
 if actor is null then raise sqlstate 'PT401' using message='BACKGROUND_AUTH_REQUIRED'; end if;
 if o is null or d is null or ttl is null or ttl not between 60 and 21600 then
  raise sqlstate 'PT400' using message='BACKGROUND_INVALID_SCOPE_OR_TTL';
 end if;
 if coalesce(auth.jwt()->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise sqlstate 'PT401' using message='BACKGROUND_SESSION_REQUIRED';
 end if;
 session:=(auth.jwt()->>'session_id')::uuid;
 -- Serialize issuance/rotation for this real session; never manufacture one.
 select to_jsonb(s) into auth_session from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=session and s.user_id=actor
  and (to_jsonb(s)->>'not_after' is null or (to_jsonb(s)->>'not_after')::timestamptz>issued)
  and to_jsonb(u)->>'deleted_at' is null
  and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=issued)
 for update of s;
 if not found then raise sqlstate 'PT401' using message='BACKGROUND_SESSION_ENDED'; end if;
 select * into member from public.ranch_members where owner_id=o and user_id=actor and status='active' for share;
 if not found or member.role not in ('owner','admin','worker') then
  raise sqlstate 'PT403' using message='BACKGROUND_MEMBERSHIP_REQUIRED';
 end if;
 deadline:=least(issued+make_interval(secs=>ttl),coalesce((auth_session->>'not_after')::timestamptz,'infinity'::timestamptz));
 update ganaderov_private.background_capabilities set revoked_at=issued
  where actor_id=actor and owner_id=o and device_id=d and session_id=session and revoked_at is null;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into ganaderov_private.background_capabilities(token_hash,actor_id,owner_id,device_id,session_id,allowed_actions,issued_at,expires_at)
 values(extensions.digest(convert_to(token,'UTF8'),'sha256'),actor,o,d,session,ganaderov_private.background_actions(member.role),issued,deadline)
 returning * into cap;
 return jsonb_build_object('protocolVersion',1,'capabilityId',cap.id,'capability',token,
  'actorId',actor,'ownerId',o,'deviceId',d,'sessionId',session,
  'issuedAt',cap.issued_at,'expiresAt',cap.expires_at,'allowedActions',to_jsonb(cap.allowed_actions));
end;
$$;
revoke all on function ganaderov_private.issue_background_capability(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function ganaderov_private.issue_background_capability(uuid,uuid,integer) to authenticated;
create function public.sync_issue_background_capability(p_owner uuid,p_device uuid,p_ttl_seconds integer default 3600) returns jsonb
language sql security invoker set search_path='' as $$
 select ganaderov_private.issue_background_capability(p_owner,p_device,p_ttl_seconds)
$$;
revoke all on function public.sync_issue_background_capability(uuid,uuid,integer) from public,anon;
grant execute on function public.sync_issue_background_capability(uuid,uuid,integer) to authenticated;

create function ganaderov_private.authorize_background(token text,p jsonb)
returns ganaderov_private.background_capabilities
language plpgsql security definer set search_path='' as $$
declare cap ganaderov_private.background_capabilities; member public.ranch_members;
 binding ganaderov_private.background_operation_bindings; hash bytea; inserted integer;
 caller uuid:=auth.uid(); stamp timestamptz:=clock_timestamp();
begin
 if token is null or token !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT401' using message='BACKGROUND_INVALID'; end if;
 select * into cap from ganaderov_private.background_capabilities
  where token_hash=extensions.digest(convert_to(token,'UTF8'),'sha256');
 if not found then raise sqlstate 'PT401' using message='BACKGROUND_INVALID'; end if;
 if caller is not null and caller<>cap.actor_id then raise sqlstate 'PT403' using message='BACKGROUND_SCOPE_MISMATCH'; end if;
 -- Session -> membership -> capability is shared with issuance, avoiding a
 -- logout/cascade inversion. A logout waits for an already-authorized commit.
 perform 1 from auth.sessions s join auth.users u on u.id=s.user_id
 where s.id=cap.session_id and s.user_id=cap.actor_id
  and (to_jsonb(s)->>'not_after' is null or (to_jsonb(s)->>'not_after')::timestamptz>stamp)
  and to_jsonb(u)->>'deleted_at' is null
  and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=stamp)
 for share of s,u;
 if not found then raise sqlstate 'PT401' using message='BACKGROUND_SESSION_ENDED'; end if;
 select * into member from public.ranch_members where owner_id=cap.owner_id and user_id=cap.actor_id and status='active' for share;
 if not found then raise sqlstate 'PT403' using message='BACKGROUND_MEMBERSHIP_REQUIRED'; end if;
 select * into cap from ganaderov_private.background_capabilities where id=cap.id for update;
 if cap.revoked_at is not null then raise sqlstate 'PT401' using message='BACKGROUND_REVOKED'; end if;
 if cap.expires_at<=clock_timestamp() then raise sqlstate 'PT401' using message='BACKGROUND_EXPIRED'; end if;
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>524288 or ganaderov_private.valid_operation(p) is not true then
  raise sqlstate 'PT400' using message='BACKGROUND_INVALID_OPERATION';
 end if;
 if p->>'ownerId' is distinct from cap.owner_id::text or p->>'deviceId' is distinct from cap.device_id::text then
  raise sqlstate 'PT403' using message='BACKGROUND_SCOPE_MISMATCH';
 end if;
 if not (p->>'action'=any(cap.allowed_actions)) or not (p->>'action'=any(ganaderov_private.background_actions(member.role))) then
  raise sqlstate 'PT403' using message='BACKGROUND_PERMISSION_DENIED';
 end if;
 if member.role='worker' and (
    (p->>'action'='event.create' and p->'changes'->>'type' in ('note','other'))
    or (p->>'action'='event.update' and (p->'changes')-array['animalId','weight']<>'{}'::jsonb)) then
  raise sqlstate 'PT403' using message='BACKGROUND_PERMISSION_DENIED';
 end if;
 if cap.deliveries>=5000 then raise sqlstate 'PT429' using message='BACKGROUND_QUOTA_REACHED'; end if;
 hash:=extensions.digest(convert_to(p::text,'UTF8'),'sha256');
 insert into ganaderov_private.background_operation_bindings(owner_id,operation_id,actor_id,request_hash,first_capability_id)
 values(cap.owner_id,(p->>'operationId')::uuid,cap.actor_id,hash,cap.id) on conflict do nothing;
 get diagnostics inserted=row_count;
 select * into binding from ganaderov_private.background_operation_bindings
  where owner_id=cap.owner_id and operation_id=(p->>'operationId')::uuid for update;
 if binding.actor_id<>cap.actor_id or binding.request_hash<>hash then
  raise sqlstate 'PT409' using message='BACKGROUND_OPERATION_ID_REUSED';
 end if;
 if inserted=1 and cap.unique_operations>=2000 then raise sqlstate 'PT429' using message='BACKGROUND_QUOTA_REACHED'; end if;
 update ganaderov_private.background_capabilities set deliveries=deliveries+1,unique_operations=unique_operations+inserted
  where id=cap.id returning * into cap;
 return cap;
end;
$$;
revoke all on function ganaderov_private.authorize_background(text,jsonb) from public,anon,authenticated;

create function ganaderov_private.apply_background_operation(token text,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cap ganaderov_private.background_capabilities; claims jsonb; result jsonb;
 old_claims text:=current_setting('request.jwt.claims',true);
 old_claim text:=current_setting('request.jwt.claim',true);
 old_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 begin
  cap:=ganaderov_private.authorize_background(token,p);
 exception when sqlstate 'PT409' then
  return jsonb_build_object('protocolVersion',1,'operationId',p->>'operationId','status','conflict',
   'revision',null,'serverReceivedAt',clock_timestamp(),'code','OPERATION_ID_REUSED');
 end;
 select jsonb_build_object('sub',u.id::text,'role','authenticated','aud','authenticated',
   'email',coalesce(u.email,''),'session_id',cap.session_id::text,
   'aal',coalesce(to_jsonb(s)->>'aal','aal1')) into claims
  from auth.users u join auth.sessions s on s.user_id=u.id where u.id=cap.actor_id and s.id=cap.session_id;
 -- Only validated delegation can establish this identity. No caller-provided
 -- actor/email/role survives. Restore all legacy GUC spellings on every exit.
 perform set_config('request.jwt.claims',claims::text,true);
 perform set_config('request.jwt.claim',claims::text,true);
 perform set_config('request.jwt.claim.sub',cap.actor_id::text,true);
 begin
  result:=ganaderov_private.apply_operation(p);
 exception when others then
  perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
  perform set_config('request.jwt.claim',coalesce(old_claim,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  raise;
 end;
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 perform set_config('request.jwt.claim',coalesce(old_claim,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return result;
end;
$$;
revoke all on function ganaderov_private.apply_background_operation(text,jsonb) from public,anon,authenticated;
grant execute on function ganaderov_private.apply_background_operation(text,jsonb) to anon,authenticated,service_role;
grant usage on schema ganaderov_private to anon,service_role;
create function public.sync_apply_background_operation(p_capability text,p_operation jsonb) returns jsonb
language sql security invoker set search_path='' as $$
 select ganaderov_private.apply_background_operation(p_capability,p_operation)
$$;
revoke all on function public.sync_apply_background_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.sync_apply_background_operation(text,jsonb) to anon,authenticated,service_role;

create function ganaderov_private.authorize_background_upload(token text,p jsonb,size_bytes bigint,digest_hex text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cap ganaderov_private.background_capabilities; previous ganaderov_private.background_upload_bindings;
 path text; parent text; photo text; new_binding integer;
begin
 cap:=ganaderov_private.authorize_background(token,p);
 if p->>'action'<>'photo.create' or size_bytes is null or size_bytes not between 1 and 10485760
  or digest_hex is null or digest_hex !~ '^[0-9a-f]{64}$' then raise sqlstate 'PT400' using message='BACKGROUND_INVALID_UPLOAD'; end if;
 parent:=p->'changes'->>'animalId';
 photo:=p->>'entityId';
 if parent ~ '[/\\]' or parent in ('.','..') or photo ~ '[/\\]' or photo in ('.','..') then
  raise sqlstate 'PT400' using message='BACKGROUND_INVALID_UPLOAD';
 end if;
 perform 1 from public.animal_sync_records where owner_id=cap.owner_id and animal_id=parent and deleted_at is null
  and public.ganaderov_animal_status_active(cap.owner_id,payload->'animal'->>'status') for share;
 if not found then raise sqlstate 'PT409' using message='BACKGROUND_ANIMAL_NOT_AVAILABLE'; end if;
 path:=cap.owner_id::text||'/'||parent||'/'||photo;
 insert into ganaderov_private.background_upload_bindings(owner_id,operation_id,actor_id,request,object_path,mime,bytes,sha256)
 values(cap.owner_id,(p->>'operationId')::uuid,cap.actor_id,p,path,p->'changes'->>'mime',size_bytes,digest_hex)
 on conflict do nothing;
 get diagnostics new_binding=row_count;
 select * into previous from ganaderov_private.background_upload_bindings
  where owner_id=cap.owner_id and operation_id=(p->>'operationId')::uuid for update;
 if previous.actor_id<>cap.actor_id or previous.request<>p or previous.object_path<>path
  or previous.mime<>p->'changes'->>'mime' or previous.bytes<>size_bytes or previous.sha256<>digest_hex then
  raise sqlstate 'PT409' using message='BACKGROUND_UPLOAD_CONFLICT';
 end if;
 if new_binding=1 then
  if cap.upload_bytes+size_bytes>104857600 then raise sqlstate 'PT429' using message='BACKGROUND_QUOTA_REACHED'; end if;
  update ganaderov_private.background_capabilities set upload_bytes=upload_bytes+size_bytes where id=cap.id;
 end if;
 return jsonb_build_object('bucket','animal-photos','path',path,'mime',previous.mime,'bytes',previous.bytes,'sha256',previous.sha256);
end;
$$;
revoke all on function ganaderov_private.authorize_background_upload(text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function ganaderov_private.authorize_background_upload(text,jsonb,bigint,text) to service_role;
-- Gateway-only: the browser cannot claim that an unchecked body has this hash.
create function public.sync_authorize_background_upload(p_capability text,p_operation jsonb,p_size bigint,p_sha256 text)
returns jsonb language sql security invoker set search_path='' as $$
 select ganaderov_private.authorize_background_upload(p_capability,p_operation,p_size,p_sha256)
$$;
revoke all on function public.sync_authorize_background_upload(text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.sync_authorize_background_upload(text,jsonb,bigint,text) to service_role;

create function ganaderov_private.revoke_background_capability(target_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); count_rows integer;
begin
 if actor is null then raise sqlstate 'PT401' using message='BACKGROUND_AUTH_REQUIRED'; end if;
 update ganaderov_private.background_capabilities set revoked_at=coalesce(revoked_at,clock_timestamp())
 where actor_id=actor and (target_id is not null and background_capabilities.id=target_id
  or target_id is null and session_id::text=auth.jwt()->>'session_id');
 get diagnostics count_rows=row_count;
 return jsonb_build_object('revoked',count_rows);
end;
$$;
revoke all on function ganaderov_private.revoke_background_capability(uuid) from public,anon,authenticated;
grant execute on function ganaderov_private.revoke_background_capability(uuid) to authenticated;
create function public.sync_revoke_background_capability(p_capability_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select ganaderov_private.revoke_background_capability(p_capability_id) $$;
revoke all on function public.sync_revoke_background_capability(uuid) from public,anon;
grant execute on function public.sync_revoke_background_capability(uuid) to authenticated;

create function ganaderov_private.revoke_background_token(token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 -- Possession can only revoke this token, never read it, renew it or act as Auth.
 if token is not null and token ~ '^[0-9a-f]{64}$' then
  update ganaderov_private.background_capabilities set revoked_at=coalesce(revoked_at,clock_timestamp())
   where token_hash=extensions.digest(convert_to(token,'UTF8'),'sha256');
 end if;
 return jsonb_build_object('revoked',true);
end;
$$;
revoke all on function ganaderov_private.revoke_background_token(text) from public,anon,authenticated;
grant execute on function ganaderov_private.revoke_background_token(text) to anon,authenticated,service_role;
create function public.sync_revoke_background_token(p_capability text) returns jsonb
language sql security invoker set search_path='' as $$ select ganaderov_private.revoke_background_token(p_capability) $$;
revoke all on function public.sync_revoke_background_token(text) from public,anon,authenticated;
grant execute on function public.sync_revoke_background_token(text) to anon,authenticated,service_role;
commit;
