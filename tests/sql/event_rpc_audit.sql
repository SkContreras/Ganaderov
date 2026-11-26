-- Run ONLY on an isolated disposable Supabase staging database.
-- Execute after supabase-schema.sql and backend/sync_event_create_v1.sql.
-- All fixtures and mutations rolled back.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','owner-sync-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','worker-sync-test@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','outsider-sync-test@example.invalid');
insert into public.ranches(owner_id,display_name) values ('10000000-0000-4000-8000-000000000001','Sync fixture');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Owner fixture','owner','active'),
 ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','Worker fixture','worker','active');
insert into public.animal_sync_records(owner_id,animal_id,payload) values
 ('10000000-0000-4000-8000-000000000001','sync-test-animal','{"animal":{"id":"sync-test-animal","status":"Activo"},"events":[],"photos":[],"forecasts":[]}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"worker-sync-test@example.invalid"}',true);
do $test$
declare
 p jsonb:=jsonb_build_object('protocolVersion',1,'operationId','20000000-0000-4000-8000-000000000001','entityId','30000000-0000-4000-8000-000000000001','ownerId','10000000-0000-4000-8000-000000000001','deviceId','40000000-0000-4000-8000-000000000001','action','event.create','baseRevision',null,'capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'changes',jsonb_build_object('animalId','sync-test-animal','type','weight','date',current_date::text,'weight',350));
 a jsonb; b jsonb; c jsonb;
begin
 a:=public.sync_apply_operation(p);
 if a->>'status' is distinct from 'applied' then raise exception 'Expected applied: %',a; end if;
 b:=public.sync_apply_operation(p);
 if b->>'status' is distinct from 'duplicate' or b->'revision' is distinct from a->'revision' or b->'serverReceivedAt' is distinct from a->'serverReceivedAt' then raise exception 'Invalid duplicate: %',b; end if;
 c:=public.sync_apply_operation(jsonb_set(p,'{changes,weight}','351'));
 if c->>'code' is distinct from 'OPERATION_ID_REUSED' then raise exception 'Expected reused operation conflict: %',c; end if;
 c:=public.sync_apply_operation(jsonb_set(p,'{operationId}','"20000000-0000-4000-8000-000000000002"'));
 if c->>'code' is distinct from 'ENTITY_ID_REUSED' then raise exception 'Expected entity conflict: %',c; end if;
 c:=public.sync_apply_operation(jsonb_set(jsonb_set(jsonb_set(p,'{operationId}','"20000000-0000-4000-8000-000000000003"'),'{entityId}','"30000000-0000-4000-8000-000000000003"'),'{changes,weight}','-1'));
 if c->>'status' is distinct from 'rejected' then raise exception 'Invalid weight accepted'; end if;
 begin
   perform public.sync_read_event_audit('10000000-0000-4000-8000-000000000001');
   raise exception 'Worker could read manager audit';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","email":"outsider-sync-test@example.invalid"}',true);
 c:=public.sync_apply_operation(p);
 if c->>'code' is distinct from 'MEMBERSHIP_REQUIRED' then raise exception 'Outsider received receipt: %',c; end if;
 perform set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner-sync-test@example.invalid"}',true);
 c:=public.sync_read_event_audit('10000000-0000-4000-8000-000000000001');
 if jsonb_array_length(c)<>1 or c->0->>'actor_id' is distinct from '10000000-0000-4000-8000-000000000002' or c->0->'applied_event'->>'weight' is distinct from '350' then raise exception 'Audit mismatch: %',c; end if;
 if (select jsonb_array_length(payload->'events') from public.animal_sync_records where owner_id='10000000-0000-4000-8000-000000000001' and animal_id='sync-test-animal') is distinct from 1 then raise exception 'Duplicate event'; end if;
end;
$test$;
reset role;
rollback;
