-- Disposable Supabase only. Existing universal_operations.sql remains unchanged.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000501','completion-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000502','completion-worker@example.invalid'),
 ('10000000-0000-4000-8000-000000000503','completion-outsider@example.invalid');
insert into public.ranches(owner_id,display_name) values ('10000000-0000-4000-8000-000000000501','Completion fixture');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values
 ('10000000-0000-4000-8000-000000000501','10000000-0000-4000-8000-000000000501','Owner','owner','active'),
 ('10000000-0000-4000-8000-000000000501','10000000-0000-4000-8000-000000000502','Worker','worker','active');
create function pg_temp.completion_send(action text,id text,rev int,changes jsonb,expected text default 'applied',expected_code text default 'OK')
returns jsonb language plpgsql as $$
declare op jsonb; result jsonb;
begin
 op:=jsonb_build_object('protocolVersion',1,'operationId',gen_random_uuid(),'deviceId',gen_random_uuid(),
  'ownerId','10000000-0000-4000-8000-000000000501','action',action,'entityId',id,'baseRevision',rev,'changes',changes,'capturedAt',now());
 result:=public.sync_apply_operation(op);
 if result->>'status' is distinct from expected or result->>'code' is distinct from expected_code then
  raise exception '% expected %/%, received %',action,expected,expected_code,result;
 end if;
 if expected='applied' and public.sync_apply_operation(op) is distinct from (result||'{"status":"duplicate"}'::jsonb) then
  raise exception 'Immutable retry changed its receipt';
 end if;
 return result;
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000501","role":"authenticated","email":"completion-owner@example.invalid"}',true);
do $$
declare a text:='20000000-0000-4000-8000-000000000501'; b text:='20000000-0000-4000-8000-000000000502';
 note_id text:='30000000-0000-4000-8000-000000000501'; weight_id text:='30000000-0000-4000-8000-000000000502';
 other_id text:=gen_random_uuid()::text; snapshot jsonb; batch jsonb;
begin
 perform pg_temp.completion_send('animal.create',a,null,'{"fields":{"tag":"C-1","name":"First"}}');
 perform pg_temp.completion_send('animal.create',b,null,'{"fields":{"tag":"C-2"}}');
 if public.sync_read_entity(auth.uid(),'animal',a)->'data'->>'internalId' is distinct from 'ANM-00001'
  or public.sync_read_entity(auth.uid(),'animal',b)->'data'->>'internalId' is distinct from 'ANM-00002' then
  raise exception 'Server did not allocate unique internal IDs';
 end if;
 perform pg_temp.completion_send('animal.create',gen_random_uuid()::text,null,'{"fields":{"tag":"C-X","internalId":"ANM-99999"}}','rejected','INVALID_FIELD');
 perform pg_temp.completion_send('animal.update',a,1,'{"fields":{"internalId":"ANM-99999"}}','rejected','INVALID_FIELD');
 perform pg_temp.completion_send('event.create',note_id,null,jsonb_build_object('animalId',a,'type','note','date',current_date,'notes','Initial note'));
 perform pg_temp.completion_send('event.update',note_id,1,jsonb_build_object('animalId',a,'notes','Corrected note','date',current_date-1,'reason','Date and wording corrected'));
 snapshot:=public.sync_read_entity(auth.uid(),'event',note_id);
 if snapshot->'data'->>'notes'<>'Corrected note' or snapshot->'data'->>'date'<>(current_date-1)::text
  or snapshot->'data'->>'type'<>'note' or snapshot->'data'->'updatedBy'->>'authUserId'<>auth.uid()::text then
  raise exception 'Extended event edit lost data or authenticated actor';
 end if;
 perform pg_temp.completion_send('event.update',note_id,2,jsonb_build_object('animalId',a,'notes','','reason','Clear'),'rejected','NOTE_REQUIRED');
 perform pg_temp.completion_send('event.update',note_id,2,jsonb_build_object('animalId',a,'reason','No field'),'rejected','INVALID_REQUEST');
 perform pg_temp.completion_send('event.update',note_id,2,jsonb_build_object('animalId',a,'notes','Changed without reason'),'rejected','INVALID_REQUEST');
 perform pg_temp.completion_send('event.update',note_id,2,jsonb_build_object('animalId',a,'weight',10,'reason','Wrong type'),'rejected','WEIGHT_EVENT_REQUIRED');
 perform pg_temp.completion_send('event.update',note_id,2,jsonb_build_object('animalId',a,'type','weight','reason','Change type'),'rejected','INVALID_REQUEST');
 perform pg_temp.completion_send('event.update',note_id,1,jsonb_build_object('animalId',a,'notes','Stale edit','reason','Outdated'),'conflict','REVISION_CONFLICT');
 perform pg_temp.completion_send('event.create',other_id,null,jsonb_build_object('animalId',a,'type','other','date',current_date,'product','Custom activity','notes','Context'));
 perform pg_temp.completion_send('event.update',other_id,1,jsonb_build_object('animalId',a,'product','Updated label','notes','','reason','Correction'));
 snapshot:=public.sync_read_entity(auth.uid(),'event',other_id);
 if snapshot->'data'->>'label'<>'Updated label' or snapshot->'data' ? 'notes' then raise exception 'Product mapping or clear failed'; end if;
 perform pg_temp.completion_send('event.create',weight_id,null,jsonb_build_object('animalId',a,'type','weight','date',current_date,'weight',300));
 batch:=public.sync_read_entities(auth.uid(),jsonb_build_array(jsonb_build_object('kind','animal','id',a),jsonb_build_object('kind','event','id',note_id),jsonb_build_object('kind','config','id',auth.uid())));
 if jsonb_array_length(batch)<>3 or batch->0->>'revision'<>'1' or batch->1->>'revision'<>'2' or batch->2->>'revision'<>'0' then raise exception 'Batch used incorrect entity revisions'; end if;
 begin
  perform public.sync_read_entities(auth.uid(),'[{"kind":"config","id":"10000000-0000-4000-8000-000000000503"}]');
  raise exception 'Wrong-ranch config was readable';
 exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000502","role":"authenticated","email":"completion-worker@example.invalid"}',true);
do $$
declare a text:='20000000-0000-4000-8000-000000000501'; id text:='30000000-0000-4000-8000-000000000502';
begin
 -- A persisted v1 weight-only capture remains executable, with its original
 -- request, original worker authorization, receipt and trigger semantics.
 perform pg_temp.completion_send('event.update',id,1,jsonb_build_object('animalId',a,'weight',301));
 perform pg_temp.completion_send('event.update',id,2,jsonb_build_object('animalId',a,'weight',302,'reason','Extended edit'),'rejected','PERMISSION_DENIED');
 perform pg_temp.completion_send('event.create',gen_random_uuid()::text,null,jsonb_build_object('animalId',a,'type','note','date',current_date,'notes','Worker note'),'rejected','PERMISSION_DENIED');
 perform pg_temp.completion_send('event.create',gen_random_uuid()::text,null,jsonb_build_object('animalId',a,'type','other','date',current_date),'rejected','PERMISSION_DENIED');
end;
$$;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000503","role":"authenticated"}',true);
do $$ begin
 begin
  perform public.sync_read_entities('10000000-0000-4000-8000-000000000501','[]');
  raise exception 'Outsider read the revision batch';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$ begin
 if not exists(select 1 from ganaderov_private.operation_audit where owner_id='10000000-0000-4000-8000-000000000501'
  and request->>'action'='event.update' and actor_id='10000000-0000-4000-8000-000000000502'
  and not (request->'changes' ? 'reason') and reason like 'Legacy v1 weight correction%') then
  raise exception 'Legacy request was changed or compatibility reason not audited';
 end if;
end; $$;
rollback;
