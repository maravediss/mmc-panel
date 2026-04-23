-- ============================================================================
-- Schema v5 — Catálogo oficial de modelos Yamaha + sistema de aliases + márgenes
-- ============================================================================

-- Reset si ya se había intentado antes (desarrollo)
DROP TABLE IF EXISTS mmc_model_margins CASCADE;
DROP TABLE IF EXISTS mmc_model_aliases CASCADE;
-- mmc_models ya existía (placeholder vacío); la rehacemos con más columnas
DROP TABLE IF EXISTS mmc_models CASCADE;

-- -----------------------------------------------------------------------------
-- Catálogo oficial
-- -----------------------------------------------------------------------------
CREATE TABLE mmc_models (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,          -- nombre oficial tal cual aparece en la pestaña Márgenes
  family        text,                          -- scooter | naked | deportiva | trail | offroad | bicicleta | otro
  cc            integer,                       -- 125 / 300 / 560 / 700 / 900 / ... / null
  is_display    boolean NOT NULL DEFAULT false,-- variante (DISPLAY)
  is_35kw       boolean NOT NULL DEFAULT false,-- variante /35kw
  is_anniv      boolean NOT NULL DEFAULT false,-- edición aniversario
  is_active     boolean NOT NULL DEFAULT true,
  year_default  text,                          -- año que aparece en Márgenes (null = cualquiera)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mmc_models_family ON mmc_models(family);

-- -----------------------------------------------------------------------------
-- Aliases (cualquier variante raw → modelo oficial)
-- -----------------------------------------------------------------------------
CREATE TABLE mmc_model_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    uuid NOT NULL REFERENCES mmc_models(id) ON DELETE CASCADE,
  alias       text NOT NULL,
  -- normalizado: lowercase + sólo alfanuméricos (para match robusto)
  normalized  text GENERATED ALWAYS AS (lower(regexp_replace(coalesce(alias,''), '[^A-Za-z0-9]', '', 'g'))) STORED,
  source      text NOT NULL DEFAULT 'manual',  -- manual | sheet | form | presence | catalog_seed
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alias)
);

CREATE INDEX idx_mmc_model_aliases_norm ON mmc_model_aliases(normalized);

-- -----------------------------------------------------------------------------
-- Márgenes (pestaña Márgenes del Sheet)
-- -----------------------------------------------------------------------------
CREATE TABLE mmc_model_margins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        uuid REFERENCES mmc_models(id) ON DELETE CASCADE,
  model_name      text NOT NULL,                 -- nombre tal cual en el Sheet (por si hay variaciones)
  year            text,                          -- '2023' / '2024' / null = cualquier año
  margin_eur      numeric(10,2) NOT NULL,
  source          text NOT NULL DEFAULT 'sheet_margenes',
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_name, year)
);

CREATE INDEX idx_mmc_model_margins_model ON mmc_model_margins(model_id);

-- -----------------------------------------------------------------------------
-- FK model_id en mmc_sales (ya existía en mmc_leads)
-- -----------------------------------------------------------------------------
-- Asegurar que la FK es válida (la columna ya existía en schema v1, sólo confirmamos el REFERENCES)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mmc_sales' AND column_name = 'model_id'
  ) THEN
    ALTER TABLE mmc_sales ADD COLUMN model_id uuid REFERENCES mmc_models(id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- RLS — modelos y márgenes son de consulta pública (dentro del app)
-- -----------------------------------------------------------------------------
ALTER TABLE mmc_models          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_model_aliases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_model_margins   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mmc_models_select ON mmc_models;
CREATE POLICY mmc_models_select ON mmc_models FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS mmc_models_write ON mmc_models;
CREATE POLICY mmc_models_write ON mmc_models FOR ALL TO authenticated
  USING (mmc_is_admin_or_gerente()) WITH CHECK (mmc_is_admin_or_gerente());

DROP POLICY IF EXISTS mmc_aliases_select ON mmc_model_aliases;
CREATE POLICY mmc_aliases_select ON mmc_model_aliases FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS mmc_aliases_write ON mmc_model_aliases;
CREATE POLICY mmc_aliases_write ON mmc_model_aliases FOR ALL TO authenticated
  USING (mmc_is_admin_or_gerente()) WITH CHECK (mmc_is_admin_or_gerente());

DROP POLICY IF EXISTS mmc_margins_select ON mmc_model_margins;
CREATE POLICY mmc_margins_select ON mmc_model_margins FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS mmc_margins_write ON mmc_model_margins;
CREATE POLICY mmc_margins_write ON mmc_model_margins FOR ALL TO authenticated
  USING (mmc_is_admin_or_gerente()) WITH CHECK (mmc_is_admin_or_gerente());

-- -----------------------------------------------------------------------------
-- Función resolver: cualquier string raw → model_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mmc_resolve_model(raw text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT model_id FROM mmc_model_aliases
  WHERE normalized = lower(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'))
    AND normalized <> ''
  LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- Vista útil: lead/sale con modelo resuelto
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW mmc_v_lead_with_model AS
SELECT
  l.*,
  m.name AS modelo_oficial,
  m.family,
  m.cc,
  -- margen estimado para "hoy" según mejor coincidencia (modelo + último año disponible)
  (SELECT mm.margin_eur FROM mmc_model_margins mm
   WHERE mm.model_id = l.modelo_id
   ORDER BY mm.year DESC NULLS LAST
   LIMIT 1) AS margen_estimado
FROM mmc_leads l
LEFT JOIN mmc_models m ON m.id = l.modelo_id;
