-- Fix: restore FK constraint on mmc_leads.modelo_id
-- The CASCADE in schema_v5_catalog.sql (DROP TABLE mmc_models CASCADE) dropped
-- the FK that was originally defined in schema.sql. PostgREST needs this FK to
-- resolve Supabase join queries like .select('*, modelo:mmc_models(...)').
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'mmc_leads_modelo_id_fkey'
      AND table_name = 'mmc_leads'
  ) THEN
    ALTER TABLE mmc_leads
      ADD CONSTRAINT mmc_leads_modelo_id_fkey
        FOREIGN KEY (modelo_id) REFERENCES mmc_models(id) ON DELETE SET NULL;
  END IF;
END $$;
