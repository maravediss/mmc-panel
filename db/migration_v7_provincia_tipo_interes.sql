-- Add provincia and tipo_interes fields to mmc_leads
ALTER TABLE mmc_leads
  ADD COLUMN IF NOT EXISTS provincia   text DEFAULT 'Málaga',
  ADD COLUMN IF NOT EXISTS tipo_interes text;
