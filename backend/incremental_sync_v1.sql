-- Staging candidate. Apply after current schema and prior backend candidates.
begin;
lock table public.animal_sync_records,public.journey_sync_records,public.ranch_animal_configs in share row exclusive mode;
create schema if not exists ganaderov_private;
create table ganaderov_private.sync_heads_v1 (
 owner_id uuid primary key, epoch uuid not null default gen_random_uuid(),
 head bigint not null default 0 check(head between 0 and 9007199254740991)
);
create table ganaderov_private.sync_changes_v1 (
 owner_id uuid not null, revision bigint not null,
 kind text not null check(kind in ('animal','journey','config')),
 entity_id text not null, deleted boolean not null, record jsonb,
 primary key(owner_id,revision),
 check((deleted and record is null) or (not deleted and record is not null))
);
alter table ganaderov_private.sync_heads_v1 enable row level security;
alter table ganaderov_private.sync_changes_v1 enable row level security;
revoke all on ganaderov_private.sync_heads_v1,ganaderov_private.sync_changes_v1 from public,anon,authenticated;
-- Transactional counter, NOT a sequence. Concurrent writers to one ranch
-- serialize on this row until commit; rollback also rolls back the counter.
create function ganaderov_private.append_change_v1(p_owner uuid,p_kind text,p_id text,p_deleted boolean,p_record jsonb)
returns void language plpgsql security invoker set search_path=''
as $fn$
declare v_revision bigint;
begin
 insert into ganaderov_private.sync_heads_v1(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 update ganaderov_private.sync_heads_v1 set head=head+1 where owner_id=p_owner returning head into v_revision;
 insert into ganaderov_private.sync_changes_v1 values(p_owner,v_revision,p_kind,p_id,p_deleted,p_record);
end;
$fn$;
revoke all on function ganaderov_private.append_change_v1(uuid,text,text,boolean,jsonb) from public,anon,authenticated;
create function ganaderov_private.capture_change_v1()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_old jsonb; v_new jsonb; v_kind text; v_key text; v_old_id text; v_new_id text;
begin
 case tg_table_name
 when 'animal_sync_records' then v_kind:='animal'; v_key:='animal_id';
 when 'journey_sync_records' then v_kind:='journey'; v_key:='journey_id';
 when 'ranch_animal_configs' then v_kind:='config'; v_key:='owner_id';
 else raise exception 'Unexpected source'; end case;
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); v_old_id:=v_old->>v_key; end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); v_new_id:=v_new->>v_key; end if;
 if tg_op='DELETE' or (tg_op='UPDATE' and (v_old->>'owner_id',v_old_id) is distinct from (v_new->>'owner_id',v_new_id)) then
  perform ganaderov_private.append_change_v1((v_old->>'owner_id')::uuid,v_kind,v_old_id,true,null);
 end if;
 if tg_op<>'DELETE' then
  perform ganaderov_private.append_change_v1((v_new->>'owner_id')::uuid,v_kind,v_new_id,false,v_new);
  return new;
 end if;
 return old;
end;
$fn$;
revoke all on function ganaderov_private.capture_change_v1() from public,anon,authenticated;
-- Seed the feed under source locks, including existing animal tombstones.
do $seed$
declare a public.animal_sync_records; j public.journey_sync_records; c public.ranch_animal_configs;
begin
 for a in select * from public.animal_sync_records order by owner_id,animal_id loop perform ganaderov_private.append_change_v1(a.owner_id,'animal',a.animal_id,false,to_jsonb(a)); end loop;
 for j in select * from public.journey_sync_records order by owner_id,journey_id loop perform ganaderov_private.append_change_v1(j.owner_id,'journey',j.journey_id,false,to_jsonb(j)); end loop;
 for c in select * from public.ranch_animal_configs order by owner_id loop perform ganaderov_private.append_change_v1(c.owner_id,'config',c.owner_id::text,false,to_jsonb(c)); end loop;
end;
$seed$;
create trigger sync_feed_animal_v1 after insert or update or delete on public.animal_sync_records for each row execute function ganaderov_private.capture_change_v1();
create trigger sync_feed_journey_v1 after insert or update or delete on public.journey_sync_records for each row execute function ganaderov_private.capture_change_v1();
create trigger sync_feed_config_v1 after insert or update or delete on public.ranch_animal_configs for each row execute function ganaderov_private.capture_change_v1();
create function ganaderov_private.pull_changes_v1(p_owner uuid,p_after bigint,p_epoch uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_head bigint; v_epoch uuid; v_rows jsonb; v_next bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.ranch_members m where m.owner_id=p_owner and m.user_id=auth.uid() and m.status='active') then raise exception 'Membership required' using errcode='42501'; end if;
 if p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid cursor' using errcode='22023'; end if;
 -- Empty ranches also need a stable epoch.
 insert into ganaderov_private.sync_heads_v1(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 select h.head,h.epoch into v_head,v_epoch from ganaderov_private.sync_heads_v1 h where h.owner_id=p_owner;
 if (p_epoch is null and p_after<>0) or (p_epoch is not null and p_epoch<>v_epoch) or p_after>v_head then
  return jsonb_build_object('protocolVersion',1,'status','reset_required','epoch',v_epoch,'head',v_head);
 end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.revision),'[]'::jsonb),coalesce(max(q.revision),p_after)
 into v_rows,v_next from (select revision,kind,entity_id,deleted,record from ganaderov_private.sync_changes_v1 where owner_id=p_owner and revision>p_after and revision<=v_head order by revision limit p_limit) q;
 return jsonb_build_object('protocolVersion',1,'status','ok','epoch',v_epoch,'head',v_head,'nextCursor',v_next,'hasMore',v_next<v_head,'changes',v_rows);
end;
$fn$;
revoke all on function ganaderov_private.pull_changes_v1(uuid,bigint,uuid,integer) from public,anon,authenticated;
grant usage on schema ganaderov_private to authenticated;
grant execute on function ganaderov_private.pull_changes_v1(uuid,bigint,uuid,integer) to authenticated;
create function public.sync_pull_changes(p_owner uuid,p_after bigint default 0,p_epoch uuid default null,p_limit integer default 50)
returns jsonb language sql security invoker set search_path=''
as $$ select ganaderov_private.pull_changes_v1(p_owner,p_after,p_epoch,p_limit); $$;
revoke all on function public.sync_pull_changes(uuid,bigint,uuid,integer) from public,anon;
grant execute on function public.sync_pull_changes(uuid,bigint,uuid,integer) to authenticated;
commit;
