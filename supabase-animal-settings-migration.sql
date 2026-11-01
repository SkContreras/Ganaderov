-- Additive migration for versioned, per-ranch animal field configuration.
-- Test on a staging project before applying in production.
-- Existing animal, event, journey, and photo records are not modified.

create table if not exists public.ranch_animal_configs (
  owner_id uuid primary key references public.ranches (owner_id) on delete cascade,
  config jsonb not null default '{"schemaVersion":1,"modules":{},"fields":{},"layout":{}}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint ranch_animal_configs_config_object check (jsonb_typeof(config) = 'object')
);

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
as $$
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
      or coalesce((p_config->>'schemaVersion')::integer, 0) <> 1
      or jsonb_typeof(p_config->'modules') is distinct from 'object'
      or jsonb_typeof(p_config->'fields') is distinct from 'object'
      or jsonb_typeof(p_config->'layout') is distinct from 'object' then
    raise exception 'La configuración de campos tiene un formato inválido.'
      using errcode = '22023';
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
$$;

revoke all on function public.save_ranch_animal_config(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_ranch_animal_config(uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
