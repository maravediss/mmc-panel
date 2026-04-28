-- ============================================================================
-- Fix: dedupe SOLO por teléfono (el email no es criterio de unicidad)
-- Versión v2 (2026-04-25): elimina fallback por sheet_entry_id (peligroso —
--   el entry_id 346841059 fue compartido por 204 personas distintas por bug
--   de Zapier, causando fusión masiva incorrecta de leads).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mmc_upsert_lead_inbound(
  p_sheet_entry_id        text,
  p_sheet_row_hash        text,
  p_origen                mmc_lead_origin,
  p_formulario            text,
  p_fecha_entrada         timestamptz,
  p_nombre                text,
  p_email                 text,
  p_telefono              text,
  p_seleccionar_peticion  text,
  p_mensajes_preferencias text,
  p_modelo_raw            text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_lead_id       uuid;
  v_tel_norm      text;
  v_existing_date timestamptz;
BEGIN
  v_tel_norm := mmc_normalize_tel(p_telefono);

  -- Dedupe SOLO por telefono normalizado.
  -- sheet_entry_id NO es fiable: un mismo entry_id puede corresponder a
  -- personas distintas si el sistema origen tiene bugs (caso 346841059).
  IF v_tel_norm IS NOT NULL AND v_tel_norm <> '' THEN
    SELECT id INTO v_lead_id
    FROM mmc_leads
    WHERE telefono_normalized = v_tel_norm
    ORDER BY fecha_entrada DESC
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    -- Lead nuevo
    INSERT INTO mmc_leads (
      sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
      nombre, email, telefono, seleccionar_peticion, mensajes_preferencias, modelo_raw, status
    ) VALUES (
      p_sheet_entry_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
      p_nombre, p_email, p_telefono,
      p_seleccionar_peticion, p_mensajes_preferencias, p_modelo_raw, 'new'
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Actualizar solo si el inbound es mas reciente
    SELECT fecha_entrada INTO v_existing_date FROM mmc_leads WHERE id = v_lead_id;
    IF p_fecha_entrada >= v_existing_date THEN
      UPDATE mmc_leads SET
        fecha_entrada         = p_fecha_entrada,
        origen                = p_origen,
        formulario            = p_formulario,
        modelo_raw            = COALESCE(p_modelo_raw, modelo_raw),
        email                 = COALESCE(email, p_email),
        telefono              = COALESCE(p_telefono, telefono),
        nombre                = CASE
          WHEN length(COALESCE(p_nombre, '')) > length(COALESCE(nombre, ''))
          THEN p_nombre ELSE nombre END,
        seleccionar_peticion  = COALESCE(p_seleccionar_peticion, seleccionar_peticion),
        mensajes_preferencias = COALESCE(p_mensajes_preferencias, mensajes_preferencias),
        sheet_entry_id        = COALESCE(sheet_entry_id, p_sheet_entry_id)
      WHERE id = v_lead_id;
    END IF;
  END IF;

  -- Registrar inbound: dedupe por sheet_row_hash (UNIQUE constraint en tabla)
  -- ON CONFLICT DO NOTHING garantiza idempotencia sin riesgo de falso merge.
  INSERT INTO mmc_lead_inbounds (
    lead_id, sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
    modelo_raw, seleccionar_peticion, mensajes_preferencias,
    nombre_snapshot, email_snapshot, telefono_snapshot
  ) VALUES (
    v_lead_id, p_sheet_entry_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
    p_modelo_raw, p_seleccionar_peticion, p_mensajes_preferencias,
    p_nombre, p_email, p_telefono
  )
  ON CONFLICT (sheet_row_hash) DO NOTHING;

  RETURN v_lead_id;
END;
$func$;
