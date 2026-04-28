-- ============================================================================
-- Migration v11 — Conversion robusta + nombres de mes en español
--
-- En el sheet hay ventas registradas sin que la cita previa esté marcada como
-- 'attended' (típico del flujo manual). La fórmula ventas/atendidas explota
-- (200%, 300%) o sale 0. Cambiamos a ventas/(citas no canceladas) que es más
-- estable y sigue siendo significativa.
--
-- Re-aplicamos v10 RPC mmc_monthly_evolution con conversión sobre asignadas y
-- quitamos el mes_label del SQL (lo formateo en JS para que salga en español).
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
    -- Conversión robusta: ventas / citas no canceladas (no /atendidas porque
    -- los datos del sheet no marcan attended fiable cuando se vende)
    CASE WHEN asignadas > 0
         THEN ROUND((n_ventas::numeric / asignadas) * 100, 1)
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


-- Re-aplicamos monthly_evolution con conversion ventas/asignadas y quitamos
-- mes_label (se formatea en JS con locale 'es')
DROP FUNCTION IF EXISTS mmc_monthly_evolution(timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION mmc_monthly_evolution(
  p_from timestamptz,
  p_to   timestamptz
)
RETURNS TABLE (
  mes              text,
  leads_nuevos     integer,
  citas            integer,
  atendidas        integer,
  no_show          integer,
  ventas           integer,
  margen_eur       numeric,
  ticket_medio_eur numeric,
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
    COALESCE(l.n, 0)::int                              AS leads_nuevos,
    COALESCE(a.asignadas, 0)::int                      AS citas,
    COALESCE(a.atendidas, 0)::int                      AS atendidas,
    COALESCE(a.no_show, 0)::int                        AS no_show,
    COALESCE(s.n, 0)::int                              AS ventas,
    COALESCE(s.margen, 0)::numeric                     AS margen_eur,
    COALESCE(s.ticket, 0)::numeric                     AS ticket_medio_eur,
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
