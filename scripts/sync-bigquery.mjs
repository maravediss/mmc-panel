#!/usr/bin/env node
// Sync BigQuery Presence → Supabase cada 15 min
// - Upsert de mmc_calls a partir de mmc_leads_logs
// - Cross de mmc_leads con mmc_leads_data_argumentario (por email → telefono_normalized)
// - Actualiza bq_* campos en mmc_leads
//
// Ejecuta desde VPS: GOOGLE_APPLICATION_CREDENTIALS=/opt/secrets/yam-reader.json node scripts/sync-bigquery.mjs
// Puede ejecutarse idempotente (usa bq_log_id como clave única).

import { BigQuery } from '@google-cloud/bigquery';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_ENV = resolve(process.cwd(), '.env.local');
const envPath = process.env.DOTENV || DEFAULT_ENV;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars.');
  process.exit(1);
}

const BQ_PROJECT = 'annular-magnet-396115';
const BQ_DATASET = 'MK_SEO_MAIL_2026';
const SERVICE_FILTER = "SERVICENAME = 'PG_EX_LEADS_YAMAHA_MALAGACENTER'";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const bq = new BigQuery({ projectId: BQ_PROJECT });

function normalizeTel(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.slice(-9);
}

async function run() {
  const started = new Date();

  // 1) Last sync checkpoint — usamos max(call_at) en mmc_calls
  const { data: chk } = await sb
    .from('mmc_calls')
    .select('call_at')
    .order('call_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const since = chk ? new Date(chk.call_at) : new Date('2026-01-01');
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ');
  console.log(`→ sync calls since ${sinceStr}`);

  // 2) Fetch nuevas filas de mmc_leads_logs desde ese timestamp
  const [rows] = await bq.query({
    query: `
      SELECT
        ID                AS bq_log_id,
        OUTBOUNDQUEUEID   AS bq_queue_id,
        RDATE             AS call_at,
        SCHEDULEDDATETIME AS scheduled_datetime,
        SERVICENAME       AS service_name,
        LOADNAME          AS load_name,
        AGENTNAME         AS agent_name,
        STATION           AS station,
        PHONE             AS telefono,
        QCODE             AS qcode,
        QCODEDESCRIPTION  AS qcode_description,
        QCODETYPE         AS qcode_type,
        RINGINGTIME       AS ringing_time_s,
        TALKTIME          AS talk_time_s,
        HANDLINGTIME      AS handling_time_s,
        WAITTIME          AS wait_time_s,
        HANGUPTYPE        AS hangup_type
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.mmc_leads_logs\`
      WHERE ${SERVICE_FILTER}
        AND RDATE > DATETIME('${sinceStr}')
      ORDER BY RDATE ASC
    `,
    useLegacySql: false,
  });

  console.log(`  new call logs in BigQuery: ${rows.length}`);

  // 3) Para cada fila, intentar matchear lead_id por telefono_normalized
  let inserted = 0;
  let linked = 0;
  const leadByTel = new Map(); // cache

  for (const r of rows) {
    const telNorm = normalizeTel(r.telefono);
    let leadId = null;
    if (telNorm) {
      if (!leadByTel.has(telNorm)) {
        const { data: lead } = await sb
          .from('mmc_leads')
          .select('id')
          .eq('telefono_normalized', telNorm)
          .order('fecha_entrada', { ascending: false })
          .limit(1)
          .maybeSingle();
        leadByTel.set(telNorm, lead?.id || null);
      }
      leadId = leadByTel.get(telNorm);
      if (leadId) linked++;
    }

    const rowToInsert = {
      lead_id: leadId,
      bq_log_id: Number(r.bq_log_id),
      bq_queue_id: Number(r.bq_queue_id),
      telefono: r.telefono,
      telefono_normalized: telNorm,
      agent_name: r.agent_name,
      qcode: r.qcode,
      qcode_description: r.qcode_description,
      qcode_type: r.qcode_type,
      service_name: r.service_name,
      load_name: r.load_name,
      scheduled_datetime: r.scheduled_datetime?.value || null,
      ringing_time_s: r.ringing_time_s,
      talk_time_s: r.talk_time_s,
      handling_time_s: r.handling_time_s,
      wait_time_s: r.wait_time_s,
      hangup_type: r.hangup_type,
      station: r.station,
      call_at: r.call_at?.value || null,
    };

    const { error } = await sb
      .from('mmc_calls')
      .upsert(rowToInsert, { onConflict: 'bq_log_id' });
    if (error) {
      console.error(`  × upsert bq_log_id=${r.bq_log_id}:`, error.message);
    } else {
      inserted++;
    }
  }

  console.log(`  calls upserted: ${inserted} (${linked} linked to leads)`);

  // 4) Sincronizar datos agregados del argumentario a mmc_leads
  const [argRows] = await bq.query({
    query: `
      SELECT
        queue_id,
        LASTAGENT,
        LASTQCODE,
        LASTHANDLINGDATE,
        FIRSTHANDLINGDATE,
        DAILYCOUNTER,
        TOTALCOUNTER,
        NOANSWERCOUNTER,
        BUSYSIGNALCOUNTER,
        STATUS,
        SCHEDULETYPE,
        SCHEDULEDATE,
        txt_telefono,
        txt_email,
        txt_modelo_interes,
        optn_resultado_llamada,
        optn_tipo_interes,
        multi_observaciones
      FROM \`${BQ_PROJECT}.${BQ_DATASET}.mmc_leads_data_argumentario\`
    `,
    useLegacySql: false,
  });

  console.log(`  argumentario rows: ${argRows.length}`);

  let leadsUpdated = 0;
  let leadsLinkedByEmail = 0;
  for (const a of argRows) {
    const telNorm = normalizeTel(a.txt_telefono);
    const email = a.txt_email?.toLowerCase().trim();

    // Buscar lead por email primero (más fiable), luego por teléfono
    let leadId = null;
    if (email) {
      const { data } = await sb
        .from('mmc_leads')
        .select('id')
        .ilike('email', email)
        .limit(1)
        .maybeSingle();
      if (data) {
        leadId = data.id;
        leadsLinkedByEmail++;
      }
    }
    if (!leadId && telNorm) {
      const { data } = await sb
        .from('mmc_leads')
        .select('id')
        .eq('telefono_normalized', telNorm)
        .limit(1)
        .maybeSingle();
      if (data) leadId = data.id;
    }
    if (!leadId) continue;

    const patch = {
      bq_queue_id: Number(a.queue_id),
      bq_last_agent: a.LASTAGENT,
      bq_last_qcode: a.LASTQCODE,
      bq_last_call_at: a.LASTHANDLINGDATE?.value || null,
      bq_first_call_at: a.FIRSTHANDLINGDATE?.value || null,
      bq_daily_counter: a.DAILYCOUNTER,
      bq_total_attempts: a.TOTALCOUNTER,
      bq_no_answer_counter: a.NOANSWERCOUNTER,
      bq_busy_counter: a.BUSYSIGNALCOUNTER,
      bq_status: a.STATUS,
      bq_schedule_type: a.SCHEDULETYPE,
      bq_optn_resultado: a.optn_resultado_llamada,
      bq_optn_tipo_interes: a.optn_tipo_interes,
      bq_multi_observaciones: a.multi_observaciones,
      bq_last_sync_at: new Date().toISOString(),
    };
    // Completar email/teléfono si estaban vacíos en el lead
    if (telNorm && email) {
      patch.telefono = patch.telefono ?? a.txt_telefono;
      patch.email = patch.email ?? email;
    }

    const { error } = await sb.from('mmc_leads').update(patch).eq('id', leadId);
    if (!error) leadsUpdated++;
  }

  console.log(`  leads updated: ${leadsUpdated} (linked by email: ${leadsLinkedByEmail})`);

  const durationMs = Date.now() - started.getTime();
  console.log(`✓ done in ${durationMs}ms`);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
