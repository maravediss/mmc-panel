-- Add optional contact fields to mmc_leads for operator use
ALTER TABLE mmc_leads
  ADD COLUMN IF NOT EXISTS telefono2     text,
  ADD COLUMN IF NOT EXISTS direccion     text,
  ADD COLUMN IF NOT EXISTS codigo_postal text;

-- Add 'otra_provincia' value to the no-interest reason enum
ALTER TYPE mmc_no_interest_reason ADD VALUE IF NOT EXISTS 'otra_provincia';
