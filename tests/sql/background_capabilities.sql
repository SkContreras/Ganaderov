-- SQL authorization tests on a disposable Supabase; all fixtures roll back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000601','background-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000602','background-worker@example.invalid'),
 ('10000000-0000-4000-8000-000000000603','background-outsider@example.invalid');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('60000000-0000-4000-8000-000000000601','10000000-0000-4000-8000-000000000601',now(),now()),
 ('60000000-0000-4000-8000-000000000602','10000000-0000-4000-8000-000000000602',now(),now());
insert into public.ranches(owner_id,display_name) values ('10000000-0000-4000-8000-000000000601','Background fixture');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values
 ('10000000-0000-4000-8000-000000000601','10000000-0000-4000-8000-000000000601','Owner','owner','active'),
 ('10000000-0000-4000-8000-000000000601','10000000-0000-4000-8000-000000000602','Worker','worker','active');
create temporary table bg_test(id text primary key,data jsonb);
grant all on bg_test to anon,authenticated,service_role;
create function pg_temp.bg_claims(actor uuid,sid uuid default null) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role',case when actor is null then 'anon' else 'authenticated' end,'session_id',sid)::text,true);
end; $$;
create function pg_temp.bg_op(action text,id text,rev int,changes jsonb) returns jsonb language sql as $$
 select jsonb_build_object('protocolVersion',1,'operationId',gen_random_uuid(),
  'ownerId','10000000-0000-4000-8000-000000000601','deviceId','70000000-0000-4000-8000-000000000601',
  'action',action,'entityId',id,'baseRevision',rev,'changes',changes,'capturedAt',now())
$$;
create function pg_temp.bg_reject(token text,op jsonb,expected text) returns void language plpgsql as $$
begin
 begin
  perform public.sync_apply_background_operation(token,op);
  raise exception 'Expected background authorization rejection %',expected;
 exception when sqlstate 'PT401' or sqlstate 'PT403' or sqlstate 'PT429' or sqlstate 'PT400' then
  if sqlerrm<>expected then raise exception 'Expected %, received %',expected,sqlerrm; end if;
 end;
end; $$;
do $$ begin
 if has_function_privilege('anon','public.sync_issue_background_capability(uuid,uuid,integer)','execute')
  or has_function_privilege('anon','public.sync_authorize_background_upload(text,jsonb,bigint,text)','execute')
  or has_function_privilege('authenticated','public.sync_authorize_background_upload(text,jsonb,bigint,text)','execute')
  or has_table_privilege('anon','ganaderov_private.background_capabilities','select')
  or has_table_privilege('authenticated','ganaderov_private.background_capabilities','select') then
  raise exception 'Capability tables or privileged upload authorizer exposed';
 end if;
end; $$;
set local role authenticated;
select pg_temp.bg_claims('10000000-0000-4000-8000-000000000601','60000000-0000-4000-8000-000000000601');
do $$
declare cap jsonb; op jsonb;
begin
 begin
  perform public.sync_issue_background_capability('10000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000601',21601);
  raise exception 'Excessive TTL accepted';
 exception when sqlstate 'PT400' then null; end;
 begin
  perform public.sync_issue_background_capability('10000000-0000-4000-8000-000000000603','70000000-0000-4000-8000-000000000601');
  raise exception 'Other ranch capability issued';
 exception when sqlstate 'PT403' then null; end;
 cap:=public.sync_issue_background_capability('10000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000601');
 if length(cap->>'capability')<>64 or jsonb_array_length(cap->'allowedActions')<>20
  or (cap->>'expiresAt')::timestamptz>(cap->>'issuedAt')::timestamptz+interval '1 hour 1 second' then raise exception 'Invalid issued scope'; end if;
 insert into bg_test values('cap',cap);
 op:=pg_temp.bg_op('animal.create','20000000-0000-4000-8000-000000000601',null,'{"fields":{"tag":"BG-1"}}');
 insert into bg_test values('op',op);
end; $$;
set local role anon;
select pg_temp.bg_claims(null);
do $$
declare token text:=(select data->>'capability' from bg_test where id='cap');
 op jsonb:=(select data from bg_test where id='op'); receipt jsonb; duplicate jsonb;
begin
 perform pg_temp.bg_reject(repeat('0',64),op,'BACKGROUND_INVALID');
 perform pg_temp.bg_reject(token,jsonb_set(op,'{ownerId}','"10000000-0000-4000-8000-000000000603"'),'BACKGROUND_SCOPE_MISMATCH');
 perform pg_temp.bg_reject(token,jsonb_set(op,'{deviceId}','"70000000-0000-4000-8000-000000000602"'),'BACKGROUND_SCOPE_MISMATCH');
 receipt:=public.sync_apply_background_operation(token,op);
 if receipt->>'status'<>'applied' or receipt->>'revision'<>'1' then raise exception 'Delegated operation failed %',receipt; end if;
 if auth.uid() is not null or auth.jwt()->>'role'<>'anon' then raise exception 'Delegated identity escaped RPC'; end if;
 duplicate:=public.sync_apply_background_operation(token,op);
 if duplicate is distinct from (receipt||'{"status":"duplicate"}'::jsonb) then raise exception 'Background duplicate changed receipt'; end if;
 receipt:=public.sync_apply_background_operation(token,jsonb_set(op,'{changes,fields,tag}','"CHANGED"'));
 if receipt->>'status'<>'conflict' or receipt->>'code'<>'OPERATION_ID_REUSED' then raise exception 'Mutable UUID accepted'; end if;
 begin
  perform 1 from ganaderov_private.background_capabilities;
  raise exception 'Anonymous direct capability read succeeded';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$
declare cap jsonb:=(select data from bg_test where id='cap');
begin
 if not exists(select 1 from ganaderov_private.operation_audit
  where owner_id='10000000-0000-4000-8000-000000000601' and request=(select data from bg_test where id='op')
   and actor_id='10000000-0000-4000-8000-000000000601' and actor_role='owner') then raise exception 'Background audit actor was not the authenticated issuer'; end if;
 if not exists(select 1 from ganaderov_private.background_capabilities where id=(cap->>'capabilityId')::uuid
  and token_hash=extensions.digest(convert_to(cap->>'capability','UTF8'),'sha256')
  and encode(token_hash,'hex')<>cap->>'capability') then raise exception 'Token was not stored hashed'; end if;
end; $$;
-- Gateway-only authorization binds bytes and the exact immutable request.
set local role service_role;
select pg_temp.bg_claims(null);
do $$
declare cap jsonb:=(select data from bg_test where id='cap'); op jsonb; upload jsonb; bad_path text;
begin
 op:=pg_temp.bg_op('photo.create','30000000-0000-4000-8000-000000000601',null,
  '{"animalId":"20000000-0000-4000-8000-000000000601","name":"original.png","mime":"image/png"}');
 upload:=public.sync_authorize_background_upload(cap->>'capability',op,128,repeat('a',64));
 if upload->>'path'<>'10000000-0000-4000-8000-000000000601/20000000-0000-4000-8000-000000000601/30000000-0000-4000-8000-000000000601'
  or upload->>'sha256'<>repeat('a',64) then raise exception 'Unscoped upload path or digest'; end if;
 if public.sync_authorize_background_upload(cap->>'capability',op,128,repeat('a',64))<>upload then raise exception 'Upload retry changed authorization'; end if;
 begin
  perform public.sync_authorize_background_upload(cap->>'capability',op,128,repeat('b',64));
  raise exception 'Different bytes accepted for same immutable photo operation';
 exception when sqlstate 'PT409' then
  if sqlerrm<>'BACKGROUND_UPLOAD_CONFLICT' then raise; end if;
 end;
 begin
  perform public.sync_authorize_background_upload(cap->>'capability',op,10485761,repeat('a',64));
  raise exception 'Oversized upload authorized';
 exception when sqlstate 'PT400' then null; end;
 foreach bad_path in array array['.','..','../escape','folder/photo',E'folder\\photo'] loop
  begin
   perform public.sync_authorize_background_upload(cap->>'capability',
    pg_temp.bg_op('photo.create',bad_path,null,op->'changes'),128,repeat('a',64));
   raise exception 'Noncanonical photo path authorized: %',bad_path;
  exception when sqlstate 'PT400' then
   if sqlerrm<>'BACKGROUND_INVALID_UPLOAD' then raise; end if;
  end;
 end loop;
end; $$;
reset role;
update ganaderov_private.background_capabilities set deliveries=5000 where id=(select (data->>'capabilityId')::uuid from bg_test where id='cap');
set local role anon;
do $$ begin
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_QUOTA_REACHED');
end; $$;
reset role;
update ganaderov_private.background_capabilities set deliveries=0,issued_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
 where id=(select (data->>'capabilityId')::uuid from bg_test where id='cap');
set local role anon;
do $$ begin
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_EXPIRED');
end; $$;
-- Refresh capability, then revoke it by possession even without Auth.
set local role authenticated;
select pg_temp.bg_claims('10000000-0000-4000-8000-000000000601','60000000-0000-4000-8000-000000000601');
update bg_test set data=public.sync_issue_background_capability('10000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000601') where id='cap';
set local role anon;
select pg_temp.bg_claims(null);
do $$ begin
 perform public.sync_revoke_background_token((select data->>'capability' from bg_test where id='cap'));
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_REVOKED');
end; $$;
-- A role downgrade, membership revocation, or ended Auth session is checked at
-- delivery time; a still-unexpired capability never freezes old privileges.
set local role authenticated;
select pg_temp.bg_claims('10000000-0000-4000-8000-000000000601','60000000-0000-4000-8000-000000000601');
update bg_test set data=public.sync_issue_background_capability('10000000-0000-4000-8000-000000000601','70000000-0000-4000-8000-000000000601') where id='cap';
reset role;
update public.ranch_members set role='worker' where user_id='10000000-0000-4000-8000-000000000601';
set local role anon;
select pg_temp.bg_claims(null);
do $$ begin
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_PERMISSION_DENIED');
end; $$;
reset role;
update public.ranch_members set role='owner',status='revoked' where user_id='10000000-0000-4000-8000-000000000601';
set local role anon;
do $$ begin
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_MEMBERSHIP_REQUIRED');
end; $$;
reset role;
update public.ranch_members set status='active' where user_id='10000000-0000-4000-8000-000000000601';
delete from auth.sessions where id='60000000-0000-4000-8000-000000000601';
set local role anon;
do $$ begin
 perform pg_temp.bg_reject((select data->>'capability' from bg_test where id='cap'),(select data from bg_test where id='op'),'BACKGROUND_SESSION_ENDED');
end; $$;
reset role;
rollback;
