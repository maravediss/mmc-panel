#!/usr/bin/env node
// Sync Microsoft Bookings (CitasMMC@Interhanse.com calendar) → Supabase cada 5 min
// - Pide eventos desde -7d hasta +90d (ventana móvil)
// - Crea/actualiza mmc_appointments con graph_event_id como clave
// - Si el evento ya no existe en Graph → marca la appt como cancelled
// - Asigna commercial_id según email del attendee
// - Vincula lead_id por email/teléfono del attendee cuando sea posible

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const [k, v] = [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    if (!process.env[k]) process.env[k] = v;
  }
}

const AZURE = JSON.parse(readFileSync('/opt/secrets/azure-bookings.json', 'utf8'));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- OAuth ---
let _token = null;
let _tokenExpiry = 0;
async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;
  const res = await fetch(
    `https://login.microsoftonline.com/${AZURE.tenant_id}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AZURE.client_id,
        client_secret: AZURE.client_secret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    }
  );
  if (!res.ok) throw new Error(`OAuth failed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  _token = j.access_token;
  _tokenExpiry = Date.now() + j.expires_in * 1000;
  return _token;
}

async function graphGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph ${path} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// --- Helpers ---
function apptTypeFromSubject(subject) {
  const s = (subject || '').toLowerCase();
  if (s.includes('prueba')) return 'prueba_moto';
  if (s.includes('taller')) return 'taller';
  return 'concesionario';
}

function extractAttendeeLead(attendees) {
  // Attendees que NO son los comerciales del concesionario (no malagamotocenter.com)
  for (const a of attendees || []) {
    const email = a?.emailAddress?.address?.toLowerCase() || '';
    if (!email) continue;
    if (email.endsWith('@malagamotocenter.com')) continue;
    if (email.endsWith('@interhanse.com')) continue;
    if (email.endsWith('@pontgrup.com')) continue;
    return { email, name: a?.emailAddress?.name || null };
  }
  return null;
}

function parseBookingsBody(htmlContent) {
  if (!htmlContent) return null;
  // Bookings envía el cuerpo con formato:
  // Nombre: Fabio Mudano
  // Correo electrónico: xxx@yyy.com
  // Número de teléfono: 633464588
  // Pregunta 1- Modelo Moto
  // Responder - RAYZR
  const text = htmlContent.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\r/g, '');

  const get = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };

  const out = {
    nombre: get(/Nombre:\s*([^\n]+)/i),
    email: get(/(?:Correo electr[óo]nico|Email|E-?mail):\s*([^\s\n]+@[^\s\n]+)/i),
    telefono: get(/(?:N[úu]mero de tel[ée]fono|Tel[ée]fono|Phone):\s*([+0-9()\s-]+)/i),
    servicio: get(/Nombre del servicio:\s*([^\n]+)/i),
    modelo: null,
  };
  // Modelo puede venir de varios modos en campos personalizados
  const modeloMatch = text.match(/Modelo Moto[^\n]*\n\s*Responder\s*-\s*([^\n]+)/i);
  if (modeloMatch) out.modelo = modeloMatch[1].trim();

  if (out.email) out.email = out.email.toLowerCase().replace(/[,.;]+$/, '');
  if (out.telefono) out.telefono = out.telefono.trim();

  // Si no hemos sacado nada útil, null
  if (!out.nombre && !out.email && !out.telefono) return null;
  return out;
}

function extractCommercialEmail(attendees) {
  for (const a of attendees || []) {
    const email = a?.emailAddress?.address?.toLowerCase() || '';
    if (email.endsWith('@malagamotocenter.com')) return email;
  }
  return null;
}

function normalizeTel(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  return digits ? digits.slice(-9) : null;
}

// --- Main ---
async function run() {
  const startedAt = new Date();
  let fetched = 0, created = 0, updated = 0, cancelled = 0, errorMsg = null;

  try {
    // Ventana: últimos 7 días + próximos 90
    const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19) + 'Z';
    const end = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 19) + 'Z';

    // Cache commercials por email
    const { data: comms } = await sb.from('mmc_commercials').select('id, email, name');
    const commByEmail = new Map();
    for (const c of comms || []) if (c.email) commByEmail.set(c.email.toLowerCase(), c.id);

    // Graph calendar view — paginada
    const graphEventIds = new Set();
    let path = `/users/${AZURE.bookings_mailbox}/calendar/calendarView?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100&$select=id,iCalUId,subject,start,end,attendees,organizer,body,isCancelled,createdDateTime,lastModifiedDateTime`;

    while (path) {
      const page = await graphGet(path);
      for (const ev of page.value || []) {
        fetched++;
        graphEventIds.add(ev.id);
        await processEvent(ev, commByEmail, { created, updated }).then((r) => {
          if (r === 'created') created++;
          else if (r === 'updated') updated++;
        });
      }
      const next = page['@odata.nextLink'];
      path = next ? next.replace('https://graph.microsoft.com/v1.0', '') : null;
    }

    // Citas locales con graph_event_id que ya no están en Graph → cancelladas
    const { data: localAppts } = await sb
      .from('mmc_appointments')
      .select('id, graph_event_id, status')
      .not('graph_event_id', 'is', null)
      .neq('status', 'cancelled')
      .gte('fecha_cita', new Date(Date.now() - 30 * 86400000).toISOString());

    for (const a of localAppts || []) {
      if (!graphEventIds.has(a.graph_event_id)) {
        await sb
          .from('mmc_appointments')
          .update({ status: 'cancelled', graph_last_sync_at: new Date().toISOString() })
          .eq('id', a.id);
        cancelled++;
      }
    }
  } catch (e) {
    errorMsg = e.message;
    console.error('FATAL:', e.message);
  }

  const endedAt = new Date();
  await sb.from('mmc_bookings_sync_log').insert({
    sync_started_at: startedAt.toISOString(),
    sync_ended_at: endedAt.toISOString(),
    events_fetched: fetched,
    events_new: created,
    events_updated: updated,
    events_cancelled: cancelled,
    error: errorMsg,
  });

  console.log(
    `✓ fetched=${fetched} new=${created} updated=${updated} cancelled=${cancelled} in ${endedAt - startedAt}ms${errorMsg ? ' ERROR: ' + errorMsg : ''}`
  );
  if (errorMsg) process.exit(1);
}

async function processEvent(ev, commByEmail, counters) {
  const bookingsData = parseBookingsBody(ev.body?.content);
  const leadAttendee = extractAttendeeLead(ev.attendees);
  const commercialEmail = extractCommercialEmail(ev.attendees);
  const commercialId = commercialEmail ? commByEmail.get(commercialEmail) : null;

  // Datos del lead: preferimos los del body parseado (Bookings los mete ahí), fallback a attendee
  const leadData = bookingsData || leadAttendee;

  // Vincular lead: por email → teléfono → nombre
  let leadId = null;
  if (leadData?.email) {
    const { data: lead } = await sb
      .from('mmc_leads')
      .select('id')
      .ilike('email', leadData.email)
      .limit(1)
      .maybeSingle();
    if (lead) leadId = lead.id;
  }
  if (!leadId && leadData?.telefono) {
    const tel9 = normalizeTel(leadData.telefono);
    if (tel9) {
      const { data: lead } = await sb
        .from('mmc_leads')
        .select('id')
        .eq('telefono_normalized', tel9)
        .limit(1)
        .maybeSingle();
      if (lead) leadId = lead.id;
    }
  }

  // Si NO encontramos lead → crear uno nuevo con los datos del body Bookings
  if (!leadId && leadData && (leadData.email || leadData.telefono || leadData.nombre)) {
    const { data: inserted, error } = await sb
      .from('mmc_leads')
      .insert({
        origen: 'OTHER',
        formulario: 'Cita Bookings',
        fecha_entrada: ev.createdDateTime || ev.start?.dateTime || new Date().toISOString(),
        nombre: leadData.nombre || ev.subject || 'Lead desde Bookings',
        email: leadData.email || null,
        telefono: leadData.telefono || null,
        modelo_raw: leadData.modelo || null,
        status: 'appointment',
        notas: `Creado automáticamente desde Bookings event ${ev.id}`,
      })
      .select('id')
      .single();
    if (!error && inserted) leadId = inserted.id;
  }

  if (!leadId) {
    // Sin datos para crear lead → saltar
    return null;
  }

  const apptType = apptTypeFromSubject(ev.subject);
  const fechaCita = ev.start?.dateTime + 'Z'; // Graph envía sin Z; asumimos UTC

  const payload = {
    lead_id: leadId,
    commercial_id: commercialId,
    tipo: apptType,
    fecha_cita: new Date(fechaCita).toISOString(),
    status: ev.isCancelled ? 'cancelled' : 'pending',
    notes: (ev.body?.content || '').replace(/<[^>]+>/g, '').slice(0, 1000) || null,
    graph_event_id: ev.id,
    graph_ical_uid: ev.iCalUId,
    graph_organizer_email: ev.organizer?.emailAddress?.address || null,
    graph_last_sync_at: new Date().toISOString(),
    sync_source: 'graph_api',
  };

  const { data: existing } = await sb
    .from('mmc_appointments')
    .select('id, fecha_cita, commercial_id, status')
    .eq('graph_event_id', ev.id)
    .maybeSingle();

  if (existing) {
    // Evitar escribir reportes manuales (p. ej. si ya marcaron asistencia desde el panel, no pisamos)
    if (existing.status !== 'pending' && !ev.isCancelled) {
      // Sólo actualizamos campos meta (fecha, commercial) si cambiaron
      const changed =
        existing.fecha_cita !== payload.fecha_cita ||
        existing.commercial_id !== payload.commercial_id;
      if (changed) {
        await sb
          .from('mmc_appointments')
          .update({
            fecha_cita: payload.fecha_cita,
            commercial_id: payload.commercial_id,
            graph_last_sync_at: payload.graph_last_sync_at,
          })
          .eq('id', existing.id);
        return 'updated';
      }
      return null;
    }
    await sb.from('mmc_appointments').update(payload).eq('id', existing.id);
    return 'updated';
  } else {
    await sb.from('mmc_appointments').insert(payload);
    return 'created';
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
