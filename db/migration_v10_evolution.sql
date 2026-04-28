-- ============================================================================
-- Migration v10 — Evolución mensual + ampliación analytics
--
-- 1) RPC mmc_monthly_evolution(p_from, p_to):
--    devuelve un array de meses con leads_nuevos, citas, atendidas, ventas,
--    margen, conversion_pct, ticket_medio. Usado por /comercial/analitica
--    para tabla y gráfica evolutiva mensual.
--
-- 2) Re-creación mmc_commercials_analytics: añadimos 'leads_nuevos' a totals
--    para que se vea cuántos leads entraron en el período.
-- ============================================================================

DROP FUNCTION IF EXISTS mmc_monthly_evolution(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION mmc_monthly_evolution(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  mes              text,           -- 'YYYY-MM'
  mes_label        text,           -- 'ene 2026'
  leads_nuevos     integer,
  citas            integer,
  atendidas        integer,
  no_show          integer,
  ventas           integer,
  margen_eur       numeric,
  ticket_medio_eur numeric,
  conversion_pct   numeric          -- ventas / atendidas
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM mmc_commercials c WHERE c.auth_user_id = auth.uid()
  ) INTO v_authed;
  IF NOT v_authed THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', p_from),
      date_trunc('month', p_to - interval '1 day'),
      interval '1 month'
    )::date AS m_start
  ),
  m_bounds AS (
    SELECT m_start,
           (m_start + interval '1 month')::date AS m_end
    FROM months
  ),
  m_leads AS (
    SELECT date_trunc('month', l.fecha_entrada)::date AS m_start, COUNT(*) AS n
    FROM mmc_leads l
    WHERE l.fecha_entrada >= p_from AND l.fecha_entrada < p_to
    GROUP BY 1
  ),
  m_appts AS (
    SELECT date_trunc('month', a.fecha_cita)::date AS m_start,
           COUNT(*) FILTER (WHERE a.status <> 'cancelled') AS asignadas,
           COUNT(*) FILTER (WHERE a.status = 'attended')   AS atendidas,
           COUNT(*) FILTER (WHERE a.status = 'no_show')    AS no_show
    FROM mmc_appointments a
    WHERE a.fecha_cita >= p_from AND a.fecha_cita < p_to
    GROUP BY 1
  ),
  m_sales AS (
    SELECT date_trunc('month', s.fecha_compra)::date AS m_start,
           COUNT(*) AS n,
           COALESCE(SUM(s.margen_eur), 0) AS margen,
           COALESCE(AVG(s.margen_eur), 0) AS ticket
    FROM mmc_sales s
    WHERE s.fecha_compra >= p_from::date AND s.fecha_compra < p_to::date
    GROUP BY 1
  )
  SELECT
    to_char(b.m_start, 'YYYY-MM') AS mes,
    TRIM(to_char(b.m_start, 'TMMon YYYY')) AS mes_label,
    COALESCE(l.n, 0)::int                              AS leads_nuevos,
    COALESCE(a.asignadas, 0)::int                      AS citas,
    COALESCE(a.atendidas, 0)::int                      AS atendidas,
    COALESCE(a.no_show, 0)::int                        AS no_show,
    COALESCE(s.n, 0)::int                              AS ventas,
    COALESCE(s.margen, 0)::numeric                     AS margen_eur,
    COALESCE(s.ticket, 0)::numeric                     AS ticket_medio_eur,
    -- Conversión robusta: ventas / citas no canceladas (en este sheet hay
    -- ventas sin cita "attended" marcada, así que usamos asignadas como base)
    CASE WHEN COALESCE(a.asignadas, 0) > 0
         THEN ROUND((COALESCE(s.n, 0)::numeric / a.asignadas) * 100, 1)
         ELSE 0
    END AS conversion_pct
  FROM m_bounds b
  LEFT JOIN m_leads l ON l.m_start = b.m_start
  LEFT JOIN m_appts a ON a.m_start = b.m_start
  LEFT JOIN m_sales s ON s.m_start = b.m_start
  ORDER BY b.m_start;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_monthly_evolution(timestamptz, timestamptz) TO authenticated;


-- Re-recreación de analytics con leads_nuevos en totals
DROP FUNCTION IF EXISTS mmc_commercials_analytics(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION mmc_commercials_analytics(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authed boolean;
  v_payload jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM mmc_commercials c WHERE c.auth_user_id = auth.uid()
  ) INTO v_authed;
  IF NOT v_authed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH commercials_active AS (
    SELECT id, name, display_name, role, is_active
    FROM mmc_commercials
    WHERE is_active = true AND role IN ('comercial','gerente','admin')
  ),
  appts AS (
    SELECT a.*
    FROM mmc_appointments a
    WHERE a.commercial_id IN (SELECT id FROM commercials_active)
      AND a.fecha_cita >= p_from
      AND a.fecha_cita <  p_to
  ),
  sales AS (
    SELECT s.*
    FROM mmc_sales s
    WHERE s.commercial_id IN (SELECT id FROM commercials_active)
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
  ),
  pipeline AS (
    SELECT DISTINCT l.id AS lead_id, l.modelo_id, a.commercial_id
    FROM mmc_leads l
    JOIN mmc_appointments a ON a.lead_id = l.id
    WHERE l.status IN ('appointment','attended')
      AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.lead_id = l.id)
  ),
  pipeline_eur AS (
    SELECT p.commercial_id,
           COUNT(*) AS leads,
           COALESCE(SUM(
             (SELECT mm.margin_eur FROM mmc_model_margins mm
              WHERE mm.model_id = p.modelo_id
              ORDER BY mm.year DESC NULLS LAST LIMIT 1)
           ),0) AS margen
    FROM pipeline p
    GROUP BY p.commercial_id
  ),
  lost_opps AS (
    SELECT a.commercial_id,
           COUNT(*) FILTER (WHERE a.status = 'no_show')              AS no_show_n,
           COUNT(*) FILTER (WHERE a.status = 'attended'
                            AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.appointment_id = a.id)
                           )                                          AS attended_no_sale_n,
           COALESCE(SUM(
             CASE WHEN a.status IN ('no_show')
                  OR (a.status = 'attended' AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.appointment_id = a.id))
                  THEN (SELECT mm.margin_eur FROM mmc_model_margins mm
                        WHERE mm.model_id = (SELECT modelo_id FROM mmc_leads WHERE id = a.lead_id)
                        ORDER BY mm.year DESC NULLS LAST LIMIT 1)
                  ELSE 0 END
           ),0) AS margen_perdido
    FROM appts a
    GROUP BY a.commercial_id
  ),
  per_commercial AS (
    SELECT
      c.id, c.name, c.display_name, c.role,
      COUNT(a.id) FILTER (WHERE a.status <> 'cancelled')                AS citas,
      COUNT(a.id) FILTER (WHERE a.status = 'attended')                  AS atendidas,
      COUNT(a.id) FILTER (WHERE a.status = 'no_show')                   AS no_show,
      COUNT(a.id) FILTER (WHERE a.status = 'pending' AND a.fecha_cita < now()) AS pending_overdue,
      COUNT(s.id)                                                       AS ventas_n,
      COALESCE(SUM(s.margen_eur),0)                                     AS ventas_margen,
      COALESCE(AVG(s.margen_eur),0)                                     AS ticket_medio,
      COALESCE(pe.leads, 0)                                             AS pipeline_n,
      COALESCE(pe.margen, 0)                                            AS pipeline_margen,
      COALESCE(lo.no_show_n, 0)                                         AS perdidas_no_show,
      COALESCE(lo.attended_no_sale_n, 0)                                AS perdidas_no_compra,
      COALESCE(lo.margen_perdido, 0)                                    AS margen_perdido
    FROM commercials_active c
    LEFT JOIN appts          a ON a.commercial_id = c.id
    LEFT JOIN sales          s ON s.commercial_id = c.id
    LEFT JOIN pipeline_eur   pe ON pe.commercial_id = c.id
    LEFT JOIN lost_opps      lo ON lo.commercial_id = c.id
    GROUP BY c.id, c.name, c.display_name, c.role, pe.leads, pe.margen,
             lo.no_show_n, lo.attended_no_sale_n, lo.margen_perdido
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM mmc_leads l
        WHERE l.fecha_entrada >= p_from AND l.fecha_entrada < p_to) AS leads_nuevos,
      SUM(citas)                          AS citas_total,
      SUM(atendidas)                      AS atendidas_total,
      SUM(no_show)                        AS no_show_total,
      SUM(pending_overdue)                AS pending_overdue_total,
      SUM(ventas_n)                       AS ventas_total,
      SUM(ventas_margen)                  AS margen_total,
      AVG(NULLIF(ticket_medio,0))         AS ticket_global,
      SUM(pipeline_n)                     AS pipeline_total,
      SUM(pipeline_margen)                AS pipeline_margen_total,
      SUM(margen_perdido)                 AS margen_perdido_total
    FROM per_commercial
  ),
  family_breakdown AS (
    SELECT m.family, COUNT(*) AS n, COALESCE(SUM(s.margen_eur),0) AS margen
    FROM sales s
    LEFT JOIN mmc_models m ON m.id = s.model_id
    WHERE m.family IS NOT NULL
    GROUP BY m.family
  ),
  top_models AS (
    SELECT m.name, COUNT(*) AS n, COALESCE(SUM(s.margen_eur),0) AS margen
    FROM sales s
    LEFT JOIN mmc_models m ON m.id = s.model_id
    WHERE m.name IS NOT NULL
    GROUP BY m.name
    ORDER BY n DESC, margen DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'commercials', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM per_commercial p), '[]'::jsonb),
    'families',   COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM family_breakdown f), '[]'::jsonb),
    'top_models', COALESCE((SELECT jsonb_agg(to_jsonb(tm)) FROM top_models tm), '[]'::jsonb)
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_commercials_analytics(timestamptz, timestamptz) TO authenticated;
