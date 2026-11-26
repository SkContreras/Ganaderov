-- Candidate for isolated staging only. Apply after the current schema and
-- sync_event_create_v1.sql. Legacy tables remain the sole write authority.
begin;
lock table public.animal_sync_records, public.journey_sync_records in share row exclusive mode;
create schema if not exists ganaderov_private;
revoke all on schema ganaderov_private from public, anon;
-- Preserve the authenticated USAGE required by the previous RPC, but grant no
-- access to projection tables.
create table ganaderov_private.animals_v1 (
 owner_id uuid not null, animal_id text not null, source_modified_at timestamptz not null,
 deleted_at timestamptz, fields jsonb,
 primary key(owner_id,animal_id),
 check (deleted_at is not null or jsonb_typeof(fields)='object')
);
create table ganaderov_private.animal_events_v1 (
 owner_id uuid not null, animal_id text not null, event_id text not null,
 position bigint not null, data jsonb not null,
 primary key(owner_id,animal_id,event_id),
 foreign key(owner_id,animal_id) references ganaderov_private.animals_v1 on delete cascade
);
create table ganaderov_private.animal_photos_v1 (
 owner_id uuid not null, animal_id text not null, photo_id text not null,
 position bigint not null, data jsonb not null,
 primary key(owner_id,animal_id,photo_id),
 foreign key(owner_id,animal_id) references ganaderov_private.animals_v1 on delete cascade
);
create table ganaderov_private.animal_forecasts_v1 (
 owner_id uuid not null, animal_id text not null, forecast_id text not null,
 position bigint not null, data jsonb not null,
 primary key(owner_id,animal_id,forecast_id),
 foreign key(owner_id,animal_id) references ganaderov_private.animals_v1 on delete cascade
);
create table ganaderov_private.journeys_v1 (
 owner_id uuid not null, journey_id text not null, source_updated_at timestamptz not null,
 fields jsonb not null, primary key(owner_id,journey_id)
);
create table ganaderov_private.journey_attendance_v1 (
 owner_id uuid not null, journey_id text not null, animal_id text not null,
 position bigint not null, data jsonb not null,
 primary key(owner_id,journey_id,animal_id),
 foreign key(owner_id,journey_id) references ganaderov_private.journeys_v1 on delete cascade
);
alter table ganaderov_private.animals_v1 enable row level security;
alter table ganaderov_private.animal_events_v1 enable row level security;
alter table ganaderov_private.animal_photos_v1 enable row level security;
alter table ganaderov_private.animal_forecasts_v1 enable row level security;
alter table ganaderov_private.journeys_v1 enable row level security;
alter table ganaderov_private.journey_attendance_v1 enable row level security;
revoke all on ganaderov_private.animals_v1, ganaderov_private.animal_events_v1,
 ganaderov_private.animal_photos_v1,ganaderov_private.animal_forecasts_v1,
 ganaderov_private.journeys_v1,ganaderov_private.journey_attendance_v1 from public,anon,authenticated;
create index animal_events_v1_lookup on ganaderov_private.animal_events_v1(owner_id,event_id);

-- Preserve complete legacy child objects and ordering, including unknown fields.
-- Reject malformed records rather than silently dropping children.
create function ganaderov_private.project_animal_v1(p public.animal_sync_records)
returns void language plpgsql security invoker set search_path=''
as $fn$
declare k text; children jsonb;
begin
 if p.deleted_at is null then
   if jsonb_typeof(p.payload->'animal') is distinct from 'object'
      or p.payload->'animal'->>'id' is distinct from p.animal_id then
     raise exception 'Invalid animal identity: %',p.animal_id;
   end if;
   foreach k in array array['events','photos','forecasts'] loop
     children:=coalesce(p.payload->k,'[]'::jsonb);
     if jsonb_typeof(children) is distinct from 'array' then raise exception 'Invalid child array: %',k; end if;
     if exists(select 1 from jsonb_array_elements(children) e where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'id') is distinct from 'string' or coalesce(e->>'id','')='' or (e ? 'animalId' and e->>'animalId' is distinct from p.animal_id)) then
       raise exception 'Invalid child identity: % / %',p.animal_id,k;
     end if;
   end loop;
 end if;
 insert into ganaderov_private.animals_v1 values(p.owner_id,p.animal_id,p.modified_at,p.deleted_at,case when p.deleted_at is null then p.payload->'animal' else null end)
 on conflict(owner_id,animal_id) do update set source_modified_at=excluded.source_modified_at,deleted_at=excluded.deleted_at,fields=excluded.fields;
 delete from ganaderov_private.animal_events_v1 x where x.owner_id=p.owner_id and x.animal_id=p.animal_id;
 delete from ganaderov_private.animal_photos_v1 x where x.owner_id=p.owner_id and x.animal_id=p.animal_id;
 delete from ganaderov_private.animal_forecasts_v1 x where x.owner_id=p.owner_id and x.animal_id=p.animal_id;
 if p.deleted_at is not null then return; end if;
 insert into ganaderov_private.animal_events_v1 select p.owner_id,p.animal_id,e.value->>'id',e.ordinality,e.value from jsonb_array_elements(coalesce(p.payload->'events','[]')) with ordinality e;
 insert into ganaderov_private.animal_photos_v1 select p.owner_id,p.animal_id,e.value->>'id',e.ordinality,e.value from jsonb_array_elements(coalesce(p.payload->'photos','[]')) with ordinality e;
 insert into ganaderov_private.animal_forecasts_v1 select p.owner_id,p.animal_id,e.value->>'id',e.ordinality,e.value from jsonb_array_elements(coalesce(p.payload->'forecasts','[]')) with ordinality e;
end;
$fn$;
create function ganaderov_private.project_journey_v1(p public.journey_sync_records)
returns void language plpgsql security invoker set search_path=''
as $fn$
begin
 if p.payload->>'id' is distinct from p.journey_id or jsonb_typeof(p.payload->'roster') is distinct from 'array' then raise exception 'Invalid journey: %',p.journey_id; end if;
 if exists(select 1 from jsonb_array_elements(p.payload->'roster') e where jsonb_typeof(e->'id') is distinct from 'string' or coalesce(e->>'id','')='') then raise exception 'Invalid roster identity'; end if;
 insert into ganaderov_private.journeys_v1 values(p.owner_id,p.journey_id,p.updated_at,p.payload-'roster')
 on conflict(owner_id,journey_id) do update set source_updated_at=excluded.source_updated_at,fields=excluded.fields;
 delete from ganaderov_private.journey_attendance_v1 x where x.owner_id=p.owner_id and x.journey_id=p.journey_id;
 insert into ganaderov_private.journey_attendance_v1 select p.owner_id,p.journey_id,e.value->>'id',e.ordinality,e.value from jsonb_array_elements(p.payload->'roster') with ordinality e;
end;
$fn$;
revoke all on function ganaderov_private.project_animal_v1(public.animal_sync_records),ganaderov_private.project_journey_v1(public.journey_sync_records) from public,anon,authenticated;

-- Initial projection is taken while source writes are blocked.
do $backfill$
declare a public.animal_sync_records; j public.journey_sync_records;
begin
 for a in select * from public.animal_sync_records loop perform ganaderov_private.project_animal_v1(a); end loop;
 for j in select * from public.journey_sync_records loop perform ganaderov_private.project_journey_v1(j); end loop;
end;
$backfill$;
-- Trigger-only privileged functions; no callable client entry point.
create function ganaderov_private.mirror_animal_v1()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
 if tg_op='DELETE' then
   delete from ganaderov_private.animals_v1 where owner_id=old.owner_id and animal_id=old.animal_id;
   return old;
 end if;
 if tg_op='UPDATE' then
   if (old.owner_id,old.animal_id) is distinct from (new.owner_id,new.animal_id) then
     delete from ganaderov_private.animals_v1 where owner_id=old.owner_id and animal_id=old.animal_id;
   end if;
 end if;
 perform ganaderov_private.project_animal_v1(new); return new;
end;
$fn$;
create function ganaderov_private.mirror_journey_v1()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
 if tg_op='DELETE' then
   delete from ganaderov_private.journeys_v1 where owner_id=old.owner_id and journey_id=old.journey_id;
   return old;
 end if;
 if tg_op='UPDATE' then
   if (old.owner_id,old.journey_id) is distinct from (new.owner_id,new.journey_id) then
     delete from ganaderov_private.journeys_v1 where owner_id=old.owner_id and journey_id=old.journey_id;
   end if;
 end if;
 perform ganaderov_private.project_journey_v1(new); return new;
end;
$fn$;
revoke all on function ganaderov_private.mirror_animal_v1(),ganaderov_private.mirror_journey_v1() from public,anon,authenticated;
create trigger project_animal_v1_after after insert or update or delete on public.animal_sync_records for each row execute function ganaderov_private.mirror_animal_v1();
create trigger project_journey_v1_after after insert or update or delete on public.journey_sync_records for each row execute function ganaderov_private.mirror_journey_v1();
commit;
