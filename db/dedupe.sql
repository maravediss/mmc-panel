-- Función merge + dedupe masivo
CREATE OR REPLACE FUNCTION mmc_merge_leads(src uuid, dst uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src_row mmc_leads%ROWTYPE;
  v_dst_row mmc_leads%ROWTYPE;
BEGIN
  IF src = dst THEN RETURN; END IF;
  SELECT * INTO v_src_row FROM mmc_leads WHERE id = src;
  SELECT * INTO v_dst_row FROM mmc_leads WHERE id = dst;
  IF v_src_row.id IS NULL OR v_dst_row.id IS NULL THEN RETURN; END IF;

  -- Guardar el src como inbound en el historial de dst
  INSERT INTO mmc_lead_inbounds (
    lead_id, sheet_entry_id, sheet_row_hash, origen, formulario, fecha_entrada,
    modelo_raw, seleccionar_peticion, mensajes_preferencias,
    nombre_snapshot, email_snapshot, telefono_snapshot
  ) VALUES (
    dst, v_src_row.sheet_entry_id, v_src_row.sheet_row_hash, v_src_row.origen, v_src_row.formulario, v_src_row.fecha_entrada,
    v_src_row.modelo_raw, v_src_row.seleccionar_peticion, v_src_row.mensajes_preferencias,
    v_src_row.nombre, v_src_row.email, v_src_row.telefono
  ) ON CONFLICT DO NOTHING;

  -- Mover FK
  UPDATE mmc_appointments     SET lead_id = dst WHERE lead_id = src;
  UPDATE mmc_sales            SET lead_id = dst WHERE lead_id = src;
  UPDATE mmc_no_sale_reasons  SET lead_id = dst WHERE lead_id = src;
  UPDATE mmc_operator_reports SET lead_id = dst WHERE lead_id = src;
  UPDATE mmc_calls            SET lead_id = dst WHERE lead_id = src;
  UPDATE mmc_lead_inbounds    SET lead_id = dst WHERE lead_id = src;

  -- Actualizar dst con datos del src si el src es más reciente
  IF v_src_row.fecha_entrada > v_dst_row.fecha_entrada THEN
    UPDATE mmc_leads SET
      fecha_entrada = v_src_row.fecha_entrada,
      origen        = v_src_row.origen,
      formulario    = v_src_row.formulario,
      modelo_raw    = COALESCE(v_src_row.modelo_raw, v_dst_row.modelo_raw),
      email         = COALESCE(v_dst_row.email, v_src_row.email),
      telefono      = COALESCE(v_dst_row.telefono, v_src_row.telefono),
      nombre        = CASE WHEN length(COALESCE(v_src_row.nombre, '')) > length(COALESCE(v_dst_row.nombre, '')) THEN v_src_row.nombre ELSE v_dst_row.nombre END,
      seleccionar_peticion = COALESCE(v_dst_row.seleccionar_peticion, v_src_row.seleccionar_peticion),
      mensajes_preferencias = COALESCE(v_dst_row.mensajes_preferencias, v_src_row.mensajes_preferencias)
    WHERE id = dst;
  ELSE
    UPDATE mmc_leads SET
      email         = COALESCE(email, v_src_row.email),
      telefono      = COALESCE(telefono, v_src_row.telefono),
      modelo_raw    = COALESCE(modelo_raw, v_src_row.modelo_raw),
      seleccionar_peticion = COALESCE(seleccionar_peticion, v_src_row.seleccionar_peticion),
      mensajes_preferencias = COALESCE(mensajes_preferencias, v_src_row.mensajes_preferencias)
    WHERE id = dst;
  END IF;

  DELETE FROM mmc_leads WHERE id = src;
END;
$$;

-- Ejecutar dedupe iterativo
DO $DED$
DECLARE
  v_rec RECORD;
  v_ids uuid[];
  v_master uuid;
  v_i int;
  v_iter int := 0;
  v_merged int;
BEGIN
  LOOP
    v_iter := v_iter + 1;
    v_merged := 0;

    FOR v_rec IN
      SELECT lower(email) AS k, array_agg(id ORDER BY fecha_entrada DESC) AS ids
      FROM mmc_leads
      WHERE email IS NOT NULL AND email <> ''
      GROUP BY lower(email)
      HAVING count(*) > 1
    LOOP
      v_ids := v_rec.ids;
      v_master := v_ids[1];
      FOR v_i IN 2..array_length(v_ids, 1) LOOP
        PERFORM mmc_merge_leads(v_ids[v_i], v_master);
        v_merged := v_merged + 1;
      END LOOP;
    END LOOP;

    FOR v_rec IN
      SELECT telefono_normalized AS k, array_agg(id ORDER BY fecha_entrada DESC) AS ids
      FROM mmc_leads
      WHERE telefono_normalized IS NOT NULL AND telefono_normalized <> ''
      GROUP BY telefono_normalized
      HAVING count(*) > 1
    LOOP
      v_ids := v_rec.ids;
      v_master := v_ids[1];
      FOR v_i IN 2..array_length(v_ids, 1) LOOP
        PERFORM mmc_merge_leads(v_ids[v_i], v_master);
        v_merged := v_merged + 1;
      END LOOP;
    END LOOP;

    RAISE NOTICE 'iter % merged=%', v_iter, v_merged;
    EXIT WHEN v_merged = 0 OR v_iter >= 10;
  END LOOP;
END;
$DED$;

-- Verificar
SELECT 'emails dup' tipo, count(*) FROM (SELECT lower(email) FROM mmc_leads WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*) > 1) t
UNION ALL
SELECT 'tel dup', count(*) FROM (SELECT telefono_normalized FROM mmc_leads WHERE telefono_normalized IS NOT NULL GROUP BY telefono_normalized HAVING count(*) > 1) t
UNION ALL
SELECT 'total leads', count(*) FROM mmc_leads
UNION ALL
SELECT 'total inbounds', count(*) FROM mmc_lead_inbounds;
