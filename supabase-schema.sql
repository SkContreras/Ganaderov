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
as $$
begin
  new.modified_at = now();
  return new;
end;
$$;

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
