-- ============================================================================
-- Panel Comercial Yamaha Málaga Center (MMC) — Schema v1
-- Supabase / Postgres. Todas las tablas prefijadas mmc_ para futura coexistencia
-- con otros tenants.
-- ============================================================================

-- ----- ENUMs -----
DO $$ BEGIN
  CREATE TYPE mmc_lead_origin AS ENUM ('META','SEO','SEM','SEO_SEM','INSTAGRAM','WALK_IN','PRESENCE','OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_lead_status AS ENUM (
    'new',             -- lead recién entrado, sin contactar
    'contacted',       -- contactado por call center o comercial
    'appointment',     -- tiene cita agendada pendiente
    'attended',        -- acudió a cita, pendiente cerrar resultado
    'sold',            -- compró moto
    'lost',            -- perdido (no interesado / no compra / no acude)
    'bad_contact'      -- teléfono/email erróneo
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_appointment_type AS ENUM ('prueba_moto','concesionario','taller');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_appointment_status AS ENUM ('pending','attended','no_show','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_no_sale_reason AS ENUM (
    'otro_concesionario_yamaha',
    'otra_marca',
    'financiacion_rechazada',
    'ya_no_quiere',
    'otro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_commercial_role AS ENUM ('comercial','gerente','admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ----- Tablas -----

-- Comerciales y personal del concesionario
CREATE TABLE IF NOT EXISTS mmc_commercials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name          text NOT NULL,
  display_name  text,
  email         text UNIQUE,
  role          mmc_commercial_role NOT NULL DEFAULT 'comercial',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Catálogo de modelos Yamaha normalizados (se rellena después)
CREATE TABLE IF NOT EXISTS mmc_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  aliases     text[] NOT NULL DEFAULT '{}',
  category    text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Leads — fuente única de la verdad
CREATE TABLE IF NOT EXISTS mmc_leads (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Origen raw (para rastreabilidad)
  sheet_entry_id             text,
  sheet_row_hash             text,                         -- detecta cambios al re-sync
  bq_queue_id                bigint,                       -- cruce futuro con Presence
  -- Datos del lead
  origen                     mmc_lead_origin NOT NULL,
  formulario                 text,
  fecha_entrada              timestamptz NOT NULL,
  nombre                     text NOT NULL,
  email                      text,
  telefono                   text,
  seleccionar_peticion       text,
  mensajes_preferencias      text,
  modelo_id                  uuid REFERENCES mmc_models(id) ON DELETE SET NULL,
  modelo_raw                 text,                         -- valor original del form
  -- Estado
  status                     mmc_lead_status NOT NULL DEFAULT 'new',
  lost_reason                text,
  comunicaciones_comerciales boolean,                      -- opt-in/out marketing
  notas                      text,
  -- Timestamps
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_leads_status       ON mmc_leads(status);
CREATE INDEX IF NOT EXISTS idx_mmc_leads_origen       ON mmc_leads(origen);
CREATE INDEX IF NOT EXISTS idx_mmc_leads_fecha        ON mmc_leads(fecha_entrada DESC);
CREATE INDEX IF NOT EXISTS idx_mmc_leads_email        ON mmc_leads(lower(email));
CREATE INDEX IF NOT EXISTS idx_mmc_leads_telefono     ON mmc_leads(telefono);
CREATE INDEX IF NOT EXISTS idx_mmc_leads_bq_queue_id  ON mmc_leads(bq_queue_id) WHERE bq_queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mmc_leads_sheet_entry  ON mmc_leads(sheet_entry_id) WHERE sheet_entry_id IS NOT NULL;

-- Citas
CREATE TABLE IF NOT EXISTS mmc_appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES mmc_leads(id) ON DELETE CASCADE,
  commercial_id   uuid REFERENCES mmc_commercials(id) ON DELETE SET NULL,
  tipo            mmc_appointment_type NOT NULL,
  fecha_cita      timestamptz NOT NULL,
  status          mmc_appointment_status NOT NULL DEFAULT 'pending',
  no_show_motivo  text,                                    -- libre si status=no_show
  notes           text,
  attended_at     timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_appts_commercial ON mmc_appointments(commercial_id);
CREATE INDEX IF NOT EXISTS idx_mmc_appts_fecha      ON mmc_appointments(fecha_cita);
CREATE INDEX IF NOT EXISTS idx_mmc_appts_status     ON mmc_appointments(status);
CREATE INDEX IF NOT EXISTS idx_mmc_appts_lead       ON mmc_appointments(lead_id);

-- Ventas
CREATE TABLE IF NOT EXISTS mmc_sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES mmc_leads(id),
  appointment_id  uuid REFERENCES mmc_appointments(id) ON DELETE SET NULL,
  commercial_id   uuid NOT NULL REFERENCES mmc_commercials(id),
  model_id        uuid REFERENCES mmc_models(id),
  model_raw       text,
  fecha_compra    date NOT NULL,
  margen_eur      numeric(10,2),
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_sales_commercial ON mmc_sales(commercial_id);
CREATE INDEX IF NOT EXISTS idx_mmc_sales_fecha      ON mmc_sales(fecha_compra DESC);

-- Motivos de no compra (cuando cita=attended pero no hay venta)
CREATE TABLE IF NOT EXISTS mmc_no_sale_reasons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES mmc_leads(id),
  appointment_id  uuid REFERENCES mmc_appointments(id) ON DELETE SET NULL,
  motivo          mmc_no_sale_reason NOT NULL,
  motivo_texto    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ----- Triggers updated_at -----
CREATE OR REPLACE FUNCTION mmc_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_mmc_commercials_uat ON mmc_commercials;
CREATE TRIGGER trg_mmc_commercials_uat BEFORE UPDATE ON mmc_commercials
  FOR EACH ROW EXECUTE FUNCTION mmc_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mmc_leads_uat ON mmc_leads;
CREATE TRIGGER trg_mmc_leads_uat BEFORE UPDATE ON mmc_leads
  FOR EACH ROW EXECUTE FUNCTION mmc_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mmc_appts_uat ON mmc_appointments;
CREATE TRIGGER trg_mmc_appts_uat BEFORE UPDATE ON mmc_appointments
  FOR EACH ROW EXECUTE FUNCTION mmc_touch_updated_at();

DROP TRIGGER IF EXISTS trg_mmc_sales_uat ON mmc_sales;
CREATE TRIGGER trg_mmc_sales_uat BEFORE UPDATE ON mmc_sales
  FOR EACH ROW EXECUTE FUNCTION mmc_touch_updated_at();

-- ----- Vistas auxiliares -----
CREATE OR REPLACE VIEW mmc_v_commercial_pipeline AS
SELECT
  c.id                                       AS commercial_id,
  c.name                                     AS commercial_name,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status='pending'   AND a.fecha_cita::date = current_date)       AS citas_hoy,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status='pending'   AND a.fecha_cita::date > current_date)        AS citas_futuras,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status='pending'   AND a.fecha_cita::date < current_date)        AS citas_pendientes_cerrar,
  COUNT(DISTINCT s.id)                                                                                  AS ventas_total,
  COALESCE(SUM(s.margen_eur),0)                                                                         AS margen_total_eur
FROM mmc_commercials c
LEFT JOIN mmc_appointments a ON a.commercial_id = c.id
LEFT JOIN mmc_sales        s ON s.commercial_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.name;

-- ----- RLS -----
ALTER TABLE mmc_commercials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_leads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_no_sale_reasons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_models            ENABLE ROW LEVEL SECURITY;

-- Helper: quien es el usuario actual como comercial
CREATE OR REPLACE FUNCTION mmc_current_commercial()
RETURNS mmc_commercials LANGUAGE sql STABLE AS $$
  SELECT c.* FROM mmc_commercials c WHERE c.auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION mmc_is_admin_or_gerente()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM mmc_commercials c
    WHERE c.auth_user_id = auth.uid() AND c.role IN ('admin','gerente')
  );
$$;

-- Políticas: admin/gerente ven TODO; comercial ve sólo lo suyo
-- Commercials
DROP POLICY IF EXISTS mmc_commercials_select ON mmc_commercials;
CREATE POLICY mmc_commercials_select ON mmc_commercials FOR SELECT TO authenticated
  USING ( mmc_is_admin_or_gerente() OR auth_user_id = auth.uid() );

DROP POLICY IF EXISTS mmc_commercials_update ON mmc_commercials;
CREATE POLICY mmc_commercials_update ON mmc_commercials FOR UPDATE TO authenticated
  USING ( mmc_is_admin_or_gerente() OR auth_user_id = auth.uid() );

-- Models: lectura para todos
DROP POLICY IF EXISTS mmc_models_select ON mmc_models;
CREATE POLICY mmc_models_select ON mmc_models FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS mmc_models_write ON mmc_models;
CREATE POLICY mmc_models_write ON mmc_models FOR ALL TO authenticated
  USING ( mmc_is_admin_or_gerente() ) WITH CHECK ( mmc_is_admin_or_gerente() );

-- Leads: admin/gerente ven todo; comercial ve los suyos (con cita asignada)
DROP POLICY IF EXISTS mmc_leads_select ON mmc_leads;
CREATE POLICY mmc_leads_select ON mmc_leads FOR SELECT TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.lead_id = mmc_leads.id AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mmc_leads_update ON mmc_leads;
CREATE POLICY mmc_leads_update ON mmc_leads FOR UPDATE TO authenticated
  USING ( mmc_is_admin_or_gerente() );

-- Appointments: comercial ve las suyas, gerente ve todas
DROP POLICY IF EXISTS mmc_appts_select ON mmc_appointments;
CREATE POLICY mmc_appts_select ON mmc_appointments FOR SELECT TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = mmc_appointments.commercial_id AND c.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS mmc_appts_update ON mmc_appointments;
CREATE POLICY mmc_appts_update ON mmc_appointments FOR UPDATE TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = mmc_appointments.commercial_id AND c.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS mmc_appts_insert ON mmc_appointments;
CREATE POLICY mmc_appts_insert ON mmc_appointments FOR INSERT TO authenticated
  WITH CHECK ( mmc_is_admin_or_gerente() );

-- Sales
DROP POLICY IF EXISTS mmc_sales_select ON mmc_sales;
CREATE POLICY mmc_sales_select ON mmc_sales FOR SELECT TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = mmc_sales.commercial_id AND c.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS mmc_sales_insert ON mmc_sales;
CREATE POLICY mmc_sales_insert ON mmc_sales FOR INSERT TO authenticated
  WITH CHECK (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = commercial_id AND c.auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS mmc_sales_update ON mmc_sales;
CREATE POLICY mmc_sales_update ON mmc_sales FOR UPDATE TO authenticated
  USING ( mmc_is_admin_or_gerente() );

-- No sale reasons: comercial puede crear las suyas (via appointment)
DROP POLICY IF EXISTS mmc_nsr_select ON mmc_no_sale_reasons;
CREATE POLICY mmc_nsr_select ON mmc_no_sale_reasons FOR SELECT TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.id = mmc_no_sale_reasons.appointment_id AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mmc_nsr_insert ON mmc_no_sale_reasons;
CREATE POLICY mmc_nsr_insert ON mmc_no_sale_reasons FOR INSERT TO authenticated
  WITH CHECK (
    mmc_is_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.id = appointment_id AND c.auth_user_id = auth.uid()
    )
  );
