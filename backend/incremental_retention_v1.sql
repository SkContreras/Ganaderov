-- Install after incremental_sync_v1.sql on both existing and new databases.
begin;
alter table ganaderov_private.sync_heads_v1 add column checkpoint_size bigint not null default 0;
-- Rotate the epoch and retain one current record per live entity. Readers hold
-- a shared head lock, so they cannot see a new epoch with pages from the old one.
create function ganaderov_private.compact_feed_v1(p_owner uuid)
returns void language plpgsql set search_path='' as $fn$
declare checkpoint_count bigint;
begin
 perform 1 from ganaderov_private.sync_heads_v1 where owner_id=p_owner for update;
 if not found then return; end if;
 -- Move checkpoint rows beyond the previous head before removing history.
 with latest as (
   select distinct on (kind,entity_id) kind,entity_id,deleted,record
   from ganaderov_private.sync_changes_v1 where owner_id=p_owner
   order by kind,entity_id,revision desc
 ), removed as (
   delete from ganaderov_private.sync_changes_v1 where owner_id=p_owner returning 1
 )
 insert into ganaderov_private.sync_changes_v1(owner_id,revision,kind,entity_id,deleted,record)
 select p_owner,h.head+row_number() over(order by kind,entity_id),kind,entity_id,false,record
 from latest cross join ganaderov_private.sync_heads_v1 h where h.owner_id=p_owner and not deleted;
 get diagnostics checkpoint_count=row_count;
 update ganaderov_private.sync_changes_v1 c set revision=c.revision-h.head
   from ganaderov_private.sync_heads_v1 h where c.owner_id=p_owner and h.owner_id=p_owner;
 update ganaderov_private.sync_heads_v1 set head=checkpoint_count,checkpoint_size=checkpoint_count,epoch=gen_random_uuid()
   where owner_id=p_owner;
end;
$fn$;
revoke all on function ganaderov_private.compact_feed_v1(uuid) from public,anon,authenticated;
create or replace function ganaderov_private.append_change_v1(p_owner uuid,p_kind text,p_id text,p_deleted boolean,p_record jsonb)
returns void language plpgsql security invoker set search_path=''
as $fn$
declare v_revision bigint;
begin
 insert into ganaderov_private.sync_heads_v1(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 update ganaderov_private.sync_heads_v1 set head=head+1 where owner_id=p_owner returning head into v_revision;
 insert into ganaderov_private.sync_changes_v1 values(p_owner,v_revision,p_kind,p_id,p_deleted,p_record);
 if exists(select 1 from ganaderov_private.sync_heads_v1 where owner_id=p_owner and head-checkpoint_size>=10000) then
   perform ganaderov_private.compact_feed_v1(p_owner);
 end if;
end;
$fn$;
create or replace function ganaderov_private.pull_changes_v1(p_owner uuid,p_after bigint,p_epoch uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_head bigint; v_epoch uuid; v_rows jsonb; v_next bigint;
begin
 if auth.uid() is null or not exists(select 1 from public.ranch_members m where m.owner_id=p_owner and m.user_id=auth.uid() and m.status='active') then raise exception 'Membership required' using errcode='42501'; end if;
 if p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid cursor' using errcode='22023'; end if;
 -- Empty ranches also need a stable epoch.
 insert into ganaderov_private.sync_heads_v1(owner_id) values(p_owner) on conflict(owner_id) do nothing;
 select h.head,h.epoch into v_head,v_epoch from ganaderov_private.sync_heads_v1 h where h.owner_id=p_owner for share;
 if (p_epoch is null and p_after<>0) or (p_epoch is not null and p_epoch<>v_epoch) or p_after>v_head then
  return jsonb_build_object('protocolVersion',1,'status','reset_required','epoch',v_epoch,'head',v_head);
 end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.revision),'[]'::jsonb),coalesce(max(q.revision),p_after)
 into v_rows,v_next from (select revision,kind,entity_id,deleted,record from ganaderov_private.sync_changes_v1 where owner_id=p_owner and revision>p_after and revision<=v_head order by revision limit p_limit) q;
 return jsonb_build_object('protocolVersion',1,'status','ok','epoch',v_epoch,'head',v_head,'nextCursor',v_next,'hasMore',v_next<v_head,'changes',v_rows);
end;
$fn$;
commit;
