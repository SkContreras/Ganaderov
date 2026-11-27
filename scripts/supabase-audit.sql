-- Read-only deployment evidence. Contains counts and catalog metadata only.
-- Run against an existing Ganaderov base schema, before and after migration.
begin transaction read only;
set local statement_timeout = '30s';
with expected_rpc(signature) as (
  values
    ('public.sync_apply_operation(jsonb)'),
    ('public.sync_read_entity(uuid,text,text)'),
    ('public.sync_read_event_audit(uuid,integer,timestamp with time zone,uuid)'),
    ('public.sync_pull_changes(uuid,bigint,uuid,integer)'),
    ('public.finish_ranch_journey_v1(uuid,text,timestamp with time zone,boolean)'),
    ('public.resume_ranch_journey_v1(uuid,text,timestamp with time zone)')
), source_tables(name) as (
  values ('animal_sync_records'), ('journey_sync_records'), ('ranches'),
    ('ranch_members'), ('ranch_access_requests'), ('ranch_animal_configs')
), child_arrays as (
  select a.owner_id, a.animal_id, k.kind,
    case when jsonb_typeof(a.payload->k.kind)='array'
      then a.payload->k.kind else '[]'::jsonb end as children
  from public.animal_sync_records a
  cross join (values ('events'), ('photos'), ('forecasts')) k(kind)
  where a.deleted_at is null
), children as (
  select c.owner_id, c.animal_id, c.kind, e.value
  from child_arrays c cross join lateral jsonb_array_elements(c.children) e
), roster as (
  select j.owner_id, j.journey_id, e.value
  from public.journey_sync_records j
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(j.payload->'roster')='array'
      then j.payload->'roster' else '[]'::jsonb end) e
)
select jsonb_build_object(
  'capturedAt', clock_timestamp(),
  'databaseVersion', current_setting('server_version'),
  'privateSchemaInstalled', to_regnamespace('ganaderov_private') is not null,
  'rowCounts', jsonb_build_object(
    'animal_sync_records', (select count(*) from public.animal_sync_records),
    'journey_sync_records', (select count(*) from public.journey_sync_records),
    'ranches', (select count(*) from public.ranches),
    'ranch_members', (select count(*) from public.ranch_members),
    'ranch_access_requests', (select count(*) from public.ranch_access_requests),
    'ranch_animal_configs', (select count(*) from public.ranch_animal_configs)),
  'sourceRls', (select jsonb_agg(jsonb_build_object(
    'table', t.name, 'enabled', c.relrowsecurity,
    'policyCount', (select count(*) from pg_policy p where p.polrelid=c.oid)) order by t.name)
    from source_tables t left join pg_class c on c.oid=to_regclass('public.'||t.name)),
  'privateRls', (select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname, 'enabled', c.relrowsecurity) order by c.relname),'[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='ganaderov_private' and c.relkind in ('r','p')),
  'expectedRpc', (select jsonb_agg(jsonb_build_object(
    'signature', signature, 'installed', to_regprocedure(signature) is not null)) from expected_rpc),
  'functions', (select coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname,
    'arguments', pg_get_function_identity_arguments(p.oid),
    'returnType', pg_get_function_result(p.oid),
    'securityDefiner', p.prosecdef, 'settings', p.proconfig,
    'anonExecute', has_function_privilege('anon',p.oid,'execute'),
    'authenticatedExecute', has_function_privilege('authenticated',p.oid,'execute'),
    'definitionMd5', md5(pg_get_functiondef(p.oid))) order by n.nspname,p.proname),'[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','ganaderov_private') and p.prokind='f'),
  'photoBucket', (select to_jsonb(b) from (
    select id, public, file_size_limit, allowed_mime_types
    from storage.buckets where id='animal-photos') b),
  'storagePolicies', (select coalesce(jsonb_agg(jsonb_build_object(
    'name', policyname, 'command', cmd, 'roles', roles,
    'using', qual, 'check', with_check) order by policyname),'[]'::jsonb)
    from pg_policies where schemaname='storage' and tablename='objects'),
  'jsonSchemaExtension', (select to_jsonb(e) from (
    select name, default_version, installed_version
    from pg_available_extensions where name='pg_jsonschema') e),
  'projectionPreflight', jsonb_build_object(
    'invalidAnimals', (select count(*) from public.animal_sync_records a where a.deleted_at is null and (
      jsonb_typeof(a.payload->'animal') is distinct from 'object'
      or a.payload->'animal'->>'id' is distinct from a.animal_id
      or exists(select 1 from (values ('events'),('photos'),('forecasts')) k(kind)
        where jsonb_typeof(coalesce(a.payload->k.kind,'[]'::jsonb)) is distinct from 'array'))),
    'invalidChildren', (select count(*) from children where
      jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(value->'id') is distinct from 'string'
      or coalesce(value->>'id','')='' or (value ? 'animalId' and value->>'animalId' is distinct from animal_id)),
    'duplicateChildrenWithinAnimal', (select count(*) from (
      select owner_id,animal_id,kind,value->>'id' from children
      group by owner_id,animal_id,kind,value->>'id' having count(*)>1) d),
    'duplicateChildIdsWithinRanch', (select count(*) from (
      select owner_id,kind,value->>'id' from children
      group by owner_id,kind,value->>'id' having count(*)>1) d),
    'invalidJourneys', (select count(*) from public.journey_sync_records j where
      j.payload->>'id' is distinct from j.journey_id or jsonb_typeof(j.payload->'roster') is distinct from 'array'),
    'invalidRosterItems', (select count(*) from roster where
      jsonb_typeof(value->'id') is distinct from 'string' or coalesce(value->>'id','')=''),
    'duplicateRosterIds', (select count(*) from (
      select owner_id,journey_id,value->>'id' from roster
      group by owner_id,journey_id,value->>'id' having count(*)>1) d))
) as audit;
commit;
