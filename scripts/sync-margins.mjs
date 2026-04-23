#!/usr/bin/env node
// Seed + sync diario del catálogo de modelos Yamaha desde la pestaña Márgenes del Sheet.
// - Descarga la pestaña Márgenes
// - Upsert en mmc_models + mmc_model_margins
// - Clasifica family/cc/is_display/is_35kw de cada modelo
// - Añade 2 modelos extra que sabemos que son bicis (Crosscore RC, Wabash RT) aunque no estén en Márgenes
// - Genera aliases automáticos + aliases manuales conocidos
// - Backfill mmc_leads.modelo_id + mmc_sales.model_id resolviendo por alias

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SHEET_ID = '1dhTrZdg95yw5U-Hrq55ZPKOBLUKw7aahHZ_WLQmCXuE';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Margenes`;

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

// ---------- helpers ----------

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
      } else if (c === '"') inQuote = false;
      else cell += c;
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

function parseMargin(raw) {
  if (!raw) return null;
  // "1.334,51€" → 1334.51
  const clean = String(raw)
    .replace(/[€\s]/g, '')
    .replace(/\./g, '')       // separador miles ES
    .replace(',', '.');       // decimal ES
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Heurísticas de clasificación
function classifyModel(name) {
  const upper = name.toUpperCase();
  const lower = name.toLowerCase();
  const out = { family: null, cc: null, is_display: false, is_35kw: false, is_anniv: false };

  if (/\(DISPLAY\)/i.test(name)) out.is_display = true;
  if (/35\s*kw/i.test(name)) out.is_35kw = true;
  if (/anniversary|aniversari/i.test(name)) out.is_anniv = true;

  // Familias
  if (/^(NMAX|XMAX|TMAX|NEO|RAYZR|TRICITY|WABASH|CROSSCORE|PW|TTR)/i.test(upper)) out.family = 'scooter';
  if (/^(NEO|WABASH|CROSSCORE)/i.test(upper)) out.family = 'scooter'; // incluye e-bikes
  if (/^MT-?/i.test(upper)) out.family = 'naked';
  if (/^XSR/i.test(upper)) out.family = 'naked';
  if (/^(R\s?\d|R-?\d)/.test(upper)) out.family = 'deportiva';
  if (/^WR\d/i.test(upper)) out.family = 'offroad';
  if (/^T[EÉ]N[EÉ]R[EÉ]|^TENERE/i.test(upper)) out.family = 'trail';
  if (/^TRACER/i.test(upper)) out.family = 'trail';
  if (/^NIKEN/i.test(upper)) out.family = 'trail';
  if (/^(WABASH|CROSSCORE)/i.test(upper)) out.family = 'bicicleta';

  // CC (hp/displacement)
  const ccMatch = name.match(/\b(50|125|300|560|660|689|700|790|900|1000)\b/);
  if (ccMatch) out.cc = parseInt(ccMatch[1], 10);
  // Casos específicos
  if (/NEO.?s/i.test(name) && !out.cc) out.cc = 50;
  if (/RayZR/i.test(name) && !out.cc) out.cc = 125;
  if (/TMAX/i.test(name) && !out.cc) out.cc = 560;
  if (/^MT-?03|R3|R7/i.test(upper) && !out.cc) out.cc = /MT-?03|R3/.test(upper) ? 321 : 689;
  if (/MT-?09|MT-?10/i.test(upper) && !out.cc) out.cc = /MT-?10/.test(upper) ? 998 : 889;
  if (/NIKEN/i.test(upper) && !out.cc) out.cc = 847;
  if (/WR125/i.test(upper) && !out.cc) out.cc = 125;
  if (/PW.?50/i.test(upper) && !out.cc) out.cc = 50;
  if (/TTR.?50/i.test(upper) && !out.cc) out.cc = 50;

  return out;
}

// ---------- aliases manuales conocidos ----------
// Mapping de strings raw habituales en el Sheet → nombre oficial (o null para ignorar)
const MANUAL_ALIASES = [
  // Scooters
  { alias: 'NMAX', target: 'NMAX' },
  { alias: 'nmax', target: 'NMAX' },
  { alias: 'NMAX 125', target: 'NMAX' },
  { alias: 'YAMAHA NMAX', target: 'NMAX' },
  { alias: 'YAMAHA NMAX 125', target: 'NMAX' },
  { alias: 'XMAX', target: 'XMAX 125' },
  { alias: 'xmax', target: 'XMAX 125' },
  { alias: 'XMAX 125', target: 'XMAX 125' },
  { alias: 'XMAX 300', target: 'XMAX 300' },
  { alias: 'XMAX 300 Tech', target: 'XMAX 300 Tech Max' },
  { alias: 'TMAX', target: 'TMAX 560' },
  { alias: 'tmax', target: 'TMAX 560' },
  { alias: 'RAY Z', target: 'RayZR' },
  { alias: 'ray_z', target: 'RayZR' },
  { alias: 'NEO\'S', target: "NEO's" },
  { alias: 'neo\'s', target: "NEO's" },
  { alias: 'tricity_300_', target: 'TRICITY 300' },
  { alias: 'TRICITY 300', target: 'TRICITY 300' },
  // Naked MT
  { alias: 'MT07', target: 'MT-07' },
  { alias: 'mt07', target: 'MT-07' },
  { alias: 'MT-07', target: 'MT-07' },
  { alias: 'MT 07', target: 'MT-07' },
  { alias: 'MT09', target: 'MT-09' },
  { alias: 'mt09', target: 'MT-09' },
  { alias: 'MT-09', target: 'MT-09' },
  { alias: 'MT-09 35kw', target: 'MT-09 35kw' },
  { alias: 'MT-09 35Kw', target: 'MT-09 35kw' },
  { alias: 'MT09 35kw Y-AMT', target: 'MT-09 Y-AMT 35kw' },
  { alias: 'mt125', target: 'MT-125' },
  { alias: 'MT 125', target: 'MT-125' },
  { alias: 'MT-125', target: 'MT-125' },
  { alias: 'MT-03', target: 'MT-03' },
  { alias: 'MT-10', target: 'MT-10' },
  // Deportivas
  { alias: 'R 3', target: 'R3' },
  { alias: 'R1', target: 'R 125' }, // ojo: "R1" suele ser typo de R125 en el form
  { alias: 'R-9', target: 'R9' },
  { alias: 'R-125', target: 'R 125' },
  { alias: 'R7', target: 'R7 / 35kw' },
  { alias: 'YAMAHA R7 35KW', target: 'R7 / 35kw' },
  { alias: 'xsr125', target: 'XSR 125' },
  // Trail
  { alias: 'TRACER 7', target: 'TRACER 7 / 35kw' },
  { alias: 'Tracer 7', target: 'TRACER 7 / 35kw' },
  { alias: 'TRACER 9', target: 'TRACER 9' },
  { alias: 'Tracer 9', target: 'TRACER 9' },
  { alias: 'TRACER 9GT+', target: 'TRACER 9 GT+ Y-AMT' },
  { alias: 'TÉNÉRÉ 700', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  { alias: 'Ténéré 700', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  { alias: 'TÉNÉRÉ', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  { alias: 'tenere', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  { alias: 'TÉNÉRÉ RALLY', target: 'TÉNÉRÉ 700 Rally' },
  { alias: 'MOTO ENDURO', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  { alias: 'tenere de prueba', target: 'TÉNÉRÉ 700 / 35kw / LOW' },
  // Off-road
  { alias: 'WR125', target: 'WR125R' },
  { alias: 'wr125r', target: 'WR125R' },
  // Ediciones especiales
  { alias: 'MT 09 limitada', target: 'MT-09 35kw' },
  { alias: 'MT 07 limitada', target: 'MT-07 35kw' },
  // Emojis (se mapea el mismo target, el normalize limpia el emoji)
  { alias: '🟢 MT-09 35kw', target: 'MT-09 35kw' },
  { alias: '🔺 MT09 35kw Y-AMT', target: 'MT-09 Y-AMT 35kw' },
  { alias: '🔺 R7', target: 'R7 / 35kw' },
  { alias: '🔺 MT 09 limitada', target: 'MT-09 35kw' },
  { alias: '🔺 MT 07 limitada', target: 'MT-07 35kw' },
  { alias: '🔺 Tracer 7', target: 'TRACER 7 / 35kw' },
  // Ediciones especiales y resto
  { alias: 'Yamaha XSR900 blue legend', target: 'XSR 900' },
  { alias: 'XSR 900 blue legend', target: 'XSR 900' },
  { alias: 'YAMAHA R7 WORLD GP 60 ANIVERSARIO', target: 'R7 70th Anniversary Ed.' },
  { alias: 'R7 World GP 60 aniversario', target: 'R7 70th Anniversary Ed.' },
  { alias: 'YAMAHA NMAX TECH MAX SPORT', target: 'NMAX Tech Max SPORT (DISPLAY)' },
  { alias: 'NMAX TECH MAX SPORT', target: 'NMAX Tech Max SPORT (DISPLAY)' },
  { alias: 'NMAX Tech Max SPORT (DISPLAY)', target: 'NMAX Tech Max SPORT (DISPLAY)' },
  { alias: 'nmax sevilla', target: 'NMAX' },
  { alias: 'tmaxmt09', target: 'MT-09' }, // decisión: el operador ha dudado entre 2; optamos por MT-09
  // Ignorados (se quedan modelo_raw sin modelo_id):
  // 'OTRO MODELO' / 'Otro modelo' / 'otro_modelo' / 'X'
  // 'pulsar 125' (otra marca Bajaj)
  // 'contacto erroneo', 'atendido esta mañana por carlos', etc. (notas, no modelos)
  // 'esta interesado en una de segunda mano , no nueva' (nota)
  // '- Elige modelo con promo --' (placeholder form sin completar)
];

// Modelos extra que sabemos existen pero NO están en Márgenes
const EXTRA_MODELS = [
  { name: 'Crosscore RC', family: 'bicicleta', cc: null, is_display: false, is_35kw: false, is_anniv: false },
  { name: 'Wabash RT', family: 'bicicleta', cc: null, is_display: false, is_35kw: false, is_anniv: false },
  // Modelo "catch-all" para leads que eligieron "OTRO MODELO" en el form
  // o donde la operadora no especificó modelo. Sin margen (no aplica).
  { name: 'Otro no especificado', family: 'otro', cc: null, is_display: false, is_35kw: false, is_anniv: false },
];
const EXTRA_ALIASES = [
  { alias: 'Crosscore RC', target: 'Crosscore RC' },
  { alias: 'Crosscocre RC', target: 'Crosscore RC' }, // typo frecuente
  { alias: 'crosscore', target: 'Crosscore RC' },
  { alias: 'crosscore rc', target: 'Crosscore RC' },
  { alias: 'Crosscore 2 UDS', target: 'Crosscore RC' },
  { alias: 'Crosscore 6 uds', target: 'Crosscore RC' },
  { alias: 'Wabash RT', target: 'Wabash RT' },
  // Variantes de "otro" del formulario web → todos a "Otro no especificado"
  { alias: 'OTRO MODELO', target: 'Otro no especificado' },
  { alias: 'Otro modelo', target: 'Otro no especificado' },
  { alias: 'otro_modelo', target: 'Otro no especificado' },
  { alias: 'OTRO', target: 'Otro no especificado' },
  { alias: 'otro', target: 'Otro no especificado' },
  { alias: 'Otro', target: 'Otro no especificado' },
  { alias: 'X', target: 'Otro no especificado' },
  { alias: 'x', target: 'Otro no especificado' },
  { alias: '- Elige modelo con promo --', target: 'Otro no especificado' },
  { alias: '-- Elegir una opción --', target: 'Otro no especificado' },
];

// ---------- run ----------

async function run() {
  const started = Date.now();
  console.log('→ fetching Márgenes CSV...');
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV vacío');
  const data = rows.slice(1).filter((r) => r.length >= 3 && r[0].trim());

  // 1) Upsert modelos
  let modelsInserted = 0;
  for (const r of data) {
    const name = r[0].trim();
    const year = r[1].trim() || null;
    const classification = classifyModel(name);
    await sb.from('mmc_models').upsert(
      {
        name,
        ...classification,
        year_default: year,
        is_active: true,
      },
      { onConflict: 'name' }
    );
    modelsInserted++;
  }

  // 2) Añadir modelos extra (bicis)
  for (const m of EXTRA_MODELS) {
    await sb.from('mmc_models').upsert({ ...m, is_active: true }, { onConflict: 'name' });
    modelsInserted++;
  }
  console.log(`  models upserted: ${modelsInserted}`);

  // 3) Obtener ids de modelos
  const { data: modelsData } = await sb.from('mmc_models').select('id, name');
  const byName = new Map(modelsData.map((m) => [m.name, m.id]));

  // 4) Upsert márgenes
  let marginsInserted = 0;
  for (const r of data) {
    const name = r[0].trim();
    const year = r[1].trim() || null;
    const margin = parseMargin(r[2]);
    if (margin === null) continue;
    const modelId = byName.get(name);
    await sb.from('mmc_model_margins').upsert(
      {
        model_id: modelId,
        model_name: name,
        year,
        margin_eur: margin,
        source: 'sheet_margenes',
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'model_name,year' }
    );
    marginsInserted++;
  }
  console.log(`  margins upserted: ${marginsInserted}`);

  // 5) Aliases: añadir el propio nombre + variantes manuales
  const allAliases = [];
  // Seed: el propio nombre de cada modelo es su alias trivial
  for (const m of modelsData) {
    allAliases.push({ alias: m.name, target: m.name });
  }
  // Manuales + extra
  for (const a of [...MANUAL_ALIASES, ...EXTRA_ALIASES]) allAliases.push(a);

  let aliasesInserted = 0;
  let aliasesSkipped = 0;
  for (const a of allAliases) {
    const modelId = byName.get(a.target);
    if (!modelId) {
      console.warn(`  [skip] alias "${a.alias}" → target "${a.target}" no existe como modelo`);
      aliasesSkipped++;
      continue;
    }
    const { error } = await sb.from('mmc_model_aliases').upsert(
      { model_id: modelId, alias: a.alias, source: 'catalog_seed' },
      { onConflict: 'alias' }
    );
    if (error && !error.message.includes('duplicate')) {
      console.warn(`  [err] alias "${a.alias}": ${error.message}`);
    } else {
      aliasesInserted++;
    }
  }
  console.log(`  aliases upserted: ${aliasesInserted} (skipped: ${aliasesSkipped})`);

  // 6) Backfill mmc_leads.modelo_id
  const { data: leadsToFix } = await sb
    .from('mmc_leads')
    .select('id, modelo_raw')
    .is('modelo_id', null)
    .not('modelo_raw', 'is', null);
  let leadsBackfilled = 0;
  for (const l of leadsToFix || []) {
    const { data: modelId } = await sb.rpc('mmc_resolve_model', { raw: l.modelo_raw });
    if (modelId) {
      await sb.from('mmc_leads').update({ modelo_id: modelId }).eq('id', l.id);
      leadsBackfilled++;
    }
  }
  console.log(`  leads con modelo_id resuelto: ${leadsBackfilled}`);

  // 7) Backfill mmc_sales.model_id
  const { data: salesToFix } = await sb
    .from('mmc_sales')
    .select('id, model_raw')
    .is('model_id', null)
    .not('model_raw', 'is', null);
  let salesBackfilled = 0;
  for (const s of salesToFix || []) {
    const { data: modelId } = await sb.rpc('mmc_resolve_model', { raw: s.model_raw });
    if (modelId) {
      await sb.from('mmc_sales').update({ model_id: modelId }).eq('id', s.id);
      salesBackfilled++;
    }
  }
  console.log(`  ventas con model_id resuelto: ${salesBackfilled}`);

  console.log(`✓ done in ${Date.now() - started}ms`);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
