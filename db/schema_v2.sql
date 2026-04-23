-- ============================================================================
-- Schema v2 — añade: rol operadora, tabla mmc_calls, campos BQ en leads,
-- enums de call center, view para buscar leads por teléfono normalizado
-- ============================================================================

-- Añadir valor 'operadora' al enum (debe ir FUERA de transacción)
DO $$ BEGIN
  ALTER TYPE mmc_commercial_role ADD VALUE IF NOT EXISTS 'operadora';
EXCEPTION WHEN others THEN null; END $$;

-- Tipos para resultado call-center (espejan el Apps Script + catálogo Presence)
DO $$ BEGIN
  CREATE TYPE mmc_call_result AS ENUM (
    'no_contactado',
    'no_contesta',
    'contacto_erroneo',
    'cuelga_al_identificarse',
    'no_interesado',
    'cita_taller',
    'cita_concesionario',
    'cita_prueba_moto',
    'quiere_mas_info_concesionario',
    'otro'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE mmc_no_interest_reason AS ENUM (
    'ya_comprada_otro_sitio',
    'precio_alto',
    'vive_lejos',
    'solo_informacion',
    'ya_no_quiere'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Enriquecer mmc_leads con datos cruzados de BigQuery/Presence
ALTER TABLE mmc_leads
  ADD COLUMN IF NOT EXISTS telefono_normalized   text,
  ADD COLUMN IF NOT EXISTS bq_last_sync_at       timestamptz,
  ADD COLUMN IF NOT EXISTS bq_total_attempts     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bq_daily_counter      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bq_no_answer_counter  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bq_busy_counter       integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bq_last_agent         text,
  ADD COLUMN IF NOT EXISTS bq_last_qcode         text,
  ADD COLUMN IF NOT EXISTS bq_last_qcode_desc    text,
  ADD COLUMN IF NOT EXISTS bq_last_call_at       timestamptz,
  ADD COLUMN IF NOT EXISTS bq_first_call_at      timestamptz,
  ADD COLUMN IF NOT EXISTS bq_schedule_type      text,
  ADD COLUMN IF NOT EXISTS bq_status             integer,
  ADD COLUMN IF NOT EXISTS bq_optn_resultado     text,          -- optn_resultado_llamada
  ADD COLUMN IF NOT EXISTS bq_optn_tipo_interes  text,
  ADD COLUMN IF NOT EXISTS bq_multi_observaciones text;

CREATE INDEX IF NOT EXISTS idx_mmc_leads_tel_norm ON mmc_leads(telefono_normalized) WHERE telefono_normalized IS NOT NULL;

-- Mantener telefono_normalized en sync (trigger)
CREATE OR REPLACE FUNCTION mmc_normalize_tel(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  -- Devuelve sólo dígitos, quitando prefijos internacionales largos
  SELECT CASE
    WHEN raw IS NULL THEN NULL
    ELSE (
      SELECT SUBSTRING(digits FROM GREATEST(length(digits) - 8, 1))
      FROM (SELECT regexp_replace(raw, '[^0-9]', '', 'g') AS digits) t
    )
  END;
$$;

CREATE OR REPLACE FUNCTION mmc_touch_lead_norm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.telefono_normalized := mmc_normalize_tel(NEW.telefono);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_mmc_leads_norm ON mmc_leads;
CREATE TRIGGER trg_mmc_leads_norm BEFORE INSERT OR UPDATE OF telefono ON mmc_leads
  FOR EACH ROW EXECUTE FUNCTION mmc_touch_lead_norm();

-- Backfill
UPDATE mmc_leads SET telefono_normalized = mmc_normalize_tel(telefono) WHERE telefono IS NOT NULL AND telefono_normalized IS NULL;

-- Tabla de llamadas individuales (cada intento un registro)
CREATE TABLE IF NOT EXISTS mmc_calls (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid REFERENCES mmc_leads(id) ON DELETE SET NULL,
  bq_log_id           bigint UNIQUE NOT NULL,                -- mmc_leads_logs.ID; cross con grabación
  bq_queue_id         bigint NOT NULL,
  telefono            text,
  telefono_normalized text,
  agent_name          text,
  qcode               integer,
  qcode_description   text,
  qcode_type          text,                                  -- Positive / Negative / Non-useful
  service_name        text,
  load_name           text,
  scheduled_datetime  timestamptz,
  ringing_time_s      integer,
  talk_time_s         integer,
  handling_time_s     integer,
  wait_time_s         integer,
  hangup_type         text,
  station             integer,
  call_at             timestamptz NOT NULL,
  recording_url       text,                                  -- se rellenará cuando se ingeste SharePoint
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_calls_lead      ON mmc_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_mmc_calls_call_at   ON mmc_calls(call_at DESC);
CREATE INDEX IF NOT EXISTS idx_mmc_calls_queue_id  ON mmc_calls(bq_queue_id);
CREATE INDEX IF NOT EXISTS idx_mmc_calls_tel_norm  ON mmc_calls(telefono_normalized);
CREATE INDEX IF NOT EXISTS idx_mmc_calls_agent     ON mmc_calls(agent_name);

-- Tabla de reportes manuales de operadora (lo que rellena en el panel)
CREATE TABLE IF NOT EXISTS mmc_operator_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid NOT NULL REFERENCES mmc_leads(id) ON DELETE CASCADE,
  operator_id     uuid NOT NULL REFERENCES mmc_commercials(id),
  telefono_buscado text,                                    -- el que puso la operadora en el input
  call_result     mmc_call_result NOT NULL,
  no_interest_reason mmc_no_interest_reason,                -- si call_result = no_interesado
  cita_fecha      timestamptz,                              -- si call_result comienza por cita_*
  cita_comercial_id uuid REFERENCES mmc_commercials(id),
  qmi_motivo      text,                                     -- motivo si quiere_mas_info (col R del Sheet)
  comunicaciones_comerciales boolean,                       -- opt-in marketing
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_op_reports_lead ON mmc_operator_reports(lead_id);
CREATE INDEX IF NOT EXISTS idx_mmc_op_reports_op   ON mmc_operator_reports(operator_id);

-- RLS
ALTER TABLE mmc_calls             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mmc_operator_reports  ENABLE ROW LEVEL SECURITY;

-- Helper role-aware
CREATE OR REPLACE FUNCTION mmc_is_operator_admin_or_gerente()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM mmc_commercials c
    WHERE c.auth_user_id = auth.uid() AND c.role IN ('admin','gerente','operadora')
  );
$$;

-- Calls: admin/gerente/operadora ven todo; comercial sólo los de sus citas
DROP POLICY IF EXISTS mmc_calls_select ON mmc_calls;
CREATE POLICY mmc_calls_select ON mmc_calls FOR SELECT TO authenticated
  USING (
    mmc_is_operator_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.lead_id = mmc_calls.lead_id AND c.auth_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS mmc_calls_write ON mmc_calls;
CREATE POLICY mmc_calls_write ON mmc_calls FOR ALL TO authenticated
  USING (mmc_is_admin_or_gerente()) WITH CHECK (mmc_is_admin_or_gerente());

-- Operator reports: operadoras crean; todos los manager+ ven; la propia operadora ve las suyas
DROP POLICY IF EXISTS mmc_opr_select ON mmc_operator_reports;
CREATE POLICY mmc_opr_select ON mmc_operator_reports FOR SELECT TO authenticated
  USING (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = operator_id AND c.auth_user_id = auth.uid())
  );
DROP POLICY IF EXISTS mmc_opr_insert ON mmc_operator_reports;
CREATE POLICY mmc_opr_insert ON mmc_operator_reports FOR INSERT TO authenticated
  WITH CHECK (
    mmc_is_admin_or_gerente()
    OR EXISTS (SELECT 1 FROM mmc_commercials c WHERE c.id = operator_id AND c.auth_user_id = auth.uid() AND c.role = 'operadora')
  );

-- Ampliar leads select a operadoras: pueden ver todos los leads (necesario para buscar por teléfono)
DROP POLICY IF EXISTS mmc_leads_select ON mmc_leads;
CREATE POLICY mmc_leads_select ON mmc_leads FOR SELECT TO authenticated
  USING (
    mmc_is_operator_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.lead_id = mmc_leads.id AND c.auth_user_id = auth.uid()
    )
  );

-- Vista auxiliar: lead + stats de calls
CREATE OR REPLACE VIEW mmc_v_lead_detail AS
SELECT
  l.*,
  (SELECT COUNT(*) FROM mmc_calls c WHERE c.lead_id = l.id) AS calls_total,
  (SELECT MAX(c.call_at) FROM mmc_calls c WHERE c.lead_id = l.id) AS calls_last_at,
  (SELECT MIN(c.call_at) FROM mmc_calls c WHERE c.lead_id = l.id) AS calls_first_at,
  (SELECT COUNT(*) FROM mmc_appointments a WHERE a.lead_id = l.id) AS appts_total,
  (SELECT COUNT(*) FROM mmc_sales s WHERE s.lead_id = l.id) AS sales_total
FROM mmc_leads l;
