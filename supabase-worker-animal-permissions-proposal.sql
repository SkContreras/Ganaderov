-- Propuesta opcional (aditiva) para ampliar permisos de trabajadores sin tocar columnas.
-- No se ejecuta automáticamente desde la app.
-- Requiere validación en staging antes de aplicarse en producción.

-- Estado actual (supabase-ranch-access-migration.sql):
--   * validate_worker_animal_sync_record bloquea cualquier cambio en payload.animal.
--   * El trabajador solo puede agregar/corregir eventos operativos permitidos.

-- Esta función define la lista propuesta de campos del animal que un trabajador
-- podría editar en una etapa posterior, sin abrir datos críticos.
create or replace function public.worker_editable_animal_fields()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array[
    'lot',            -- lote actual
    'paddock',        -- potrero actual
    'pen',            -- corral actual
    'locationSince',  -- fecha de entrada a ubicación
    'responsible',    -- responsable actual
    'generalNotes'    -- observaciones generales operativas
  ]::text[];
$$;

revoke all on function public.worker_editable_animal_fields() from public, anon;
grant execute on function public.worker_editable_animal_fields() to authenticated;

-- Integración sugerida (manual, en una migración posterior):
-- 1) En validate_worker_animal_sync_record, sustituir la comparación rígida
--    `new.payload->'animal' is distinct from old.payload->'animal'`
--    por una comparación JSONB que permita exclusivamente las claves de
--    public.worker_editable_animal_fields(), además de updatedAt/updatedBy.
-- 2) Validar tipos de esos campos (texto/fecha), actor (updatedBy) y marca de tiempo.
-- 3) Mantener bloqueados internalId, birthDate, birthEstimated, estimatedAge,
--    originType/originName, motherId/fatherId, status, exitReason/exitNotes,
--    createdAt/createdBy y cualquier otro campo automático.
-- 4) Probar con cuentas owner/admin/worker y escenarios de conflicto de sincronización.
