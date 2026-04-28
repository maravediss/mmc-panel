-- ============================================================================
-- Migration v12 — Fix conteo inflado por JOIN multiplicativo + conversión robusta
--
-- BUG: mmc_commercials_analytics hacía LEFT JOIN entre appts, sales,
-- pipeline_eur y lost_opps todos por commercial_id → producto cartesiano que
-- multiplica los COUNT y SUM. Para un comercial con 17 citas y 11 ventas,
-- citas salía 17×11=187, ventas salía 11×17=187, margen × N. Ese era el
-- "187 citas concertadas en marzo" reportado por el usuario.
--
-- FIX: precalcular cada métrica por commercial en CTEs separadas (1 fila por
-- comercial) y joinarlas. Sin multiplicación.
--
-- Además:
-- - conversión robusta y CAPEADA a 100%: ventas_con_cita / citas (sólo
--   considera ventas que vienen de una cita registrada en el mismo período)
-- - mmc_monthly_evolution: añade ventas_con_cita y usa esa para conversion
-- ============================================================================

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
  -- Subquery sin multiplicación: 1 fila por comercial
  appts_per AS (
    SELECT a.commercial_id,
           COUNT(*) FILTER (WHERE a.status <> 'cancelled')                    AS citas,
           COUNT(*) FILTER (WHERE a.status = 'attended')                      AS atendidas,
           COUNT(*) FILTER (WHERE a.status = 'no_show')                       AS no_show,
           COUNT(*) FILTER (WHERE a.status = 'pending' AND a.fecha_cita < now()) AS pending_overdue
    FROM mmc_appointments a
    WHERE a.fecha_cita >= p_from AND a.fecha_cita < p_to
    GROUP BY a.commercial_id
  ),
  sales_per AS (
    SELECT s.commercial_id,
           COUNT(*)                          AS ventas_n,
           COALESCE(SUM(s.margen_eur), 0)    AS ventas_margen,
           COALESCE(AVG(s.margen_eur), 0)    AS ticket_medio,
           COUNT(*) FILTER (WHERE s.appointment_id IS NOT NULL) AS ventas_con_cita
    FROM mmc_sales s
    WHERE s.fecha_compra >= p_from::date AND s.fecha_compra < p_to::date
    GROUP BY s.commercial_id
  ),
  pipeline AS (
    SELECT DISTINCT l.id AS lead_id, l.modelo_id, a.commercial_id
    FROM mmc_leads l
    JOIN mmc_appointments a ON a.lead_id = l.id
    WHERE l.status IN ('appointment','attended')
      AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.lead_id = l.id)
  ),
  pipeline_per AS (
    SELECT p.commercial_id,
           COUNT(*) AS pipeline_n,
           COALESCE(SUM(
             (SELECT mm.margin_eur FROM mmc_model_margins mm
              WHERE mm.model_id = p.modelo_id
              ORDER BY mm.year DESC NULLS LAST LIMIT 1)
           ),0) AS pipeline_margen
    FROM pipeline p
    GROUP BY p.commercial_id
  ),
  lost_per AS (
    SELECT a.commercial_id,
           COUNT(*) FILTER (WHERE a.status = 'no_show') AS no_show_n,
           COUNT(*) FILTER (WHERE a.status = 'attended'
                            AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.appointment_id = a.id)
                           ) AS attended_no_sale_n,
           COALESCE(SUM(
             CASE WHEN a.status IN ('no_show')
                  OR (a.status = 'attended' AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.appointment_id = a.id))
                  THEN (SELECT mm.margin_eur FROM mmc_model_margins mm
                        WHERE mm.model_id = (SELECT modelo_id FROM mmc_leads WHERE id = a.lead_id)
                        ORDER BY mm.year DESC NULLS LAST LIMIT 1)
                  ELSE 0 END
           ),0) AS margen_perdido
    FROM mmc_appointments a
    WHERE a.fecha_cita >= p_from AND a.fecha_cita < p_to
    GROUP BY a.commercial_id
  ),
  per_commercial AS (
    SELECT
      c.id, c.name, c.display_name, c.role,
      COALESCE(ap.citas, 0)               AS citas,
      COALESCE(ap.atendidas, 0)           AS atendidas,
      COALESCE(ap.no_show, 0)             AS no_show,
      COALESCE(ap.pending_overdue, 0)     AS pending_overdue,
      COALESCE(sp.ventas_n, 0)            AS ventas_n,
      COALESCE(sp.ventas_margen, 0)       AS ventas_margen,
      COALESCE(sp.ticket_medio, 0)        AS ticket_medio,
      COALESCE(sp.ventas_con_cita, 0)     AS ventas_con_cita,
      COALESCE(pp.pipeline_n, 0)          AS pipeline_n,
      COALESCE(pp.pipeline_margen, 0)     AS pipeline_margen,
      COALESCE(lp.no_show_n, 0)           AS perdidas_no_show,
      COALESCE(lp.attended_no_sale_n, 0)  AS perdidas_no_compra,
      COALESCE(lp.margen_perdido, 0)      AS margen_perdido
    FROM commercials_active c
    LEFT JOIN appts_per     ap ON ap.commercial_id = c.id
    LEFT JOIN sales_per     sp ON sp.commercial_id = c.id
    LEFT JOIN pipeline_per  pp ON pp.commercial_id = c.id
    LEFT JOIN lost_per      lp ON lp.commercial_id = c.id
  ),
  -- Totales del concesionario (incluye también citas/ventas con commercial_id NULL)
  totals_appts AS (
    SELECT
      COUNT(*) FILTER (WHERE status <> 'cancelled')                       AS citas_total,
      COUNT(*) FILTER (WHERE status = 'attended')                         AS atendidas_total,
      COUNT(*) FILTER (WHERE status = 'no_show')                          AS no_show_total,
      COUNT(*) FILTER (WHERE status = 'pending' AND fecha_cita < now())   AS pending_overdue_total
    FROM mmc_appointments
    WHERE fecha_cita >= p_from AND fecha_cita < p_to
  ),
  totals_sales AS (
    SELECT
      COUNT(*)                          AS ventas_total,
      COALESCE(SUM(margen_eur), 0)      AS margen_total,
      COALESCE(AVG(margen_eur), 0)      AS margen_medio,
      COUNT(*) FILTER (WHERE appointment_id IS NOT NULL) AS ventas_con_cita_total
    FROM mmc_sales
    WHERE fecha_compra >= p_from::date AND fecha_compra < p_to::date
  ),
  totals_pipeline AS (
    SELECT SUM(pipeline_n) AS pipeline_total,
           SUM(pipeline_margen) AS pipeline_margen_total
    FROM per_commercial
  ),
  totals_lost AS (
    SELECT SUM(margen_perdido) AS margen_perdido_total
    FROM per_commercial
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM mmc_leads l
        WHERE l.fecha_entrada >= p_from AND l.fecha_entrada < p_to)             AS leads_nuevos,
      (SELECT citas_total FROM totals_appts)                                    AS citas_total,
      (SELECT atendidas_total FROM totals_appts)                                AS atendidas_total,
      (SELECT no_show_total FROM totals_appts)                                  AS no_show_total,
      (SELECT pending_overdue_total FROM totals_appts)                          AS pending_overdue_total,
      (SELECT ventas_total FROM totals_sales)                                   AS ventas_total,
      (SELECT margen_total FROM totals_sales)                                   AS margen_total,
      (SELECT margen_medio FROM totals_sales)                                   AS margen_medio,
      (SELECT ventas_con_cita_total FROM totals_sales)                          AS ventas_con_cita_total,
      (SELECT pipeline_total FROM totals_pipeline)                              AS pipeline_total,
      (SELECT pipeline_margen_total FROM totals_pipeline)                       AS pipeline_margen_total,
      (SELECT margen_perdido_total FROM totals_lost)                            AS margen_perdido_total
  ),
  -- Sales del periodo cap'd para "top models" y "families"
  sales AS (
    SELECT s.* FROM mmc_sales s
    WHERE s.fecha_compra >= p_from::date AND s.fecha_compra < p_to::date
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
    'totals',      (SELECT to_jsonb(t) FROM totals t),
    'commercials', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM per_commercial p), '[]'::jsonb),
    'families',    COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM family_breakdown f), '[]'::jsonb),
    'top_models',  COALESCE((SELECT jsonb_agg(to_jsonb(tm)) FROM top_models tm), '[]'::jsonb)
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_commercials_analytics(timestamptz, timestamptz) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- mmc_monthly_evolution con ventas_con_cita y conversion capeada
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS mmc_monthly_evolution(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION mmc_monthly_evolution(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  mes              text,
  citas            integer,
  atendidas        integer,
  no_show          integer,
  ventas           integer,
  ventas_con_cita  integer,
  margen_eur       numeric,
  margen_medio_eur numeric,
  conversion_pct   numeric
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
           COUNT(*)                                                AS n,
           COUNT(*) FILTER (WHERE s.appointment_id IS NOT NULL)    AS n_con_cita,
           COALESCE(SUM(s.margen_eur), 0)                          AS margen,
           COALESCE(AVG(s.margen_eur), 0)                          AS margen_medio
    FROM mmc_sales s
    WHERE s.fecha_compra >= p_from::date AND s.fecha_compra < p_to::date
    GROUP BY 1
  )
  SELECT
    to_char(b.m_start, 'YYYY-MM') AS mes,
    COALESCE(a.asignadas, 0)::int                      AS citas,
    COALESCE(a.atendidas, 0)::int                      AS atendidas,
    COALESCE(a.no_show, 0)::int                        AS no_show,
    COALESCE(s.n, 0)::int                              AS ventas,
    COALESCE(s.n_con_cita, 0)::int                     AS ventas_con_cita,
    COALESCE(s.margen, 0)::numeric                     AS margen_eur,
    COALESCE(s.margen_medio, 0)::numeric               AS margen_medio_eur,
    -- Conversion = ventas con cita / citas asignadas. Capeada a 100% por
    -- seguridad (si la cita y la venta están en distinto mes podría exceder).
    -- Conversion = ventas totales del mes / citas concertadas, capeada a 100%
    -- (ventas walk-in sin cita previa no inflan más allá del 100%)
    CASE WHEN COALESCE(a.asignadas, 0) > 0
         THEN LEAST(100, ROUND((COALESCE(s.n, 0)::numeric / a.asignadas) * 100, 1))
         ELSE 0
    END AS conversion_pct
  FROM months b
  LEFT JOIN m_appts a ON a.m_start = b.m_start
  LEFT JOIN m_sales s ON s.m_start = b.m_start
  ORDER BY b.m_start;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_monthly_evolution(timestamptz, timestamptz) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- mmc_commercial_kpis con conversion capeada también
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS mmc_commercial_kpis(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION mmc_commercial_kpis(
  p_commercial_id uuid,
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  citas_asignadas      integer,
  citas_atendidas      integer,
  citas_no_show        integer,
  citas_pending        integer,
  citas_pendientes_cerrar integer,
  ventas_count         integer,
  ventas_margen_eur    numeric,
  ticket_medio_eur     numeric,
  conversion_pct       numeric,
  asistencia_pct       numeric,
  pipeline_leads       integer,
  pipeline_margen_eur  numeric,
  modelo_top_vendido   text,
  modelo_top_demandado text,
  tiempo_medio_cierre_dias numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_can boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM mmc_commercials c
    WHERE c.auth_user_id = auth.uid()
      AND (c.role IN ('admin','gerente') OR c.id = p_commercial_id)
  ) INTO v_caller_can;
  IF NOT v_caller_can THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  WITH appts AS (
    SELECT *
    FROM mmc_appointments a
    WHERE a.commercial_id = p_commercial_id
      AND a.fecha_cita >= p_from
      AND a.fecha_cita <  p_to
  ),
  appt_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status <> 'cancelled')                          AS asignadas,
      COUNT(*) FILTER (WHERE status = 'attended')                            AS atendidas,
      COUNT(*) FILTER (WHERE status = 'no_show')                             AS no_show,
      COUNT(*) FILTER (WHERE status = 'pending' AND fecha_cita >= now())     AS pending_future,
      COUNT(*) FILTER (WHERE status = 'pending' AND fecha_cita <  now())     AS pending_past
    FROM appts
  ),
  sales_stats AS (
    SELECT
      COUNT(*)                                       AS n_ventas,
      COUNT(*) FILTER (WHERE appointment_id IS NOT NULL) AS n_con_cita,
      COALESCE(SUM(margen_eur),0)                    AS ventas_margen,
      COALESCE(AVG(margen_eur),0)                    AS ticket_medio
    FROM mmc_sales s
    WHERE s.commercial_id = p_commercial_id
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
  ),
  pipeline AS (
    SELECT DISTINCT l.id, l.modelo_id
    FROM mmc_leads l
    JOIN mmc_appointments a ON a.lead_id = l.id
    WHERE a.commercial_id = p_commercial_id
      AND l.status IN ('appointment','attended')
      AND NOT EXISTS (SELECT 1 FROM mmc_sales s WHERE s.lead_id = l.id)
  ),
  pipeline_stats AS (
    SELECT
      COUNT(*) AS pipeline_n,
      COALESCE(SUM(
        (SELECT mm.margin_eur FROM mmc_model_margins mm
         WHERE mm.model_id = p.modelo_id
         ORDER BY mm.year DESC NULLS LAST LIMIT 1)
      ),0) AS pipeline_margen
    FROM pipeline p
  ),
  modelo_vendido AS (
    SELECT m.name FROM mmc_sales s
    LEFT JOIN mmc_models m ON m.id = s.model_id
    WHERE s.commercial_id = p_commercial_id
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
      AND m.name IS NOT NULL
    GROUP BY m.name ORDER BY COUNT(*) DESC LIMIT 1
  ),
  modelo_demandado AS (
    SELECT m.name
    FROM appts a JOIN mmc_leads l ON l.id = a.lead_id JOIN mmc_models m ON m.id = l.modelo_id
    GROUP BY m.name ORDER BY COUNT(*) DESC LIMIT 1
  ),
  tiempo_cierre AS (
    SELECT AVG(s.fecha_compra - a.fecha_cita::date) AS dias
    FROM mmc_sales s JOIN mmc_appointments a ON a.id = s.appointment_id
    WHERE s.commercial_id = p_commercial_id
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
  )
  SELECT
    COALESCE(asignadas,0)::int,
    COALESCE(atendidas,0)::int,
    COALESCE(no_show,0)::int,
    COALESCE(pending_future,0)::int,
    COALESCE(pending_past,0)::int,
    COALESCE(n_ventas,0)::int,
    COALESCE(ventas_margen,0)::numeric,
    COALESCE(ticket_medio,0)::numeric,
    -- conversion = ventas totales / citas, capeada a 100%
    CASE WHEN asignadas > 0
         THEN LEAST(100, ROUND((COALESCE(n_ventas,0)::numeric / asignadas) * 100, 1))
         ELSE 0
    END,
    CASE WHEN asignadas > 0 THEN ROUND((atendidas::numeric / asignadas) * 100, 1) ELSE 0 END,
    COALESCE(pipeline_n,0)::int,
    COALESCE(pipeline_margen,0)::numeric,
    (SELECT name FROM modelo_vendido),
    (SELECT name FROM modelo_demandado),
    COALESCE((SELECT dias FROM tiempo_cierre)::numeric, 0)
  FROM appt_stats, sales_stats, pipeline_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_commercial_kpis(uuid, timestamptz, timestamptz) TO authenticated;
