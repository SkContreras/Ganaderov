-- Run against disposable Supabase after all candidate migrations. No fixtures survive.
begin;

insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000401','photo-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000402','photo-admin@example.invalid'),
 ('10000000-0000-4000-8000-000000000403','photo-worker@example.invalid'),
 ('10000000-0000-4000-8000-000000000404','photo-outsider@example.invalid'),
 ('10000000-0000-4000-8000-000000000405','photo-other-owner@example.invalid');
insert into public.ranches(owner_id,display_name) values
 ('10000000-0000-4000-8000-000000000401','D4 photo fixtures'),
 ('10000000-0000-4000-8000-000000000405','D4 isolated ranch');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values
 ('10000000-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000401','Owner','owner','active'),
 ('10000000-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000402','Admin','admin','active'),
 ('10000000-0000-4000-8000-000000000401','10000000-0000-4000-8000-000000000403','Worker','worker','active'),
 ('10000000-0000-4000-8000-000000000405','10000000-0000-4000-8000-000000000405','Other owner','owner','active');
insert into storage.objects(bucket_id,name,metadata)
select 'animal-photos', owner_id||'/20000000-0000-4000-8000-000000000401/'||photo_id,
 '{"size":2048,"mimetype":"image/jpeg","fixture":"original"}'::jsonb
from (values ('10000000-0000-4000-8000-000000000401'),('10000000-0000-4000-8000-000000000405')) ranch(owner_id)
cross join (values ('30000000-0000-4000-8000-000000000401'),('30000000-0000-4000-8000-000000000402'),('30000000-0000-4000-8000-000000000403')) photo(photo_id);

create function pg_temp.photo_check(ok boolean, description text)
returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'D4: %', description; end if;
end;
$$;
create function pg_temp.photo_actor(uid uuid)
returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','email',uid||'@example.invalid')::text,true);
end;
$$;
create function pg_temp.photo_send(action text,id text,rev int,changes jsonb,
 expected text default 'applied',expected_code text default 'OK',
 ranch uuid default '10000000-0000-4000-8000-000000000401')
returns jsonb language plpgsql as $$
declare op jsonb; result jsonb; repeated jsonb;
begin
 op:=jsonb_build_object('protocolVersion',1,'operationId',gen_random_uuid(),'deviceId',gen_random_uuid(),
  'ownerId',ranch,'action',action,'entityId',id,'baseRevision',rev,'changes',changes,'capturedAt',now());
 result:=public.sync_apply_operation(op);
 perform pg_temp.photo_check(result->>'status'=expected and result->>'code'=expected_code,
  format('%s expected %s/%s, received %s',action,expected,expected_code,result));
 if expected='applied' then
  repeated:=public.sync_apply_operation(op);
  perform pg_temp.photo_check(repeated=result||'{"status":"duplicate"}'::jsonb,'retry changed the original receipt');
 end if;
 return result;
end;
$$;

set local role authenticated;
select pg_temp.photo_actor('10000000-0000-4000-8000-000000000401');
do $$
declare
 o uuid:='10000000-0000-4000-8000-000000000401';
 a text:='20000000-0000-4000-8000-000000000401';
 b text:='20000000-0000-4000-8000-000000000402';
 p1 text:='30000000-0000-4000-8000-000000000401';
 p2 text:='30000000-0000-4000-8000-000000000402';
 p3 text:='30000000-0000-4000-8000-000000000403';
 before_photo jsonb; before_animal jsonb; current_photo jsonb; invalid_changes jsonb; receipt jsonb;
begin
 perform pg_temp.photo_send('animal.create',a,null,'{"fields":{"tag":"D4-A","sex":"Hembra"}}');
 perform pg_temp.photo_send('animal.create',b,null,'{"fields":{"tag":"D4-B","sex":"Macho"}}');
 perform pg_temp.photo_send('photo.create',p1,null,jsonb_build_object('animalId',a,'name','Original one','mime','image/jpeg'));
 perform pg_temp.photo_send('photo.create',p2,null,jsonb_build_object('animalId',a,'name','Original two','mime','image/jpeg'));
 perform pg_temp.photo_send('photo.create',p3,null,jsonb_build_object('animalId',a,'name','Original three','mime','image/jpeg'));
 before_photo:=public.sync_read_entity(o,'photo',p1)->'data';
 before_animal:=public.sync_read_entity(o,'animal',a);

 receipt:=pg_temp.photo_send('photo.crop',p1,1,jsonb_build_object('animalId',a,'cropX',17.5,'cropY',83,'cropZoom',2.25));
 current_photo:=public.sync_read_entity(o,'photo',p1)->'data';
 perform pg_temp.photo_check(receipt->>'revision'='2','crop did not increment the photo revision once');
 perform pg_temp.photo_check(current_photo-array['cropX','cropY','cropZoom']=before_photo,'crop changed original metadata or Storage path');
 perform pg_temp.photo_check(current_photo @> '{"cropX":17.5,"cropY":83,"cropZoom":2.25}','crop metadata was not saved');
 perform pg_temp.photo_check(public.sync_read_entity(o,'animal',a)=before_animal,'photo edit changed the animal revision');
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p2)->>'revision'='1','crop changed another photo');
 perform pg_temp.photo_send('photo.crop',p1,1,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'conflict','REVISION_CONFLICT');

 for invalid_changes in select value from jsonb_array_elements(jsonb_build_array(
  '{"cropX":-0.001,"cropY":0,"cropZoom":1}'::jsonb,
  '{"cropX":100.001,"cropY":0,"cropZoom":1}'::jsonb,
  '{"cropX":50,"cropY":-1,"cropZoom":1}'::jsonb,
  '{"cropX":50,"cropY":101,"cropZoom":1}'::jsonb,
  '{"cropX":50,"cropY":"50","cropZoom":1}'::jsonb,
  '{"cropX":50,"cropY":50,"cropZoom":0.99}'::jsonb,
  '{"cropX":50,"cropY":50,"cropZoom":3.001}'::jsonb,
  '{"cropX":50,"cropY":50}'::jsonb,
  '{"cropX":null,"cropY":50,"cropZoom":1}'::jsonb,
  '{"cropX":50,"cropY":50,"cropZoom":1,"storagePath":"replacement"}'::jsonb,
  '{"cropX":50,"cropY":50,"cropZoom":1,"primary":true}'::jsonb)) loop
  perform pg_temp.photo_send('photo.crop',p1,2,invalid_changes||jsonb_build_object('animalId',a),'rejected','INVALID_REQUEST');
 end loop;
 perform pg_temp.photo_send('photo.crop',p1,0,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'rejected','INVALID_REQUEST');
 perform pg_temp.photo_send('photo.primary',p2,1,jsonb_build_object('animalId',a),'rejected','INVALID_REQUEST');
 perform pg_temp.photo_send('photo.primary',p2,1,jsonb_build_object('animalId',a,'previousPrimaryId',false),'rejected','INVALID_REQUEST');
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p1)->'data'=current_photo,'invalid request changed a photo');
 perform pg_temp.photo_send('photo.crop',p1,2,jsonb_build_object('animalId',a,'cropX',0,'cropY',100,'cropZoom',3));

 perform pg_temp.photo_send('photo.primary',p2,1,jsonb_build_object('animalId',a,'previousPrimaryId',p1));
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p1)->>'revision'='4','old primary revision was not incremented');
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p2)->>'revision'='2','new primary revision was not incremented');
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p3)->>'revision'='1','unaffected photo revision changed');
 -- A different target still has its original revision: the previous-primary CAS must reject it.
 perform pg_temp.photo_send('photo.primary',p3,1,jsonb_build_object('animalId',a,'previousPrimaryId',p1),'conflict','PRIMARY_CHANGED');
 perform pg_temp.photo_send('photo.primary',p3,1,jsonb_build_object('animalId',a,'previousPrimaryId',null),'conflict','PRIMARY_CHANGED');
 perform pg_temp.photo_send('photo.primary',p3,1,jsonb_build_object('animalId',a,'previousPrimaryId',p2));
 perform pg_temp.photo_send('photo.crop',p2,2,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'conflict','REVISION_CONFLICT');
 perform pg_temp.photo_send('photo.primary',p1,3,jsonb_build_object('animalId',a,'previousPrimaryId',p3),'conflict','REVISION_CONFLICT');
 perform pg_temp.photo_send('photo.crop',p1,4,jsonb_build_object('animalId',b,'cropX',50,'cropY',50,'cropZoom',1),'conflict','ENTITY_NOT_AVAILABLE');

 perform pg_temp.photo_send('animal.archive',a,1,'{"status":"Vendido"}');
 perform pg_temp.photo_send('photo.crop',p1,4,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'rejected','ANIMAL_INACTIVE');
 perform pg_temp.photo_send('photo.primary',p1,4,jsonb_build_object('animalId',a,'previousPrimaryId',p3),'rejected','ANIMAL_INACTIVE');
 perform pg_temp.photo_send('photo.delete',p1,4,jsonb_build_object('animalId',a),'rejected','ANIMAL_INACTIVE');
 perform pg_temp.photo_send('animal.restore',a,2,'{"status":"Activo"}');

 perform pg_temp.photo_actor('10000000-0000-4000-8000-000000000403');
 perform pg_temp.photo_send('photo.crop',p1,4,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'rejected','PERMISSION_DENIED');
 perform pg_temp.photo_send('photo.primary',p1,4,jsonb_build_object('animalId',a,'previousPrimaryId',p3),'rejected','PERMISSION_DENIED');
 perform pg_temp.photo_send('photo.delete',p1,4,jsonb_build_object('animalId',a),'rejected','PERMISSION_DENIED');
 perform pg_temp.photo_actor('10000000-0000-4000-8000-000000000404');
 perform pg_temp.photo_send('photo.crop',p1,4,jsonb_build_object('animalId',a,'cropX',50,'cropY',50,'cropZoom',1),'rejected','MEMBERSHIP_REQUIRED');
 begin
  perform public.sync_read_entity(o,'photo',p1);
  raise exception 'D4: outsider could read photo history';
 exception when insufficient_privilege then null;
 end;
 perform pg_temp.photo_actor('10000000-0000-4000-8000-000000000402');
 perform pg_temp.photo_send('photo.crop',p1,4,jsonb_build_object('animalId',a,'cropX',40,'cropY',60,'cropZoom',1.5));
 perform pg_temp.photo_actor(o);

 -- Deleting a photo invalidates queued edits and does not resurrect its metadata.
 perform pg_temp.photo_send('photo.delete',p2,3,jsonb_build_object('animalId',a));
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p2)->'data'='null'::jsonb,'deleted photo has no tombstone');
 perform pg_temp.photo_send('photo.crop',p2,3,jsonb_build_object('animalId',a,'cropX',25,'cropY',25,'cropZoom',2),'conflict','ENTITY_NOT_AVAILABLE');
 perform pg_temp.photo_send('photo.primary',p2,3,jsonb_build_object('animalId',a,'previousPrimaryId',p3),'conflict','ENTITY_NOT_AVAILABLE');
 perform pg_temp.photo_send('photo.delete',p3,2,jsonb_build_object('animalId',a));
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p1)->'data'->'primary'='true'::jsonb,'delete did not choose a remaining primary');
 perform pg_temp.photo_send('photo.crop',p1,5,jsonb_build_object('animalId',a,'cropX',25,'cropY',25,'cropZoom',2),'conflict','REVISION_CONFLICT');
 perform pg_temp.photo_send('photo.delete',p1,6,jsonb_build_object('animalId',a));
 perform pg_temp.photo_check((select payload->'photos'='[]'::jsonb from public.animal_sync_records where owner_id=o and animal_id=a),'last deletion left photos behind');
 perform pg_temp.photo_check(public.sync_read_entity(o,'animal',a)->>'revision'='3','photo operations affected the animal revision');
end;
$$;

-- Reuse the same animal/photo IDs in a second ranch; ownerId must remain the scope.
select pg_temp.photo_actor('10000000-0000-4000-8000-000000000405');
do $$
declare
 o uuid:='10000000-0000-4000-8000-000000000405';
 a text:='20000000-0000-4000-8000-000000000401';
 p text:='30000000-0000-4000-8000-000000000401';
begin
 perform pg_temp.photo_send('animal.create',a,null,'{"fields":{"tag":"OTHER","sex":"Hembra"}}','applied','OK',o);
 perform pg_temp.photo_send('photo.create',p,null,jsonb_build_object('animalId',a,'name','Other ranch','mime','image/jpeg'),'applied','OK',o);
 perform pg_temp.photo_send('photo.crop',p,1,jsonb_build_object('animalId',a,'cropX',100,'cropY',0,'cropZoom',1),'applied','OK',o);
 perform pg_temp.photo_send('photo.crop',p,1,jsonb_build_object('animalId',a,'cropX',100,'cropY',0,'cropZoom',1),'rejected','MEMBERSHIP_REQUIRED');
 perform pg_temp.photo_check(public.sync_read_entity(o,'photo',p)->'data'->>'storagePath'=o||'/'||a||'/'||p,'cross-ranch Storage path');
end;
$$;
reset role;

-- Legacy bundles can omit child animalId and carry fields unknown to D4.
-- Presentation edits must preserve them, and a missing primary can be selected explicitly.
insert into public.animal_sync_records(owner_id,animal_id,payload) values
 ('10000000-0000-4000-8000-000000000401','legacy-photo-d4',
 '{"animal":{"id":"legacy-photo-d4","status":"Activo"},"events":[],"forecasts":[],"photos":[{"id":"legacy-photo-one","storagePath":"original/legacy/object","legacyMetadata":{"orientation":6}}]}'),
 ('10000000-0000-4000-8000-000000000401','ambiguous-photo-d4',
 '{"animal":{"id":"ambiguous-photo-d4","status":"Activo"},"events":[],"forecasts":[],"photos":[{"id":"ambiguous-one","animalId":"ambiguous-photo-d4","primary":true},{"id":"ambiguous-two","animalId":"ambiguous-photo-d4","primary":true}]}');
set local role authenticated;
select pg_temp.photo_actor('10000000-0000-4000-8000-000000000401');
do $$
declare before_photo jsonb; after_photo jsonb;
begin
 before_photo:=public.sync_read_entity(auth.uid(),'photo','legacy-photo-one')->'data';
 perform pg_temp.photo_send('photo.crop','legacy-photo-one',1,'{"animalId":"legacy-photo-d4","cropX":20,"cropY":70,"cropZoom":2}');
 after_photo:=public.sync_read_entity(auth.uid(),'photo','legacy-photo-one')->'data';
 perform pg_temp.photo_check(after_photo-array['cropX','cropY','cropZoom']=before_photo,'legacy metadata changed on crop');
 perform pg_temp.photo_send('photo.primary','legacy-photo-one',2,'{"animalId":"legacy-photo-d4","previousPrimaryId":null}');
 perform pg_temp.photo_check(public.sync_read_entity(auth.uid(),'photo','legacy-photo-one')->'data'->'primary'='true'::jsonb,'no-primary selection failed');
 perform pg_temp.photo_send('photo.primary','ambiguous-two',1,'{"animalId":"ambiguous-photo-d4","previousPrimaryId":"ambiguous-one"}','conflict','PRIMARY_CHANGED');
end;
$$;
reset role;

do $$
begin
 perform pg_temp.photo_check((select count(*)=6 from storage.objects where bucket_id='animal-photos' and name like '10000000-0000-4000-8000-00000000040_/20000000-0000-4000-8000-000000000401/%'
  and metadata='{"size":2048,"mimetype":"image/jpeg","fixture":"original"}'::jsonb),'photo operations changed original Storage objects');
 perform pg_temp.photo_check(not has_function_privilege('authenticated','ganaderov_private.edit_photo_presentation(uuid,text,text,jsonb,jsonb,text)','execute'),'private helper is executable by clients');
 perform pg_temp.photo_check(not has_function_privilege('anon','ganaderov_private.edit_photo_presentation(uuid,text,text,jsonb,jsonb,text)','execute'),'private helper is executable by anon');
 perform pg_temp.photo_check((select count(*)=3 from ganaderov_private.entity_history h where owner_id='10000000-0000-4000-8000-000000000401' and kind='photo' and data is null),'deletions were not versioned');
 perform pg_temp.photo_check(not exists(select 1 from ganaderov_private.operation_audit where owner_id='10000000-0000-4000-8000-000000000401' and request->>'action'='photo.crop'
  and before_data-array['cropX','cropY','cropZoom'] is distinct from after_data-array['cropX','cropY','cropZoom']),'crop audit changed original metadata');
end;
$$;
rollback;
