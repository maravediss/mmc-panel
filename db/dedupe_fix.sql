-- ============================================================================
-- Fix: dedupe SOLO por teléfono (el email no es criterio de unicidad)
-- - Actualizar mmc_upsert_lead_inbound
-- - Separar leads que fueron fusionados por email pero tenían teléfonos distintos
-- ============================================================================

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
  v_existing_date  timestamptz;
BEGIN
  v_tel_norm := mmc_normalize_tel(p_telefono);

  -- Buscar por sheet_entry_id conocido
  IF p_sheet_entry_id IS NOT NULL AND p_sheet_entry_id <> '' THEN
    SELECT id INTO v_lead_id FROM mmc_leads WHERE sheet_entry_id = p_sheet_entry_id LIMIT 1;
  END IF;

  -- Dedupe: SOLO por teléfono normalizado (email no se usa como criterio)
  IF v_lead_id IS NULL AND v_tel_norm IS NOT NULL AND v_tel_norm <> '' THEN
    SELECT id INTO v_lead_id FROM mmc_leads
    WHERE telefono_normalized = v_tel_norm
    ORDER BY fecha_entrada DESC
    LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    INSERT INTO mmc_leads (
      sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
      nombre, email, telefono, seleccionar_peticion, mensajes_preferencias, modelo_raw, status
    ) VALUES (
      p_sheet_entry_id, p_sheet_row_hash, p_origen, p_formulario, p_fecha_entrada,
      p_nombre, p_email, p_telefono, p_seleccionar_peticion, p_mensajes_preferencias, p_modelo_raw, 'new'
    )
    RETURNING id INTO v_lead_id;
  ELSE
    SELECT fecha_entrada INTO v_existing_date FROM mmc_leads WHERE id = v_lead_id;
    IF p_fecha_entrada >= v_existing_date THEN
      UPDATE mmc_leads SET
        fecha_entrada = p_fecha_entrada,
        origen        = p_origen,
        formulario    = p_formulario,
        modelo_raw    = COALESCE(p_modelo_raw, modelo_raw),
        email         = COALESCE(email, p_email),
        telefono      = COALESCE(telefono, p_telefono),
        nombre        = CASE WHEN length(COALESCE(p_nombre,'')) > length(COALESCE(nombre,'')) THEN p_nombre ELSE nombre END,
        seleccionar_peticion = COALESCE(p_seleccionar_peticion, seleccionar_peticion),
        mensajes_preferencias = COALESCE(p_mensajes_preferencias, mensajes_preferencias),
        sheet_entry_id = COALESCE(sheet_entry_id, p_sheet_entry_id)
      WHERE id = v_lead_id;
    END IF;
  END IF;

  -- Registrar inbound event
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

-- ============================================================================
-- Separar leads fusionados por email con teléfonos distintos
-- Estrategia: agrupar inbounds por telefono_normalized; para cada teléfono
-- distinto al del lead master, crear lead nuevo y mover esos inbounds.
-- Las FKs previas (appointments/calls/sales) se quedan en el master
-- (no es reversible saber a cuál pertenecían originalmente).
-- ============================================================================

DO $SEP$
DECLARE
  v_group RECORD;
  v_inb   RECORD;
  v_new_lead_id uuid;
  v_master_tel_norm text;
  v_separated int := 0;
BEGIN
  FOR v_group IN
    SELECT DISTINCT i.lead_id, l.telefono_normalized AS master_tel,
           mmc_normalize_tel(i.telefono_snapshot) AS inbound_tel
    FROM mmc_lead_inbounds i
    JOIN mmc_leads l ON l.id = i.lead_id
    WHERE i.telefono_snapshot IS NOT NULL
      AND length(regexp_replace(i.telefono_snapshot, '[^0-9]', '', 'g')) >= 6
      AND mmc_normalize_tel(i.telefono_snapshot) <> l.telefono_normalized
      AND mmc_normalize_tel(i.telefono_snapshot) IS NOT NULL
  LOOP
    -- ¿ya hemos creado un lead para ese teléfono?
    SELECT id INTO v_new_lead_id FROM mmc_leads
    WHERE telefono_normalized = v_group.inbound_tel LIMIT 1;

    IF v_new_lead_id IS NULL THEN
      -- Crear un nuevo lead a partir del inbound más reciente que tenga ese teléfono
      SELECT * INTO v_inb FROM mmc_lead_inbounds
      WHERE lead_id = v_group.lead_id
        AND mmc_normalize_tel(telefono_snapshot) = v_group.inbound_tel
      ORDER BY fecha_entrada DESC
      LIMIT 1;

      IF v_inb.id IS NULL THEN CONTINUE; END IF;

      INSERT INTO mmc_leads (
        sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
        nombre, email, telefono, modelo_raw, seleccionar_peticion, mensajes_preferencias,
        status
      ) VALUES (
        v_inb.sheet_entry_id, v_inb.sheet_row_hash, v_inb.origen, v_inb.formulario, v_inb.fecha_entrada,
        v_inb.nombre_snapshot, v_inb.email_snapshot, v_inb.telefono_snapshot,
        v_inb.modelo_raw, v_inb.seleccionar_peticion, v_inb.mensajes_preferencias,
        'new'
      )
      RETURNING id INTO v_new_lead_id;
    END IF;

    -- Mover todos los inbounds de ese teléfono al lead nuevo
    UPDATE mmc_lead_inbounds
    SET lead_id = v_new_lead_id
    WHERE lead_id = v_group.lead_id
      AND mmc_normalize_tel(telefono_snapshot) = v_group.inbound_tel;

    v_separated := v_separated + 1;
  END LOOP;

  RAISE NOTICE 'Separados % grupos de inbounds a leads nuevos', v_separated;
END;
$SEP$;

-- Verificación
SELECT 'total leads'  AS m, count(*) FROM mmc_leads
UNION ALL SELECT 'emails dup (sólo info, NO se dedupe)', count(*) FROM (
  SELECT lower(email) FROM mmc_leads WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1
) t
UNION ALL SELECT 'tel dup (debe ser 0)', count(*) FROM (
  SELECT telefono_normalized FROM mmc_leads WHERE telefono_normalized IS NOT NULL GROUP BY telefono_normalized HAVING count(*) > 1
) t
UNION ALL SELECT 'total inbounds', count(*) FROM mmc_lead_inbounds;
