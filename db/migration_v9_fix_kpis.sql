-- ============================================================================
-- Migration v9 — Fixes y ampliaciones del Panel Comercial
--
-- 1) Bug crítico v8: el RPC mmc_commercial_kpis devolvía siempre el error
--    "column reference 'margen' is ambiguous" porque sales_stats y
--    pipeline_stats usaban el mismo alias. Renombramos columnas internas.
-- 2) Añadimos RPC mmc_commercials_analytics — agregado para /comercial/analitica
--    con ranking, métricas de oportunidad perdida y potencial.
-- ============================================================================

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

  IF NOT v_caller_can THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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
      COUNT(*)                                                   AS pipeline_n,
      COALESCE(SUM(
        (SELECT mm.margin_eur FROM mmc_model_margins mm
         WHERE mm.model_id = p.modelo_id
         ORDER BY mm.year DESC NULLS LAST LIMIT 1)
      ),0)                                                       AS pipeline_margen
    FROM pipeline p
  ),
  modelo_vendido AS (
    SELECT m.name
    FROM mmc_sales s
    LEFT JOIN mmc_models m ON m.id = s.model_id
    WHERE s.commercial_id = p_commercial_id
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
      AND m.name IS NOT NULL
    GROUP BY m.name
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  modelo_demandado AS (
    SELECT m.name
    FROM appts a
    JOIN mmc_leads  l ON l.id = a.lead_id
    JOIN mmc_models m ON m.id = l.modelo_id
    GROUP BY m.name
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ),
  tiempo_cierre AS (
    SELECT AVG(s.fecha_compra - a.fecha_cita::date) AS dias
    FROM mmc_sales s
    JOIN mmc_appointments a ON a.id = s.appointment_id
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
    CASE WHEN atendidas > 0 THEN ROUND((n_ventas::numeric / atendidas) * 100, 1) ELSE 0 END,
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


-- ============================================================================
-- Analítica agregada del concesionario — para /comercial/analitica
-- Devuelve un payload completo: KPIs globales, ranking por comercial, citas
-- pasadas sin cerrar, oportunidad perdida, potencial activo, ranking ventas y
-- ranking conversión. Cualquier rol con sesión válida puede llamarla — la
-- página luego decide qué mostrar según rol.
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
  appts AS (
    SELECT a.*
    FROM mmc_appointments a
    WHERE a.commercial_id IN (SELECT id FROM commercials_active)
      AND a.fecha_cita >= p_from
      AND a.fecha_cita <  p_to
  ),
  sales AS (
    SELECT s.*, mm.margin_eur AS margin_catalog
    FROM mmc_sales s
    LEFT JOIN mmc_model_margins mm ON mm.model_id = s.model_id
       AND mm.year = (
         SELECT MAX(year) FROM mmc_model_margins WHERE model_id = s.model_id
       )
    WHERE s.commercial_id IN (SELECT id FROM commercials_active)
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
  ),
  -- Pipeline activo (citas futuras + attended sin venta cerrada) por comercial
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
  -- Oportunidad perdida = margen estimado de citas no_show + asistencia sin venta
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
