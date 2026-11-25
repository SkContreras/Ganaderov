-- Validado en PostgreSQL 17 / Supabase: instalación transaccional y migración ganaderov_current_schema (2026-11-25).
-- Ganaderov: compatible con app.js actual (configVersion 4, schemaVersion de transporte 1).
-- Plantillas compartidas: config.layout.preset. Preferencias personales y cotizaciones: localStorage.
-- Proyecciones de peso: payload.forecasts; no requieren una tabla adicional.
-- Ejecutar como una transacción; no elimina registros existentes.
begin;

-- Esquema completo actual de Ganaderov para instalaciones nuevas.
-- Incluye sincronizacion, acceso por rancho, permisos de trabajadores y
-- configuracion revisionada de campos. Para bases existentes, respalda y
-- valida primero en staging: las politicas RLS y los triggers se actualizan.

create table if not exists public.animal_sync_records (
  owner_id uuid not null references auth.users (id) on delete cascade,
  animal_id text not null,
  modified_at timestamptz not null default now(),
  deleted_at timestamptz,
  payload jsonb,
  primary key (owner_id, animal_id),
  constraint animal_sync_payload_for_active_record
    check ((deleted_at is not null) or (payload is not null))
);

alter table public.animal_sync_records enable row level security;

create or replace function public.set_animal_sync_modified_at()
returns trigger
language plpgsql
as $set_animal_sync_modified_at$
begin
  new.modified_at = now();
  return new;
end;
$set_animal_sync_modified_at$;

drop trigger if exists set_animal_sync_modified_at on public.animal_sync_records;
create trigger set_animal_sync_modified_at
  before update on public.animal_sync_records
  for each row execute function public.set_animal_sync_modified_at();

drop policy if exists "Users can read their animal records" on public.animal_sync_records;
create policy "Users can read their animal records"
  on public.animal_sync_records for select
  using (auth.uid() = owner_id);

drop policy if exists "Users can create their animal records" on public.animal_sync_records;
create policy "Users can create their animal records"
  on public.animal_sync_records for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update their animal records" on public.animal_sync_records;
create policy "Users can update their animal records"
  on public.animal_sync_records for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users can delete their animal records" on public.animal_sync_records;
create policy "Users can delete their animal records"
  on public.animal_sync_records for delete
  using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public)
values ('animal-photos', 'animal-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users can read their animal photos" on storage.objects;
create policy "Users can read their animal photos"
  on storage.objects for select
  using (
    bucket_id = 'animal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can add their animal photos" on storage.objects;
create policy "Users can add their animal photos"
  on storage.objects for insert
  with check (
    bucket_id = 'animal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their animal photos" on storage.objects;
create policy "Users can update their animal photos"
  on storage.objects for update
  using (
    bucket_id = 'animal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'animal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their animal photos" on storage.objects;
create policy "Users can delete their animal photos"
  on storage.objects for delete
  using (
    bucket_id = 'animal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create table if not exists public.journey_sync_records (
  owner_id uuid not null references auth.users (id) on delete cascade,
  journey_id text not null,
  updated_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (owner_id, journey_id)
);

alter table public.journey_sync_records enable row level security;

create or replace function public.set_journey_sync_updated_at()
returns trigger
language plpgsql
as $set_journey_sync_updated_at$
begin
  new.updated_at = now();
  return new;
end;
$set_journey_sync_updated_at$;

drop trigger if exists set_journey_sync_updated_at on public.journey_sync_records;
create trigger set_journey_sync_updated_at
  before update on public.journey_sync_records
  for each row execute function public.set_journey_sync_updated_at();

drop policy if exists "Users can read their journeys" on public.journey_sync_records;
create policy "Users can read their journeys"
  on public.journey_sync_records for select
  using (auth.uid() = owner_id);

drop policy if exists "Users can create their journeys" on public.journey_sync_records;
create policy "Users can create their journeys"
  on public.journey_sync_records for insert
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update their journeys" on public.journey_sync_records;
create policy "Users can update their journeys"
  on public.journey_sync_records for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Perfiles, membresias y permisos multiusuario.
-- Additive, non-destructive migration for ranch membership and worker access.
-- Review and test on a Supabase staging project before running in production.
-- Existing owner_id values and animal/photo/journey payloads are preserved.

create table if not exists public.ranches (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  created_at timestamptz not null default now()
);

create table if not exists public.ranch_members (
  owner_id uuid not null references public.ranches (owner_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  role text not null check (role in ('owner', 'admin', 'worker')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id)
);

create unique index if not exists ranch_members_one_active_ranch_per_account
  on public.ranch_members (user_id)
  where status = 'active';

create table if not exists public.ranch_access_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.ranches (owner_id) on delete cascade,
  requester_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  unique (owner_id, requester_id)
);

alter table public.ranches enable row level security;
alter table public.ranch_members enable row level security;
alter table public.ranch_access_requests enable row level security;

create or replace function public.is_ranch_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $is_ranch_member$
  select exists (
    select 1 from public.ranch_members m
    where m.owner_id = p_owner_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$is_ranch_member$;

create or replace function public.is_ranch_admin(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $is_ranch_admin$
  select exists (
    select 1 from public.ranch_members m
    where m.owner_id = p_owner_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$is_ranch_admin$;

create or replace function public.ranch_member_role(p_owner_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $ranch_member_role$
  select m.role
  from public.ranch_members m
  where m.owner_id = p_owner_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
  limit 1;
$ranch_member_role$;

create or replace function public.is_current_ranch_actor(p_owner_id uuid, p_actor jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $is_current_ranch_actor$
  select exists (
    select 1 from public.ranch_members m
    where m.owner_id = p_owner_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.display_name = p_actor->>'label'
      and coalesce(p_actor->>'email', '') = coalesce((select auth.jwt())->>'email', '')
      and p_actor->>'authUserId' = (select auth.uid())::text
  );
$is_current_ranch_actor$;

revoke all on function public.is_ranch_member(uuid) from public, anon;
revoke all on function public.is_ranch_admin(uuid) from public, anon;
revoke all on function public.ranch_member_role(uuid) from public, anon;
revoke all on function public.is_current_ranch_actor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.is_ranch_member(uuid) to authenticated;
grant execute on function public.is_ranch_admin(uuid) to authenticated;
grant execute on function public.ranch_member_role(uuid) to authenticated;

drop policy if exists "Ranch members can read their ranch" on public.ranches;
create policy "Ranch members can read their ranch"
  on public.ranches for select to authenticated
  using (public.is_ranch_member(owner_id));

drop policy if exists "Accounts can read their own membership" on public.ranch_members;
create policy "Accounts can read their own membership"
  on public.ranch_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_ranch_admin(owner_id));

drop policy if exists "Requesters and ranch admins can read access requests" on public.ranch_access_requests;
create policy "Requesters and ranch admins can read access requests"
  on public.ranch_access_requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_ranch_admin(owner_id));

revoke insert, update, delete on public.ranches, public.ranch_members, public.ranch_access_requests from anon, authenticated;
grant select on public.ranches, public.ranch_members, public.ranch_access_requests to authenticated;

create or replace function public.create_my_ranch(p_ranch_name text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $create_my_ranch$
declare
  v_user_id uuid := auth.uid();
  v_ranch public.ranches%rowtype;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para crear un rancho.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_ranch_name, ''))) not between 1 and 120
      or length(trim(coalesce(p_display_name, ''))) not between 1 and 120 then
    raise exception 'Indica el nombre del rancho y el nombre de la persona responsable.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ranch_members m where m.user_id = v_user_id and m.status = 'active') then
    raise exception 'Esta cuenta ya pertenece a un rancho.' using errcode = '23505';
  end if;

  insert into public.ranches (owner_id, display_name)
  values (v_user_id, trim(p_ranch_name))
  returning * into v_ranch;

  insert into public.ranch_members (owner_id, user_id, display_name, role)
  values (v_user_id, v_user_id, trim(p_display_name), 'owner');

  return jsonb_build_object(
    'status', 'active',
    'owner_id', v_ranch.owner_id,
    'ranch_name', v_ranch.display_name,
    'join_code', v_ranch.join_code,
    'role', 'owner',
    'display_name', trim(p_display_name),
    'members', jsonb_build_array(jsonb_build_object(
      'user_id', v_user_id, 'display_name', trim(p_display_name), 'role', 'owner'
    )),
    'requests', '[]'::jsonb
  );
end;
$create_my_ranch$;

create or replace function public.request_ranch_access(p_join_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $request_ranch_access$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_request public.ranch_access_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión para solicitar acceso.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_display_name, ''))) not between 1 and 120
      or length(trim(coalesce(p_join_code, ''))) not between 6 and 40 then
    raise exception 'Indica tu nombre y un código de rancho válido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.ranch_members m where m.user_id = v_user_id and m.status = 'active') then
    raise exception 'Esta cuenta ya pertenece a un rancho.' using errcode = '23505';
  end if;

  select r.owner_id into v_owner_id
  from public.ranches r
  where r.join_code = upper(trim(p_join_code));
  if v_owner_id is null then
    raise exception 'No se encontró un rancho con ese código.' using errcode = 'P0002';
  end if;

  insert into public.ranch_access_requests (owner_id, requester_id, display_name)
  values (v_owner_id, v_user_id, trim(p_display_name))
  on conflict (owner_id, requester_id) do update
    set display_name = excluded.display_name,
        status = 'pending',
        requested_at = now(),
        reviewed_at = null,
        reviewed_by = null
    where public.ranch_access_requests.status = 'rejected'
      or (public.ranch_access_requests.status = 'approved' and exists (
        select 1 from public.ranch_members m
        where m.owner_id = excluded.owner_id
          and m.user_id = excluded.requester_id
          and m.status = 'revoked'
      ))
  returning * into v_request;

  if v_request.id is null then
    select q.* into v_request from public.ranch_access_requests q
    where q.owner_id = v_owner_id and q.requester_id = v_user_id;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'La solicitud anterior ya fue procesada.' using errcode = '23505';
  end if;

  return jsonb_build_object('status', v_request.status, 'owner_id', v_owner_id);
end;
$request_ranch_access$;

create or replace function public.review_ranch_access_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $review_ranch_access_request$
declare
  v_request public.ranch_access_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select q.* into v_request from public.ranch_access_requests q
  where q.id = p_request_id
  for update;
  if not found or not public.is_ranch_admin(v_request.owner_id) then
    raise exception 'No tienes permiso para revisar esta solicitud.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'La solicitud ya fue revisada.' using errcode = '23505';
  end if;
  if p_approve and exists (
    select 1 from public.ranch_members m
    where m.user_id = v_request.requester_id and m.status = 'active'
  ) then
    raise exception 'La cuenta ya pertenece a un rancho.' using errcode = '23505';
  end if;

  if p_approve then
    insert into public.ranch_members (owner_id, user_id, display_name, role)
    values (v_request.owner_id, v_request.requester_id, v_request.display_name, 'worker')
    on conflict (owner_id, user_id) do update
      set display_name = excluded.display_name,
          role = 'worker',
          status = 'active';
  end if;
  update public.ranch_access_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = v_request.id;
end;
$review_ranch_access_request$;

create or replace function public.revoke_ranch_worker(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $revoke_ranch_worker$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select m.owner_id into v_owner_id
  from public.ranch_members m
  where m.user_id = p_user_id and m.status = 'active' and m.role = 'worker';
  if v_owner_id is null or not public.is_ranch_admin(v_owner_id) then
    raise exception 'No tienes permiso para retirar a este trabajador.' using errcode = '42501';
  end if;
  update public.ranch_members
    set status = 'revoked'
    where owner_id = v_owner_id and user_id = p_user_id and role = 'worker';
end;
$revoke_ranch_worker$;

create or replace function public.get_my_ranch_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $get_my_ranch_context$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'status', 'active',
    'owner_id', r.owner_id,
    'ranch_name', r.display_name,
    'join_code', case when m.role in ('owner', 'admin') then r.join_code else null end,
    'role', m.role,
    'display_name', m.display_name,
    'members', case when m.role in ('owner', 'admin') then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', members.user_id,
        'display_name', members.display_name,
        'role', members.role
      ) order by members.created_at), '[]'::jsonb)
      from public.ranch_members members
      where members.owner_id = r.owner_id and members.status = 'active'
    ) else '[]'::jsonb end,
    'requests', case when m.role in ('owner', 'admin') then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', requests.id,
        'requester_id', requests.requester_id,
        'display_name', requests.display_name,
        'requested_at', requests.requested_at
      ) order by requests.requested_at), '[]'::jsonb)
      from public.ranch_access_requests requests
      where requests.owner_id = r.owner_id and requests.status = 'pending'
    ) else '[]'::jsonb end
  ) into v_result
  from public.ranch_members m
  join public.ranches r on r.owner_id = m.owner_id
  where m.user_id = v_user_id and m.status = 'active';

  if v_result is not null then
    return v_result;
  end if;
  if exists (
    select 1 from public.ranch_access_requests q
    where q.requester_id = v_user_id and q.status = 'pending'
  ) then
    return jsonb_build_object('status', 'pending');
  end if;
  return jsonb_build_object('status', 'unassigned');
end;
$get_my_ranch_context$;

revoke all on function public.create_my_ranch(text, text) from public, anon;
revoke all on function public.request_ranch_access(text, text) from public, anon;
revoke all on function public.review_ranch_access_request(uuid, boolean) from public, anon;
revoke all on function public.revoke_ranch_worker(uuid) from public, anon;
revoke all on function public.get_my_ranch_context() from public, anon;
grant execute on function public.create_my_ranch(text, text) to authenticated;
grant execute on function public.request_ranch_access(text, text) to authenticated;
grant execute on function public.review_ranch_access_request(uuid, boolean) to authenticated;
grant execute on function public.revoke_ranch_worker(uuid) to authenticated;
grant execute on function public.get_my_ranch_context() to authenticated;

create or replace function public.validate_worker_animal_sync_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $validate_worker_animal_sync_record$
declare
  v_old_event jsonb;
  v_new_event jsonb;
  v_new_events jsonb;
begin
  if public.ranch_member_role(new.owner_id) is distinct from 'worker' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Los trabajadores no pueden crear ni eliminar fichas de animales.' using errcode = '42501';
  end if;
  if old.deleted_at is not null or new.deleted_at is distinct from old.deleted_at
      or new.owner_id is distinct from old.owner_id
      or new.animal_id is distinct from old.animal_id
      or new.payload->'animal' is distinct from old.payload->'animal'
      or coalesce(new.payload->'photos', '[]'::jsonb) is distinct from coalesce(old.payload->'photos', '[]'::jsonb)
      or coalesce(new.payload->'forecasts', '[]'::jsonb) is distinct from coalesce(old.payload->'forecasts', '[]'::jsonb)
      or (new.payload - 'events' - 'photos' - 'forecasts')
         is distinct from (old.payload - 'events' - 'photos' - 'forecasts')
      or jsonb_typeof(old.payload->'events') is distinct from 'array'
      or jsonb_typeof(new.payload->'events') is distinct from 'array' then
    raise exception 'Los trabajadores solo pueden registrar pesos y tratamientos autorizados.' using errcode = '42501';
  end if;

  v_new_events := new.payload->'events';
  if (select count(*) from jsonb_array_elements(v_new_events))
      <> (select count(distinct value->>'id') from jsonb_array_elements(v_new_events)) then
    raise exception 'Un registro no puede aparecer más de una vez en el historial.' using errcode = '22023';
  end if;
  for v_old_event in select value from jsonb_array_elements(old.payload->'events')
  loop
    select value into v_new_event
      from jsonb_array_elements(v_new_events)
      where value->>'id' = v_old_event->>'id';
    if v_new_event is null then
      raise exception 'Un trabajador no puede eliminar registros existentes.' using errcode = '42501';
    end if;
    if v_new_event is distinct from v_old_event then
      if v_old_event->>'type' <> 'weight'
          or (v_new_event - 'weight' - 'weightUpdatedAt' - 'weightUpdatedBy')
             is distinct from
             (v_old_event - 'weight' - 'weightUpdatedAt' - 'weightUpdatedBy')
          or coalesce(v_new_event->>'weight', '') !~ '^[0-9]+([.][0-9]+)?$'
          or coalesce(v_new_event->>'weightUpdatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          or not public.is_current_ranch_actor(new.owner_id, v_new_event->'weightUpdatedBy') then
        raise exception 'Un trabajador solo puede corregir el peso de una pesada existente.' using errcode = '42501';
      end if;
    end if;
    v_new_event := null;
  end loop;

  for v_new_event in select value from jsonb_array_elements(v_new_events)
  loop
    if not exists (
      select 1 from jsonb_array_elements(old.payload->'events') as existing(value)
      where existing.value->>'id' = v_new_event->>'id'
    ) then
      if v_new_event->>'animalId' is distinct from new.animal_id
          or coalesce(v_new_event->>'type', '') not in ('weight', 'bath', 'vaccine', 'deworm', 'injection', 'medication', 'review')
          or not public.is_current_ranch_actor(new.owner_id, v_new_event->'performedBy')
          or coalesce(v_new_event->>'id', '') = ''
          or coalesce(v_new_event->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or coalesce(v_new_event->>'performedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
          or (v_new_event->>'type' = 'weight'
            and coalesce(v_new_event->>'weight', '') !~ '^[0-9]+([.][0-9]+)?$') then
        raise exception 'El trabajador solo puede agregar sus propios registros de peso o tratamiento.' using errcode = '42501';
      end if;
    end if;
  end loop;

  return new;
end;
$validate_worker_animal_sync_record$;

drop trigger if exists validate_worker_animal_sync_record on public.animal_sync_records;
create trigger validate_worker_animal_sync_record
  before insert or update on public.animal_sync_records
  for each row execute function public.validate_worker_animal_sync_record();

drop policy if exists "Users can read their animal records" on public.animal_sync_records;
drop policy if exists "Users can create their animal records" on public.animal_sync_records;
drop policy if exists "Users can update their animal records" on public.animal_sync_records;
drop policy if exists "Users can delete their animal records" on public.animal_sync_records;
drop policy if exists "Ranch members can read animal records" on public.animal_sync_records;
drop policy if exists "Ranch members can submit animal sync records" on public.animal_sync_records;
drop policy if exists "Ranch members can update permitted animal records" on public.animal_sync_records;
drop policy if exists "Ranch admins can delete animal records" on public.animal_sync_records;
create policy "Ranch members can read animal records"
  on public.animal_sync_records for select to authenticated
  using (public.is_ranch_member(owner_id));
create policy "Ranch members can submit animal sync records"
  on public.animal_sync_records for insert to authenticated
  with check (public.is_ranch_member(owner_id));
create policy "Ranch members can update permitted animal records"
  on public.animal_sync_records for update to authenticated
  using (public.is_ranch_member(owner_id))
  with check (public.is_ranch_member(owner_id));
create policy "Ranch admins can delete animal records"
  on public.animal_sync_records for delete to authenticated
  using (public.is_ranch_admin(owner_id));

create table if not exists public.ranch_animal_configs (
  owner_id uuid primary key references public.ranches (owner_id) on delete cascade,
  config jsonb not null default '{"schemaVersion":1,"modules":{},"fields":{},"layout":{}}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint ranch_animal_configs_config_object check (jsonb_typeof(config) = 'object')
);
alter table public.ranch_animal_configs enable row level security;

-- Match the current app's custom status catalog and legacy fallback.
create or replace function public.ganaderov_animal_status_active(p_owner_id uuid, p_status text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $ganaderov_animal_status_active$
  select coalesce(
    (select case when jsonb_typeof(item->'active') = 'boolean'
                 then (item->>'active')::boolean
                 else coalesce(p_status, '') not in ('Vendido','Fallecido','Baja','Otro','Otros','Desaparecido') end
       from public.ranch_animal_configs c
       cross join lateral jsonb_array_elements(
         case when jsonb_typeof(c.config->'lists'->'status') = 'array'
              then c.config->'lists'->'status' else '[]'::jsonb end
       ) as options(item)
       where c.owner_id = p_owner_id and item->>'value' = p_status
       limit 1),
    coalesce(p_status, '') not in ('Vendido','Fallecido','Baja','Otro','Otros','Desaparecido')
  );
$ganaderov_animal_status_active$;
revoke all on function public.ganaderov_animal_status_active(uuid,text) from public, anon, authenticated;

create or replace function public.validate_worker_journey_sync_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $validate_worker_journey_sync_record$
declare
  v_new_roster jsonb;
  v_old_animal jsonb;
  v_new_animal jsonb;
  v_status text;
begin
  if public.ranch_member_role(new.owner_id) is distinct from 'worker' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.payload->>'id' is distinct from new.journey_id
        or jsonb_typeof(new.payload->'roster') is distinct from 'array'
        or coalesce(new.payload->>'type', '') not in ('bath', 'vaccine', 'deworm', 'injection', 'medication', 'weight', 'review')
        or coalesce(new.payload->>'status', '') <> 'in_progress'
        or new.payload->'completedAt' is distinct from 'null'::jsonb
        or coalesce(new.payload->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'Los trabajadores solo pueden iniciar jornadas permitidas con datos válidos.' using errcode = '42501';
    end if;
    v_new_roster := new.payload->'roster';
    if (select count(*) from jsonb_array_elements(v_new_roster))
        <> (select count(distinct value->>'id') from jsonb_array_elements(v_new_roster)) then
      raise exception 'Un animal no puede aparecer más de una vez en la jornada.' using errcode = '22023';
    end if;
    for v_new_animal in select value from jsonb_array_elements(v_new_roster)
    loop
      if not exists (
        select 1 from public.animal_sync_records a
        where a.owner_id = new.owner_id
          and a.animal_id = v_new_animal->>'id'
          and a.deleted_at is null
          and public.ganaderov_animal_status_active(a.owner_id, a.payload->'animal'->>'status')
          and coalesce(v_new_animal->>'tag', '') = coalesce(a.payload->'animal'->>'tag', '')
          and coalesce(v_new_animal->>'name', '') = coalesce(a.payload->'animal'->>'name', '')
          and coalesce(v_new_animal->>'sex', '') = coalesce(a.payload->'animal'->>'sex', '')
          and coalesce(v_new_animal->>'color', '') = coalesce(a.payload->'animal'->>'color', '')
          and coalesce(v_new_animal->>'status', '') = coalesce(a.payload->'animal'->>'status', '')
      ) or coalesce((v_new_animal->>'attended')::boolean, false)
          or v_new_animal->'attendedAt' is not null
          or v_new_animal->'attendedBy' is not null
          or v_new_animal->'weight' is not null
          or v_new_animal->'weightUpdatedAt' is not null
          or v_new_animal->'weightUpdatedBy' is not null then
        raise exception 'Una jornada nueva solo puede incluir animales activos y pendientes.' using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
      or new.journey_id is distinct from old.journey_id
      or jsonb_typeof(old.payload->'roster') is distinct from 'array'
      or jsonb_typeof(new.payload->'roster') is distinct from 'array'
      or new.payload->'id' is distinct from old.payload->'id'
      or new.payload->>'id' is distinct from new.journey_id
      or (new.payload - 'roster' - 'status' - 'completedAt' - 'completedBy' - 'updatedAt')
         is distinct from
         (old.payload - 'roster' - 'status' - 'completedAt' - 'completedBy' - 'updatedAt') then
    raise exception 'Los trabajadores no pueden cambiar los datos base de una jornada.' using errcode = '42501';
  end if;
  if old.payload->>'status' = 'completed'
      and (new.payload - 'updatedAt') is distinct from (old.payload - 'updatedAt') then
    raise exception 'Una jornada completada no se puede modificar.' using errcode = '42501';
  end if;

  v_new_roster := new.payload->'roster';
  v_status := new.payload->>'status';
  if coalesce(v_status, '') not in ('in_progress', 'incomplete', 'completed')
      or (old.payload->>'status' = 'completed' and v_status <> 'completed')
      or (v_status = 'in_progress' and new.payload->'completedAt' is distinct from 'null'::jsonb)
      or (v_status = 'in_progress' and new.payload->'completedBy' is distinct from old.payload->'completedBy')
      or (v_status in ('incomplete', 'completed') and (
        coalesce(new.payload->>'completedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        or not public.is_current_ranch_actor(new.owner_id, new.payload->'completedBy')
      )) then
    raise exception 'El estado o el responsable de finalización de la jornada no es válido.' using errcode = '42501';
  end if;
  if new.payload->>'type' = 'other' then
    raise exception 'Los trabajadores no pueden administrar actividades personalizadas.' using errcode = '42501';
  end if;
  if (select count(*) from jsonb_array_elements(v_new_roster))
      <> (select count(distinct value->>'id') from jsonb_array_elements(v_new_roster)) then
    raise exception 'Un animal no puede aparecer más de una vez en la jornada.' using errcode = '22023';
  end if;
  if (v_status = 'completed' and exists (
        select 1 from jsonb_array_elements(v_new_roster) as roster(value)
        where not coalesce((roster.value->>'attended')::boolean, false)
      ))
      or (v_status = 'incomplete' and not exists (
        select 1 from jsonb_array_elements(v_new_roster) as roster(value)
        where not coalesce((roster.value->>'attended')::boolean, false)
      )) then
    raise exception 'El estado final debe corresponder con los animales pendientes.' using errcode = '22023';
  end if;

  for v_old_animal in select value from jsonb_array_elements(old.payload->'roster')
  loop
    select value into v_new_animal
      from jsonb_array_elements(v_new_roster)
      where value->>'id' = v_old_animal->>'id';
    if v_new_animal is null then
      raise exception 'Un trabajador no puede quitar animales de una jornada existente.' using errcode = '42501';
    end if;
    if coalesce(old.payload->>'status', '') <> 'in_progress' and v_new_animal is distinct from v_old_animal then
      raise exception 'Reanuda la jornada antes de modificar su progreso.' using errcode = '42501';
    end if;
    if (v_new_animal - 'attended' - 'attendedAt' - 'attendedBy' - 'weight' - 'weightUpdatedAt' - 'weightUpdatedBy')
        is distinct from
       (v_old_animal - 'attended' - 'attendedAt' - 'attendedBy' - 'weight' - 'weightUpdatedAt' - 'weightUpdatedBy')
        or (coalesce((v_old_animal->>'attended')::boolean, false)
          and not coalesce((v_new_animal->>'attended')::boolean, false)) then
      raise exception 'Un trabajador no puede cambiar la identidad ni revertir la atención de un animal.' using errcode = '42501';
    end if;
    if v_new_animal->'attended' is distinct from v_old_animal->'attended'
        or v_new_animal->'attendedAt' is distinct from v_old_animal->'attendedAt'
        or v_new_animal->'attendedBy' is distinct from v_old_animal->'attendedBy' then
      if coalesce((v_old_animal->>'attended')::boolean, false)
          or not coalesce((v_new_animal->>'attended')::boolean, false)
          or not public.is_current_ranch_actor(new.owner_id, v_new_animal->'attendedBy')
          or coalesce(v_new_animal->>'attendedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
        raise exception 'La atención debe registrar al trabajador autenticado y su hora.' using errcode = '42501';
      end if;
    end if;
    if v_new_animal->'weight' is distinct from v_old_animal->'weight'
        or v_new_animal->'weightUpdatedAt' is distinct from v_old_animal->'weightUpdatedAt'
        or v_new_animal->'weightUpdatedBy' is distinct from v_old_animal->'weightUpdatedBy' then
      if (coalesce(new.payload->>'type', '') <> 'weight'
          or coalesce(v_new_animal->>'weight', '') !~ '^[0-9]+([.][0-9]+)?$'
          or not public.is_current_ranch_actor(new.owner_id, v_new_animal->'weightUpdatedBy')
          or coalesce(v_new_animal->>'weightUpdatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') then
        raise exception 'Solo se puede registrar o corregir el peso durante una jornada de pesaje.' using errcode = '42501';
      end if;
    end if;
    v_new_animal := null;
  end loop;

  for v_new_animal in select value from jsonb_array_elements(v_new_roster)
  loop
    if not exists (
      select 1 from jsonb_array_elements(old.payload->'roster') as existing(value)
      where existing.value->>'id' = v_new_animal->>'id'
    ) then
      if coalesce(old.payload->>'status', '') <> 'in_progress' or not exists (
        select 1 from public.animal_sync_records a
        where a.owner_id = new.owner_id
          and a.animal_id = v_new_animal->>'id'
          and a.deleted_at is null
          and public.ganaderov_animal_status_active(a.owner_id, a.payload->'animal'->>'status')
          and coalesce(v_new_animal->>'tag', '') = coalesce(a.payload->'animal'->>'tag', '')
          and coalesce(v_new_animal->>'name', '') = coalesce(a.payload->'animal'->>'name', '')
          and coalesce(v_new_animal->>'sex', '') = coalesce(a.payload->'animal'->>'sex', '')
          and coalesce(v_new_animal->>'color', '') = coalesce(a.payload->'animal'->>'color', '')
          and coalesce(v_new_animal->>'status', '') = coalesce(a.payload->'animal'->>'status', '')
      ) or coalesce((v_new_animal->>'attended')::boolean, false)
          or v_new_animal->'attendedAt' is not null
          or v_new_animal->'attendedBy' is not null
          or v_new_animal->'weight' is not null
          or v_new_animal->'weightUpdatedAt' is not null
          or v_new_animal->'weightUpdatedBy' is not null then
        raise exception 'Solo se pueden agregar animales activos y pendientes a la jornada.' using errcode = '42501';
      end if;
    end if;
  end loop;

  return new;
end;
$validate_worker_journey_sync_record$;

drop trigger if exists validate_worker_journey_sync_record on public.journey_sync_records;
create trigger validate_worker_journey_sync_record
  before insert or update on public.journey_sync_records
  for each row execute function public.validate_worker_journey_sync_record();

drop policy if exists "Users can read their journeys" on public.journey_sync_records;
drop policy if exists "Users can create their journeys" on public.journey_sync_records;
drop policy if exists "Users can update their journeys" on public.journey_sync_records;
drop policy if exists "Ranch members can read their journeys" on public.journey_sync_records;
drop policy if exists "Ranch members can create their journeys" on public.journey_sync_records;
drop policy if exists "Ranch members can update their journeys" on public.journey_sync_records;
create policy "Ranch members can read their journeys"
  on public.journey_sync_records for select to authenticated
  using (public.is_ranch_member(owner_id));
create policy "Ranch members can create their journeys"
  on public.journey_sync_records for insert to authenticated
  with check (public.is_ranch_member(owner_id));
create policy "Ranch members can update their journeys"
  on public.journey_sync_records for update to authenticated
  using (public.is_ranch_member(owner_id))
  with check (public.is_ranch_member(owner_id));

drop policy if exists "Users can read their animal photos" on storage.objects;
drop policy if exists "Users can add their animal photos" on storage.objects;
drop policy if exists "Users can update their animal photos" on storage.objects;
drop policy if exists "Users can delete their animal photos" on storage.objects;
drop policy if exists "Ranch members can read animal photos" on storage.objects;
drop policy if exists "Ranch admins can add animal photos" on storage.objects;
drop policy if exists "Ranch admins can update animal photos" on storage.objects;
drop policy if exists "Ranch admins can delete animal photos" on storage.objects;
create policy "Ranch members can read animal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'animal-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_ranch_member(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
create policy "Ranch admins can add animal photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'animal-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_ranch_admin(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
create policy "Ranch admins can update animal photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'animal-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_ranch_admin(((storage.foldername(name))[1])::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'animal-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_ranch_admin(((storage.foldername(name))[1])::uuid)
      else false
    end
  );
create policy "Ranch admins can delete animal photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'animal-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_ranch_admin(((storage.foldername(name))[1])::uuid)
      else false
    end
  );

-- Configuracion sincronizada de campos por rancho.
-- Additive migration for versioned, per-ranch animal field configuration.
-- Test on a staging project before applying in production.
-- Existing animal, event, journey, and photo records are not modified.

-- La tabla se crea antes de los validadores de jornadas.

alter table public.ranch_animal_configs enable row level security;

drop policy if exists "Ranch members can read animal settings" on public.ranch_animal_configs;
create policy "Ranch members can read animal settings"
  on public.ranch_animal_configs for select to authenticated
  using (public.is_ranch_member(owner_id));

revoke all on public.ranch_animal_configs from anon, authenticated;
grant select on public.ranch_animal_configs to authenticated;

create or replace function public.save_ranch_animal_config(
  p_owner_id uuid,
  p_expected_revision integer,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $save_ranch_animal_config$
declare
  v_revision integer;
  v_updated_at timestamptz;
begin
  if not public.is_ranch_admin(p_owner_id) then
    raise exception 'Solo el propietario o administrador puede configurar los campos del rancho.'
      using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
      or p_config is null or jsonb_typeof(p_config) is distinct from 'object'
      or p_config->'schemaVersion' is distinct from '1'::jsonb
      or (p_config ? 'configVersion' and p_config->'configVersion' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb))
      or (p_config ? 'lists' and jsonb_typeof(p_config->'lists') is distinct from 'object')
      or jsonb_typeof(p_config->'modules') is distinct from 'object'
      or jsonb_typeof(p_config->'fields') is distinct from 'object'
      or jsonb_typeof(p_config->'layout') is distinct from 'object' then
    raise exception 'La configuración de campos tiene un formato inválido.'
      using errcode = '22023';
  end if;

  -- v4 lists contain arrays of option objects; legacy payloads may omit lists.
  if exists (
    select 1 from jsonb_each(coalesce(p_config->'lists','{}'::jsonb)) as l(key, options)
    where jsonb_typeof(options) is distinct from 'array'
  ) then
    raise exception 'Las listas de configuración deben ser arreglos.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(coalesce(p_config->'lists','{}'::jsonb)) as l(key, options)
    cross join lateral jsonb_array_elements(options) as o(item)
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'value') is distinct from 'string'
      or jsonb_typeof(item->'label') is distinct from 'string'
      or jsonb_typeof(item->'enabled') is distinct from 'boolean'
      or (item ? 'active' and jsonb_typeof(item->'active') is distinct from 'boolean')
  ) then
    raise exception 'Una opción de lista tiene un formato inválido.' using errcode = '22023';
  end if;

  insert into public.ranch_animal_configs (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  select revision into v_revision
  from public.ranch_animal_configs
  where owner_id = p_owner_id
  for update;

  if v_revision is distinct from p_expected_revision then
    raise exception 'La configuración cambió en otro dispositivo. Vuelve a cargarla antes de guardar.'
      using errcode = '40001';
  end if;

  update public.ranch_animal_configs
  set config = p_config,
      revision = revision + 1,
      updated_at = now()
  where owner_id = p_owner_id
  returning revision, updated_at into v_revision, v_updated_at;

  return jsonb_build_object(
    'owner_id', p_owner_id,
    'config', p_config,
    'revision', v_revision,
    'updated_at', v_updated_at
  );
end;
$save_ranch_animal_config$;

revoke all on function public.save_ranch_animal_config(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_ranch_animal_config(uuid, integer, jsonb) to authenticated;

-- Explicit API grants: do not depend on automatic exposure defaults.
revoke all on public.animal_sync_records, public.journey_sync_records from public, anon, authenticated;
grant select, insert, update, delete on public.animal_sync_records to authenticated;
grant select, insert, update on public.journey_sync_records to authenticated;
revoke all on public.ranches, public.ranch_members, public.ranch_access_requests from public, anon, authenticated;
grant select on public.ranches, public.ranch_members, public.ranch_access_requests to authenticated;
revoke all on function public.validate_worker_animal_sync_record() from public, anon, authenticated;
revoke all on function public.validate_worker_journey_sync_record() from public, anon, authenticated;
revoke all on function public.set_animal_sync_modified_at() from public, anon, authenticated;
revoke all on function public.set_journey_sync_updated_at() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
