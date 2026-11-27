begin;
do $$ begin
 if has_column_privilege('authenticated','public.ranches','join_code','SELECT') then raise exception 'Join code exposed'; end if;
 if not has_column_privilege('authenticated','public.ranches','display_name','SELECT') then raise exception 'Ranch name inaccessible'; end if;
 if has_function_privilege('anon','public.sync_apply_operation(jsonb)','EXECUTE') then raise exception 'Anonymous write'; end if;
 if has_function_privilege('anon','public.sync_read_entity(uuid,text,text)','EXECUTE') then raise exception 'Anonymous entity read'; end if;
 if has_table_privilege('authenticated','ganaderov_private.entity_history','SELECT') then raise exception 'History exposed'; end if;
 if has_table_privilege('authenticated','ganaderov_private.operation_audit','SELECT') then raise exception 'Audit exposed'; end if;
end $$;
rollback;
