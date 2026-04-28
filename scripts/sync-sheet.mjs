#!/usr/bin/env node
// Sync incremental Google Sheet → Supabase (cada 5 min)
// Usa la función SQL mmc_upsert_lead_inbound que ya hace dedupe por email/teléfono
// y genera mmc_lead_inbounds para cada entrada.
//
// Filas desde 2026-01-01 que han cambiado (sheet_row_hash distinto al guardado).

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1dhTrZdg95yw5U-Hrq55ZPKOBLUKw7aahHZ_WLQmCXuE/export?format=csv&gid=2006370016';
const CUTOFF_DATE = new Date('2026-01-01');

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

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') {
        row.push(cell);
        cell = '';
      } else if (c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (c !== '\r') cell += c;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseDate(s) {
  if (!s) return null;
  const raw = String(s).trim();
  // Strip label prefix (e.g. "Fecha cita prueba moto: 25/04/2026") only if string starts with letters
  const clean = /^\d/.test(raw) ? raw : raw.replace(/^[^:]*:\s*/i, '').trim();
  if (!clean) return null;
  // dd/mm/yyyy (with optional trailing time HH:MM:SS — ignored, only date extracted)
  const m4 = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m4) {
    const yr = m4[3].length === 2 ? `20${m4[3]}` : m4[3];
    return new Date(`${yr}-${m4[2].padStart(2, '0')}-${m4[1].padStart(2, '0')}T00:00:00Z`);
  }
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function mapOrigen(raw) {
  if (!raw) return 'OTHER';
  const v = raw.trim().toUpperCase();
  if (v === 'META') return 'META';
  if (v === 'SEO') return 'SEO';
  if (v === 'SEM') return 'SEM';
  if (v === 'SEO/SEM' || v === 'SEO_SEM') return 'SEO_SEM';
  return 'OTHER';
}

function apptTypeFromPaso1(paso1) {
  if (!paso1) return null;
  const v = paso1.toLowerCase();
  if (v.includes('prueba')) return 'prueba_moto';
  if (v.includes('concesionario')) return 'concesionario';
  if (v.includes('taller')) return 'taller';
  return null;
}

function leadStatusFrom(paso1, paso3, ventaFecha) {
  if (ventaFecha) return 'sold';
  if (!paso1) return 'new';
  const p1 = paso1.toLowerCase();
  if (
    p1.includes('no interesado') ||
    p1.includes('contacto err') ||
    p1.includes('no contesta') ||
    p1.includes('cuelga')
  )
    return p1.includes('err') ? 'bad_contact' : 'lost';
  if (p1.includes('cita')) {
    if (paso3) {
      const p3 = paso3.toLowerCase();
      if (p3.includes('acude')) return 'attended';
    }
    return 'appointment';
  }
  if (p1.includes('interesado') || p1.includes('quiere') || p1.includes('agend'))
    return 'contacted';
  return 'new';
}

async function run() {
  const started = Date.now();
  console.log('→ fetching sheet CSV…');
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`fetch sheet: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  const data = rows.slice(1);

  const COL = {
    entry: 0, origen: 1, formulario: 2, fechaForm: 3, nombre: 4, email: 5, telefono: 6,
    peticion: 7, mensajes: 8, modelo: 9, fechaLlamada: 10, comunicaciones: 11,
    paso1: 12, paso2: 13, paso3: 14, paso4: 15, paso5: 16, motivoQMI: 17,
    fechaCita: 18, fechaCompra: 19, modeloVendido: 20, margen: 21, comercial: 22, notas: 23,
  };

  // Cache de hashes de inbounds ya procesados (para skip)
  const { data: existingInbounds } = await sb
    .from('mmc_lead_inbounds')
    .select('sheet_entry_id, sheet_row_hash')
    .not('sheet_entry_id', 'is', null);
  const seenByEntry = new Map();
  for (const x of existingInbounds || []) {
    if (x.sheet_entry_id) seenByEntry.set(x.sheet_entry_id, x.sheet_row_hash);
  }

  // Comercials cache para asignar ventas/citas
  const { data: commercials } = await sb.from('mmc_commercials').select('id, name');
  const commByName = new Map();
  for (const c of commercials || []) commByName.set(c.name.toUpperCase(), c.id);

  let skipped = 0;
  let processed = 0;
  let appts = 0;
  let sales = 0;

  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (r.length < 5) continue;
    const fechaEntrada = parseDate(r[COL.fechaForm]);
    if (!fechaEntrada || fechaEntrada < CUTOFF_DATE) continue;
    const nombre = (r[COL.nombre] || '').trim();
    if (!nombre) continue;

    const entryId = r[COL.entry]?.trim() || null;
    const rowHash = sha256(r.join('|'));

    // Skip si entry_id + hash coinciden con lo ya procesado (no hubo cambios)
    if (entryId && seenByEntry.get(entryId) === rowHash) {
      skipped++;
      continue;
    }

    // Upsert via RPC (gestiona el dedupe)
    const { data: upsertRes, error: upsertErr } = await sb.rpc('mmc_upsert_lead_inbound', {
      p_sheet_entry_id: entryId,
      p_sheet_row_hash: rowHash,
      p_origen: mapOrigen(r[COL.origen]),
      p_formulario: r[COL.formulario]?.trim() || null,
      p_fecha_entrada: fechaEntrada.toISOString(),
      p_nombre: nombre,
      p_email: r[COL.email]?.trim() || null,
      p_telefono: r[COL.telefono]?.trim() || null,
      p_seleccionar_peticion: r[COL.peticion]?.trim() || null,
      p_mensajes_preferencias: r[COL.mensajes]?.trim() || null,
      p_modelo_raw: r[COL.modelo]?.trim() || null,
    });

    if (upsertErr) {
      console.error(`  × upsert row ${i}:`, upsertErr.message);
      continue;
    }
    const leadId = upsertRes;
    processed++;

    // Actualizar status desde los pasos del Sheet (Call center)
    const paso1 = r[COL.paso1];
    const paso3 = r[COL.paso3];
    const fechaCompra = parseDate(r[COL.fechaCompra]);
    const newStatus = leadStatusFrom(paso1, paso3, fechaCompra);

    // Resolver modelo_id si aún no lo tiene
    const modeloRaw = r[COL.modelo]?.trim();
    let modeloId = null;
    if (modeloRaw) {
      const { data: resolved } = await sb.rpc('mmc_resolve_model', { raw: modeloRaw });
      if (resolved) modeloId = resolved;
    }

    const leadUpdate = { status: newStatus };
    if (modeloId) leadUpdate.modelo_id = modeloId;
    await sb.from('mmc_leads').update(leadUpdate).eq('id', leadId);

    // Cita si paso1 = cita_*
    const apptType = apptTypeFromPaso1(paso1);
    if (apptType) {
      const fechaCitaStr = r[COL.fechaCita]?.trim();
      let fechaCita = fechaCitaStr ? parseDate(fechaCitaStr) : null;
      if (!fechaCita) fechaCita = new Date(fechaEntrada.getTime() + 7 * 24 * 3600 * 1000);
      const p3 = (paso3 || '').toLowerCase();
      let status = 'pending';
      if (p3.includes('no acude')) status = 'no_show';
      else if (p3.includes('acude')) status = 'attended';

      const commercialId =
        commByName.get((r[COL.comercial] || '').trim().toUpperCase()) || null;

      const { data: existing } = await sb
        .from('mmc_appointments')
        .select('id')
        .eq('lead_id', leadId)
        .gte('fecha_cita', new Date(fechaEntrada.getTime() - 30 * 86400000).toISOString())
        .limit(1)
        .maybeSingle();

      const payload = {
        lead_id: leadId,
        commercial_id: commercialId,
        tipo: apptType,
        fecha_cita: fechaCita.toISOString(),
        status,
      };
      if (existing) await sb.from('mmc_appointments').update(payload).eq('id', existing.id);
      else {
        const { error } = await sb.from('mmc_appointments').insert(payload);
        if (!error) appts++;
      }
    }

    // Venta si hay fecha_compra + modelo
    const modeloVendido = r[COL.modeloVendido]?.trim();
    const comercialName = (r[COL.comercial] || '').trim().toUpperCase();
    const commercialId = commByName.get(comercialName);
    if (fechaCompra && modeloVendido && commercialId) {
      const margenRaw = r[COL.margen]?.trim() || '';
      const margenNum = parseFloat(margenRaw.replace(/[€\s]/g, '').replace(',', '.')) || null;
      const { data: existingSale } = await sb
        .from('mmc_sales')
        .select('id')
        .eq('lead_id', leadId)
        .maybeSingle();

      // Resolver model_id de la venta
      const { data: saleModelId } = await sb.rpc('mmc_resolve_model', { raw: modeloVendido });

      const payload = {
        lead_id: leadId,
        commercial_id: commercialId,
        model_raw: modeloVendido,
        model_id: saleModelId || null,
        fecha_compra: fechaCompra.toISOString().slice(0, 10),
        margen_eur: margenNum,
        notas: r[COL.notas]?.trim() || null,
      };
      if (existingSale) await sb.from('mmc_sales').update(payload).eq('id', existingSale.id);
      else {
        const { error } = await sb.from('mmc_sales').insert(payload);
        if (!error) sales++;
      }
    }
  }

  console.log(
    `✓ processed=${processed} skipped_noop=${skipped} appts_new=${appts} sales_new=${sales} in ${Date.now() - started}ms`
  );
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
