-- ============================================================================
-- Migration v8 — Panel Comercial (Capa 1: Visibilidad)
--
-- Añade el campo alert_email a comerciales (preparado para Capa 2 — alertas
-- por email) y expone una RPC mmc_commercial_kpis para alimentar el dashboard
-- /comercial con los KPIs de cualquier período sin replicar SQL en el cliente.
-- ============================================================================

-- 1) Campo de email para alertas (canal principal en Capa 2)
ALTER TABLE mmc_commercials
  ADD COLUMN IF NOT EXISTS alert_email text;

-- 2) RPC: KPIs de un comercial para un rango [from, to]
-- Devuelve una sola fila con todos los KPIs. Llamable desde anon/authenticated:
-- la RLS habitual ya filtra por comercial, pero hacemos SECURITY DEFINER + chequeo
-- explícito para que un comercial sólo pueda consultar los suyos.
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
  citas_pendientes_cerrar integer,  -- pasadas con status pending
  ventas_count         integer,
  ventas_margen_eur    numeric,
  ticket_medio_eur     numeric,
  conversion_pct       numeric,     -- ventas / citas atendidas
  asistencia_pct       numeric,     -- atendidas / asignadas (excluye cancelled)
  pipeline_leads       integer,     -- mis leads en appointment/attended sin venta
  pipeline_margen_eur  numeric,     -- suma margen estimado del pipeline
  modelo_top_vendido   text,
  modelo_top_demandado text,
  tiempo_medio_cierre_dias numeric  -- citas atendidas → fecha_compra
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller_can boolean;
BEGIN
  -- Chequeo de autorización: el caller debe ser admin/gerente o el propio comercial
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
      COALESCE(SUM(margen_eur),0)                    AS margen,
      COALESCE(AVG(margen_eur),0)                    AS ticket
    FROM mmc_sales s
    WHERE s.commercial_id = p_commercial_id
      AND s.fecha_compra >= p_from::date
      AND s.fecha_compra <  p_to::date
  ),
  -- Pipeline = leads del comercial con cita asignada que no han cerrado venta
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
      COUNT(*)                                                   AS leads,
      COALESCE(SUM(
        (SELECT mm.margin_eur FROM mmc_model_margins mm
         WHERE mm.model_id = p.modelo_id
         ORDER BY mm.year DESC NULLS LAST LIMIT 1)
      ),0)                                                       AS margen
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
    COALESCE(margen,0)::numeric,
    COALESCE(ticket,0)::numeric,
    CASE WHEN atendidas > 0 THEN ROUND((n_ventas::numeric / atendidas) * 100, 1) ELSE 0 END,
    CASE WHEN asignadas > 0 THEN ROUND((atendidas::numeric / asignadas) * 100, 1) ELSE 0 END,
    COALESCE(ps.leads,0)::int,
    COALESCE(ps.margen,0)::numeric,
    (SELECT name FROM modelo_vendido),
    (SELECT name FROM modelo_demandado),
    COALESCE((SELECT dias FROM tiempo_cierre)::numeric, 0)
  FROM appt_stats, sales_stats, pipeline_stats ps;
END;
$$;

GRANT EXECUTE ON FUNCTION mmc_commercial_kpis(uuid, timestamptz, timestamptz) TO authenticated;

-- 3) Vista de embudo personal (leads asignados → citas → asistencia → ventas)
DROP VIEW IF EXISTS mmc_v_commercial_funnel;
CREATE VIEW mmc_v_commercial_funnel
  WITH (security_invoker = true) AS
SELECT
  c.id AS commercial_id,
  COUNT(DISTINCT l.id)                                              AS leads_asignados,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status <> 'cancelled')       AS citas,
  COUNT(DISTINCT a.id) FILTER (WHERE a.status = 'attended')         AS atendidas,
  COUNT(DISTINCT s.id)                                              AS ventas,
  COALESCE(SUM(s.margen_eur),0)                                     AS margen_total
FROM mmc_commercials c
LEFT JOIN mmc_appointments a ON a.commercial_id = c.id
LEFT JOIN mmc_leads        l ON l.id = a.lead_id
LEFT JOIN mmc_sales        s ON s.commercial_id = c.id
WHERE c.is_active
GROUP BY c.id;

-- 4) Vista compacta para listado de "mis citas" — incluye lead, modelo y margen
DROP VIEW IF EXISTS mmc_v_appointments_full;
CREATE VIEW mmc_v_appointments_full
  WITH (security_invoker = true) AS
SELECT
  a.id,
  a.commercial_id,
  a.lead_id,
  a.tipo,
  a.fecha_cita,
  a.status,
  a.notes,
  a.no_show_motivo,
  a.attended_at,
  a.closed_at,
  a.created_at,
  l.nombre        AS lead_nombre,
  l.telefono      AS lead_telefono,
  l.email         AS lead_email,
  l.modelo_raw    AS lead_modelo_raw,
  l.origen        AS lead_origen,
  l.formulario    AS lead_formulario,
  m.name          AS modelo_oficial,
  m.family        AS modelo_family,
  (SELECT mm.margin_eur FROM mmc_model_margins mm
    WHERE mm.model_id = l.modelo_id
    ORDER BY mm.year DESC NULLS LAST LIMIT 1) AS margen_estimado,
  -- Indicador derivado: cita pasada sin cerrar
  (a.status = 'pending' AND a.fecha_cita < now()) AS is_pending_overdue
FROM mmc_appointments a
LEFT JOIN mmc_leads  l ON l.id = a.lead_id
LEFT JOIN mmc_models m ON m.id = l.modelo_id;

GRANT SELECT ON mmc_v_appointments_full TO authenticated;
GRANT SELECT ON mmc_v_commercial_funnel TO authenticated;
