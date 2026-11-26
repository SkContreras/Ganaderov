-- Disposable Supabase, after all candidate scripts. Every fixture is rolled back.
begin;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000101','phase16@example.invalid');
insert into public.ranches(owner_id,display_name) values ('10000000-0000-4000-8000-000000000101','Rancho de pruebas');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values ('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000101','Encargada','owner','active');
insert into storage.objects(bucket_id,name,metadata) values ('animal-photos','10000000-0000-4000-8000-000000000101/20000000-0000-4000-8000-000000000101/30000000-0000-4000-8000-000000000101','{"size":2048,"mimetype":"image/jpeg"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000101","role":"authenticated","email":"phase16@example.invalid"}',true);
create function pg_temp.send(action text,id text,rev int,changes jsonb,expected text default 'applied')
returns jsonb language plpgsql as $$
declare op jsonb; result jsonb; duplicate jsonb;
begin
  op:=jsonb_build_object('protocolVersion',1,'operationId',gen_random_uuid(),'deviceId',gen_random_uuid(),
    'ownerId',auth.uid(),'action',action,'entityId',id,'baseRevision',rev,'changes',changes,'capturedAt',now());
  result:=public.sync_apply_operation(op);
  if result->>'status' is distinct from expected then raise exception '% expected %, received %',action,expected,result; end if;
  if expected='applied' then
    duplicate:=public.sync_apply_operation(op);
    if duplicate is distinct from (result||'{"status":"duplicate"}'::jsonb) then raise exception 'Duplicado incorrecto %',duplicate; end if;
  end if;
  return result;
end;
$$;
do $$
declare a text:='20000000-0000-4000-8000-000000000101'; b text:=gen_random_uuid()::text; event_id text:=gen_random_uuid()::text;
photo text:='30000000-0000-4000-8000-000000000101'; j text:=gen_random_uuid()::text; roster jsonb;
begin
  perform pg_temp.send('animal.create',a,null,'{"fields":{"tag":"A1","sex":"Hembra"}}');
  perform pg_temp.send('animal.create',b,null,'{"fields":{"tag":"B1","sex":"Macho"}}');
  perform pg_temp.send('animal.update',a,1,'{"fields":{"name":"Luna"}}');
  perform pg_temp.send('animal.update',a,1,'{"fields":{"color":"Negro"}}');
  perform pg_temp.send('animal.update',a,1,'{"fields":{"name":"Sol"}}','conflict');
  perform pg_temp.send('animal.archive',a,3,'{"status":"Vendido"}');
  perform pg_temp.send('animal.restore',a,4,'{"status":"Activo"}');
  perform pg_temp.send('event.create',event_id,null,jsonb_build_object('animalId',a,'type','weight','date',current_date,'weight',280));
  perform pg_temp.send('event.update',event_id,1,jsonb_build_object('animalId',a,'weight',281));
  perform pg_temp.send('event.delete',event_id,2,jsonb_build_object('animalId',a,'reason','Captura duplicada'));
  perform pg_temp.send('event.create',event_id,null,jsonb_build_object('animalId',a,'type','weight','date',current_date,'weight',280),'conflict');
  perform pg_temp.send('photo.create',photo,null,jsonb_build_object('animalId',a,'name','Luna','mime','image/jpeg'));
  perform pg_temp.send('photo.delete',photo,1,jsonb_build_object('animalId',a));
  if (public.sync_read_entity(auth.uid(),'animal',a)->>'revision')::int<>5 then raise exception 'Revisión de ficha afectada por hijos'; end if;
  perform pg_temp.send('journey.create',j,null,jsonb_build_object('animalIds',jsonb_build_array(a,b),'date',current_date,'type','weight'));
  perform pg_temp.send('journey.attend',j,1,jsonb_build_object('animalId',a,'weight',300));
  perform pg_temp.send('journey.finish',j,2,'{"allowIncomplete":true}');
  perform pg_temp.send('journey.resume',j,3,'{}');
  perform pg_temp.send('journey.attend',j,4,jsonb_build_object('animalId',a,'weight',310));
  perform pg_temp.send('journey.attend',j,4,jsonb_build_object('animalId',b,'weight',290));
  perform pg_temp.send('journey.finish',j,6,'{"allowIncomplete":false}');
  if public.sync_read_entity(auth.uid(),'event','journey:'||j||':'||a)->'data'->>'weight' is distinct from '310' then raise exception 'Corrección perdida'; end if;
  perform pg_temp.send('config.update',auth.uid()::text,0,'{"config":{"schemaVersion":1,"modules":{},"fields":{},"layout":{}}}');
end;
$$;
reset role;
do $$ begin
  if (select count(distinct request->>'action') from ganaderov_private.operation_audit where owner_id='10000000-0000-4000-8000-000000000101')<>14 then raise exception 'Auditoría incompleta'; end if;
end; $$;
rollback;
