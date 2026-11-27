begin;
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000201','feed@example.invalid');
insert into public.ranches(owner_id,display_name) values ('10000000-0000-4000-8000-000000000201','Prueba de retención');
insert into public.ranch_members(owner_id,user_id,display_name,role,status) values ('10000000-0000-4000-8000-000000000201','10000000-0000-4000-8000-000000000201','Titular','owner','active');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000201","role":"authenticated"}',true);
do $$
declare o uuid:=auth.uid(); before_rotation jsonb; after_rotation jsonb; rec jsonb; last_page jsonb;
begin
  rec:=jsonb_build_object('owner_id',o,'animal_id','a');
  perform ganaderov_private.append_change_v1(o,'animal','a',false,rec);
  perform ganaderov_private.append_change_v1(o,'animal','b',false,rec||'{"animal_id":"b"}');
  perform ganaderov_private.append_change_v1(o,'animal','b',true,null);
  perform ganaderov_private.append_change_v1(o,'animal','a',false,rec||'{"updated":true}');
  before_rotation:=public.sync_pull_changes(o,0,null,1);
  perform ganaderov_private.compact_feed_v1(o);
  after_rotation:=public.sync_pull_changes(o,1,(before_rotation->>'epoch')::uuid,1);
  if after_rotation->>'status' is distinct from 'reset_required' then raise exception 'Cursor antiguo aceptado'; end if;
  after_rotation:=public.sync_pull_changes(o,0,null,1);
  if after_rotation->'head'<>'1' or after_rotation->'changes'->0->'record' is distinct from (rec||'{"updated":true}') or after_rotation->'hasMore'<>'false' then raise exception 'Base compactada incorrecta: %',after_rotation; end if;
  perform ganaderov_private.append_change_v1(o,'animal','a',true,null);
  last_page:=public.sync_pull_changes(o,1,(after_rotation->>'epoch')::uuid,1);
  if last_page->'changes'->0->'deleted'<>'true' or last_page->'nextCursor'<>'2' then raise exception 'Cambios perdidos tras compactación'; end if;
  perform ganaderov_private.compact_feed_v1(o);
  if (public.sync_pull_changes(o,0,null,1)->>'head')::int<>0 then raise exception 'Tombstone físico retenido'; end if;
end;
$$;
rollback;
