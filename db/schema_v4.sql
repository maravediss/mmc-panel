-- ============================================================================
-- Schema v4 — Integración Microsoft Bookings
-- - graph_event_id en mmc_appointments (cruce con evento Graph)
-- - graph_last_sync_at para polling incremental
-- - email real en mmc_commercials (para attendee en eventos Graph)
-- - service_id opcional (cuando creemos los 3 servicios separados en Bookings)
-- ============================================================================

-- Campos Bookings en mmc_appointments
ALTER TABLE mmc_appointments
  ADD COLUMN IF NOT EXISTS graph_event_id       text UNIQUE,
  ADD COLUMN IF NOT EXISTS graph_ical_uid       text,
  ADD COLUMN IF NOT EXISTS graph_booking_service_id text,     -- relleno si se usa el API /solutions/bookingBusinesses
  ADD COLUMN IF NOT EXISTS graph_organizer_email text,
  ADD COLUMN IF NOT EXISTS graph_last_sync_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sync_source          text DEFAULT 'panel';  -- 'panel' | 'bookings_ui' | 'graph_api'

CREATE INDEX IF NOT EXISTS idx_mmc_appts_graph_event ON mmc_appointments(graph_event_id) WHERE graph_event_id IS NOT NULL;

-- Vincular mmc_commercials con su email real del concesionario (para attendees de eventos)
-- (el email ya existe como columna, sólo nos aseguramos que tienen el correcto)
UPDATE mmc_commercials SET email = 'francisco.dominguez@malagamotocenter.com'
WHERE upper(name) = 'FRANCISCO DOMINGUEZ' OR name = 'Francisco Domínguez' OR upper(name) = 'FRANCISCO';

UPDATE mmc_commercials SET email = 'francisco.fernandez@malagamotocenter.com'
WHERE upper(name) = 'FRANCISCO FERNANDEZ' OR name = 'Francisco Fernández';

-- Asegurar que FRANCISCO FERNANDEZ existe como commercial
INSERT INTO mmc_commercials (name, display_name, email, role, is_active)
SELECT 'FRANCISCO FERNANDEZ', 'Francisco Fernández', 'francisco.fernandez@malagamotocenter.com', 'comercial', true
WHERE NOT EXISTS (SELECT 1 FROM mmc_commercials WHERE upper(name) IN ('FRANCISCO FERNANDEZ'));

-- El FRANCISCO histórico del sheet (que engloba ambos) lo renombramos a FRANCISCO DOMINGUEZ
-- porque es quien tiene las 654 ventas del Sheet
UPDATE mmc_commercials SET
  name = 'FRANCISCO DOMINGUEZ',
  display_name = 'Francisco Domínguez',
  email = 'francisco.dominguez@malagamotocenter.com',
  role = 'gerente'
WHERE name = 'FRANCISCO';

-- Log de eventos Graph recibidos (auditoría de sync)
CREATE TABLE IF NOT EXISTS mmc_bookings_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_started_at timestamptz NOT NULL DEFAULT now(),
  sync_ended_at   timestamptz,
  events_fetched  integer DEFAULT 0,
  events_new      integer DEFAULT 0,
  events_updated  integer DEFAULT 0,
  events_cancelled integer DEFAULT 0,
  error           text
);

SELECT id, name, display_name, email, role FROM mmc_commercials ORDER BY role, name;
