#!/usr/bin/env node
// ETL inicial: Sheet "Formularios Yamaha Moto Center" → Supabase mmc_leads + mmc_appointments + mmc_sales
// Filtra desde 2026-01-01
// Uso: node scripts/etl-sheet.mjs

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1dhTrZdg95yw5U-Hrq55ZPKOBLUKw7aahHZ_WLQmCXuE/export?format=csv&gid=2006370016';
const CUTOFF_DATE = new Date('2026-01-01');

const envPath = resolve(process.cwd(), '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx), l.slice(idx + 1)];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

function parseCSV(text) {
  // Parser CSV tolerante a quoting
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
      } else {
        cell += c;
      }
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
      } else if (c === '\r') {
        // skip
      } else {
        cell += c;
      }
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
  s = s.trim();
  // Formato DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T00:00:00Z`);
  const d = new Date(s);
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

// PASO 1 del Sheet → tipo de cita (si lo es)
function apptTypeFromPaso1(paso1) {
  if (!paso1) return null;
  const v = paso1.toLowerCase();
  if (v.includes('prueba')) return 'prueba_moto';
  if (v.includes('concesionario')) return 'concesionario';
  if (v.includes('taller')) return 'taller';
  return null;
}

function leadStatusFrom(paso1, paso3, ventaFecha) {
  // Si hay fecha de compra → sold
  if (ventaFecha) return 'sold';
  if (!paso1) return 'new';
  const p1 = paso1.toLowerCase();
  if (p1.includes('no interesado') || p1.includes('contacto err') || p1.includes('no contesta') || p1.includes('cuelga')) {
    return p1.includes('err') ? 'bad_contact' : 'lost';
  }
  if (p1.includes('cita')) {
    if (paso3) {
      const p3 = paso3.toLowerCase();
      if (p3.includes('acude')) return 'attended';
      if (p3.includes('no compra')) return 'attended';
    }
    return 'appointment';
  }
  if (p1.includes('interesado') || p1.includes('quiere') || p1.includes('agend')) return 'contacted';
  return 'new';
}

async function run() {
  console.log('→ Descargando CSV...');
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`fetch sheet: ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  const header = rows[0];
  console.log(`  Header: ${header.length} columnas`);
  console.log(`  Filas totales: ${rows.length - 1}`);

  // Índices por nombre (orden del Sheet real)
  const COL = {
    entry: 0, origen: 1, formulario: 2, fechaForm: 3, nombre: 4, email: 5, telefono: 6,
    peticion: 7, mensajes: 8, modelo: 9, fechaLlamada: 10, comunicaciones: 11,
    paso1: 12, paso2: 13, paso3: 14, paso4: 15, paso5: 16, motivoQMI: 17,
    fechaCita: 18, fechaCompra: 19, modeloVendido: 20, margen: 21, comercial: 22, notas: 23,
  };

  // Commercials cache
  const { data: commercials } = await sb.from('mmc_commercials').select('id, name, role');
  const commByName = new Map();
  for (const c of commercials || []) commByName.set(c.name.toUpperCase(), c);
  console.log(`  Commercials existentes: ${commercials?.length ?? 0}`);

  // Comerciales a crear vistos en el Sheet (FRANCISCO, JOSE, CARLOS, CISCO)
  const comercialesVistos = new Set();
  let filtradas = 0, procesadas = 0, citasCreadas = 0, ventasCreadas = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 5) continue;
    const fechaEntrada = parseDate(r[COL.fechaForm]);
    if (!fechaEntrada || fechaEntrada < CUTOFF_DATE) {
      filtradas++;
      continue;
    }
    const nombre = (r[COL.nombre] || '').trim();
    if (!nombre) continue;

    const leadPayload = {
      sheet_entry_id: r[COL.entry]?.trim() || null,
      sheet_row_hash: sha256(r.join('|')),
      origen: mapOrigen(r[COL.origen]),
      formulario: r[COL.formulario]?.trim() || null,
      fecha_entrada: fechaEntrada.toISOString(),
      nombre,
      email: r[COL.email]?.trim() || null,
      telefono: r[COL.telefono]?.trim() || null,
      seleccionar_peticion: r[COL.peticion]?.trim() || null,
      mensajes_preferencias: r[COL.mensajes]?.trim() || null,
      modelo_raw: r[COL.modelo]?.trim() || null,
      status: leadStatusFrom(r[COL.paso1], r[COL.paso3], r[COL.fechaCompra]),
      notas: r[COL.notas]?.trim() || null,
    };

    // Upsert lead por sheet_entry_id si existe, si no insert nuevo
    let leadId;
    if (leadPayload.sheet_entry_id) {
      const { data: existing } = await sb
        .from('mmc_leads')
        .select('id')
        .eq('sheet_entry_id', leadPayload.sheet_entry_id)
        .maybeSingle();

      if (existing) {
        leadId = existing.id;
        await sb.from('mmc_leads').update(leadPayload).eq('id', leadId);
      } else {
        const { data: inserted, error } = await sb
          .from('mmc_leads')
          .insert(leadPayload)
          .select('id')
          .single();
        if (error) {
          console.error(`  ✗ insert lead row ${i}:`, error.message);
          continue;
        }
        leadId = inserted.id;
      }
    } else {
      const { data: inserted, error } = await sb
        .from('mmc_leads')
        .insert(leadPayload)
        .select('id')
        .single();
      if (error) {
        console.error(`  ✗ insert lead row ${i}:`, error.message);
        continue;
      }
      leadId = inserted.id;
    }

    procesadas++;

    // Comercial asignado (col W)
    const comercialName = (r[COL.comercial] || '').trim().toUpperCase();
    let commercialId = null;
    if (comercialName) {
      comercialesVistos.add(comercialName);
      const c = commByName.get(comercialName);
      if (c) commercialId = c.id;
    }

    // Cita si paso1 == cita_*
    const apptType = apptTypeFromPaso1(r[COL.paso1]);
    const fechaCitaStr = r[COL.fechaCita]?.trim();
    if (apptType) {
      // Si hay fecha de cita válida la usamos, si no fecha_entrada + 7 días como placeholder
      let fechaCita = fechaCitaStr ? parseDate(fechaCitaStr) : null;
      if (!fechaCita) fechaCita = new Date(fechaEntrada.getTime() + 7 * 24 * 3600 * 1000);

      const paso3 = (r[COL.paso3] || '').toLowerCase();
      let status = 'pending';
      if (paso3.includes('no acude')) status = 'no_show';
      else if (paso3.includes('acude')) status = 'attended';

      // Check si ya hay una appt para este lead (dedupe)
      const { data: existingAppt } = await sb
        .from('mmc_appointments')
        .select('id')
        .eq('lead_id', leadId)
        .maybeSingle();

      const apptPayload = {
        lead_id: leadId,
        commercial_id: commercialId,
        tipo: apptType,
        fecha_cita: fechaCita.toISOString(),
        status,
      };

      if (!existingAppt) {
        const { data: a, error } = await sb
          .from('mmc_appointments')
          .insert(apptPayload)
          .select('id')
          .single();
        if (!error) {
          citasCreadas++;
        }
      } else {
        await sb.from('mmc_appointments').update(apptPayload).eq('id', existingAppt.id);
      }
    }

    // Venta si hay fecha_compra + modelo
    const fechaCompra = parseDate(r[COL.fechaCompra]);
    const modeloVendido = r[COL.modeloVendido]?.trim();
    if (fechaCompra && modeloVendido && commercialId) {
      const margenRaw = r[COL.margen]?.trim() || '';
      const margenNum = parseFloat(margenRaw.replace(/[€\s]/g, '').replace(',', '.')) || null;

      const { data: existingSale } = await sb
        .from('mmc_sales')
        .select('id')
        .eq('lead_id', leadId)
        .maybeSingle();

      const salePayload = {
        lead_id: leadId,
        commercial_id: commercialId,
        model_raw: modeloVendido,
        fecha_compra: fechaCompra.toISOString().slice(0, 10),
        margen_eur: margenNum,
        notas: r[COL.notas]?.trim() || null,
      };

      if (!existingSale) {
        const { error } = await sb.from('mmc_sales').insert(salePayload);
        if (!error) ventasCreadas++;
      } else {
        await sb.from('mmc_sales').update(salePayload).eq('id', existingSale.id);
      }
    }
  }

  console.log(`\n✅ Filas filtradas (antes ${CUTOFF_DATE.toISOString().slice(0,10)}): ${filtradas}`);
  console.log(`✅ Leads procesados: ${procesadas}`);
  console.log(`✅ Citas creadas: ${citasCreadas}`);
  console.log(`✅ Ventas creadas: ${ventasCreadas}`);
  console.log(`\nComerciales vistos en Sheet (col W):`);
  for (const n of comercialesVistos) {
    console.log(`  - ${n}${commByName.has(n) ? ' (ya existe)' : ' (⚠️ NO existe en Supabase)'}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
