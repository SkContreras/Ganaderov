-- Candidate for disposable staging; no removal of legacy client write privileges.
begin;
alter function public.set_animal_sync_modified_at() set search_path='';
alter function public.set_journey_sync_updated_at() set search_path='';
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
   execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
 end if;
end $$;
-- Ranch members must not be able to fetch the join code directly.
-- Managers obtain it via get_my_ranch_context(), which checks their role.
revoke select on public.ranches from public,anon,authenticated;
grant select(owner_id,display_name,created_at) on public.ranches to authenticated;
commit;
