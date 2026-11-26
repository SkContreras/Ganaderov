-- Read-only parity checks. All discrepancy counts must be zero.
-- Run as staging database administrator, not a client role.
with animal_actual as (
 select a.owner_id,a.animal_id,a.modified_at,a.deleted_at,
 case when a.deleted_at is null then a.payload->'animal' else null end fields,
 case when a.deleted_at is null then coalesce(a.payload->'events','[]'::jsonb) else '[]'::jsonb end events,
 case when a.deleted_at is null then coalesce(a.payload->'photos','[]'::jsonb) else '[]'::jsonb end photos,
 case when a.deleted_at is null then coalesce(a.payload->'forecasts','[]'::jsonb) else '[]'::jsonb end forecasts
 from public.animal_sync_records a
), animal_projected as (
 select a.owner_id,a.animal_id,a.source_modified_at as modified_at,a.deleted_at,a.fields,
 coalesce((select jsonb_agg(e.data order by e.position) from ganaderov_private.animal_events_v1 e where e.owner_id=a.owner_id and e.animal_id=a.animal_id),'[]') events,
 coalesce((select jsonb_agg(e.data order by e.position) from ganaderov_private.animal_photos_v1 e where e.owner_id=a.owner_id and e.animal_id=a.animal_id),'[]') photos,
 coalesce((select jsonb_agg(e.data order by e.position) from ganaderov_private.animal_forecasts_v1 e where e.owner_id=a.owner_id and e.animal_id=a.animal_id),'[]') forecasts
 from ganaderov_private.animals_v1 a
), journey_projected as (
 select j.owner_id,j.journey_id,j.source_updated_at as updated_at,
 j.fields||jsonb_build_object('roster',coalesce((select jsonb_agg(e.data order by e.position) from ganaderov_private.journey_attendance_v1 e where e.owner_id=j.owner_id and e.journey_id=j.journey_id),'[]')) payload
 from ganaderov_private.journeys_v1 j
)
select 'animal_missing_or_changed' check_name,count(*) discrepancies from (select * from animal_actual except select * from animal_projected) x
union all select 'animal_extra_or_changed',count(*) from (select * from animal_projected except select * from animal_actual) x
union all select 'journey_missing_or_changed',count(*) from (select owner_id,journey_id,updated_at,payload from public.journey_sync_records except select * from journey_projected) x
union all select 'journey_extra_or_changed',count(*) from (select * from journey_projected except select owner_id,journey_id,updated_at,payload from public.journey_sync_records) x;
-- Legacy child IDs may be scoped per animal. Detect ambiguous IDs before any
-- later global unique constraint or cutover; do not discard duplicates.
select owner_id,event_id,count(*) from ganaderov_private.animal_events_v1 group by owner_id,event_id having count(*)>1;
