-- ============================================================================
-- Schema v3 — Dedupe de leads (unificación por teléfono o email)
-- - Tabla mmc_lead_inbounds (cada entrada raw desde Zapier/Sheet, una fila por evento)
-- - mmc_leads queda como identidad maestra, actualizada con última fecha/modelo
-- - Función mmc_upsert_lead_inbound() que aplica lógica de dedupe
-- ============================================================================

CREATE TABLE IF NOT EXISTS mmc_lead_inbounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL REFERENCES mmc_leads(id) ON DELETE CASCADE,
  sheet_entry_id   text,
  sheet_row_hash   text,
  origen           mmc_lead_origin NOT NULL,
  formulario       text,
  fecha_entrada    timestamptz NOT NULL,
  modelo_raw       text,
  seleccionar_peticion text,
  mensajes_preferencias text,
  nombre_snapshot  text,
  email_snapshot   text,
  telefono_snapshot text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmc_lead_inbounds_lead   ON mmc_lead_inbounds(lead_id);
CREATE INDEX IF NOT EXISTS idx_mmc_lead_inbounds_date   ON mmc_lead_inbounds(fecha_entrada DESC);
CREATE INDEX IF NOT EXISTS idx_mmc_lead_inbounds_entry  ON mmc_lead_inbounds(sheet_entry_id) WHERE sheet_entry_id IS NOT NULL;

-- RLS: visibles para todos los que ven leads
ALTER TABLE mmc_lead_inbounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mmc_lead_inbounds_select ON mmc_lead_inbounds;
CREATE POLICY mmc_lead_inbounds_select ON mmc_lead_inbounds FOR SELECT TO authenticated
  USING (
    mmc_is_operator_admin_or_gerente()
    OR EXISTS (
      SELECT 1 FROM mmc_appointments a
      JOIN mmc_commercials c ON c.id = a.commercial_id
      WHERE a.lead_id = mmc_lead_inbounds.lead_id AND c.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mmc_lead_inbounds_write ON mmc_lead_inbounds;
CREATE POLICY mmc_lead_inbounds_write ON mmc_lead_inbounds FOR ALL TO authenticated
  USING (mmc_is_admin_or_gerente()) WITH CHECK (mmc_is_admin_or_gerente());

-- Función de upsert con lógica de dedupe
-- Retorna el lead_id (nuevo o existente)
CREATE OR REPLACE FUNCTION mmc_upsert_lead_inbound(
  p_sheet_entry_id       text,
  p_sheet_row_hash       text,
  p_origen               mmc_lead_origin,
  p_formulario           text,
  p_fecha_entrada        timestamptz,
  p_nombre               text,
  p_email                text,
  p_telefono             text,
  p_seleccionar_peticion text,
  p_mensajes_preferencias text,
  p_modelo_raw           text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead_id        uuid;
  v_tel_norm       text;
  v_email_norm     text;
  v_existing_date  timestamptz;
BEGIN
  v_tel_norm := mmc_normalize_tel(p_telefono);
  v_email_norm := NULLIF(lower(trim(p_email)), '');

  -- Si venía por sheet_entry_id ya conocido → reusar
  IF p_sheet_entry_id IS NOT NULL AND p_sheet_entry_id <> '' THEN
    SELECT id INTO v_lead_id FROM mmc_leads
    WHERE sheet_entry_id = p_sheet_entry_id LIMIT 1;
  END IF;

  -- Si no, buscar por teléfono o email
  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id FROM mmc_leads
    WHERE
      (v_email_norm IS NOT NULL AND lower(email) = v_email_norm)
      OR (v_tel_norm IS NOT NULL AND telefono_normalized = v_tel_norm)
    ORDER BY fecha_entrada DESC
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    -- Crear nuevo
    INSERT INTO mmc_leads (
      sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
      nombre, email, telefono, seleccionar_peticion, mensajes_preferencias, modelo_raw, status
    ) VALUES (
      p_sheet_entry_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
      p_nombre, p_email, p_telefono, p_seleccionar_peticion, p_mensajes_preferencias, p_modelo_raw, 'new'
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Actualizar: fecha y modelo del MÁS RECIENTE prevalecen
    SELECT fecha_entrada INTO v_existing_date FROM mmc_leads WHERE id = v_lead_id;
    IF p_fecha_entrada >= v_existing_date THEN
      UPDATE mmc_leads SET
        fecha_entrada = p_fecha_entrada,
        origen        = p_origen,
        formulario    = p_formulario,
        modelo_raw    = COALESCE(p_modelo_raw, modelo_raw),
        -- completar datos que faltasen
        email         = COALESCE(email, p_email),
        telefono      = COALESCE(telefono, p_telefono),
        nombre        = CASE WHEN length(COALESCE(p_nombre,'')) > length(COALESCE(nombre,'')) THEN p_nombre ELSE nombre END,
        seleccionar_peticion = COALESCE(p_seleccionar_peticion, seleccionar_peticion),
        mensajes_preferencias = COALESCE(p_mensajes_preferencias, mensajes_preferencias),
        sheet_entry_id = COALESCE(sheet_entry_id, p_sheet_entry_id)
      WHERE id = v_lead_id;
    END IF;
  END IF;

  -- Registrar el inbound event (dedupe por sheet_entry_id si existe)
  IF p_sheet_entry_id IS NOT NULL AND p_sheet_entry_id <> '' THEN
    INSERT INTO mmc_lead_inbounds (
      lead_id, sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
      modelo_raw, seleccionar_peticion, mensajes_preferencias,
      nombre_snapshot, email_snapshot, telefono_snapshot
    )
    SELECT v_lead_id, p_sheet_entry_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
           p_modelo_raw, p_seleccionar_peticion, p_mensajes_preferencias,
           p_nombre, p_email, p_telefono
    WHERE NOT EXISTS (SELECT 1 FROM mmc_lead_inbounds WHERE sheet_entry_id = p_sheet_entry_id);
  ELSE
    INSERT INTO mmc_lead_inbounds (
      lead_id, sheet_row_hash, origen, formulario, fecha_entrada,
      modelo_raw, seleccionar_peticion, mensajes_preferencias,
      nombre_snapshot, email_snapshot, telefono_snapshot
    ) VALUES (
      v_lead_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
      p_modelo_raw, p_seleccionar_peticion, p_mensajes_preferencias,
      p_nombre, p_email, p_telefono
    );
  END IF;

  RETURN v_lead_id;
END;
$$;

-- Índices extra para búsqueda rápida en call center
CREATE INDEX IF NOT EXISTS idx_mmc_leads_nombre_lower ON mmc_leads (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_mmc_leads_modelo_raw   ON mmc_leads (lower(modelo_raw));
