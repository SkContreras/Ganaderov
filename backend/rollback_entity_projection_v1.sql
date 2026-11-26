-- Staging only; drops only derived data, never source records or receipts.
begin;
lock table public.animal_sync_records,public.journey_sync_records in share row exclusive mode;
drop trigger if exists project_animal_v1_after on public.animal_sync_records;
drop trigger if exists project_journey_v1_after on public.journey_sync_records;
drop function if exists ganaderov_private.mirror_animal_v1();
drop function if exists ganaderov_private.mirror_journey_v1();
drop function if exists ganaderov_private.project_animal_v1(public.animal_sync_records);
drop function if exists ganaderov_private.project_journey_v1(public.journey_sync_records);
drop table if exists ganaderov_private.animal_events_v1,ganaderov_private.animal_photos_v1,ganaderov_private.animal_forecasts_v1,ganaderov_private.journey_attendance_v1;
drop table if exists ganaderov_private.animals_v1,ganaderov_private.journeys_v1;
commit;
