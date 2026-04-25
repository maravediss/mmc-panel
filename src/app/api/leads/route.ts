import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get('date_from');  // YYYY-MM-DD  (null = no lower bound)
  const dateTo   = searchParams.get('date_to');    // YYYY-MM-DD  (null = no upper bound)
  const q     = searchParams.get('q')?.trim() ?? '';
  const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const LIMIT = 50;
  const offset = (page - 1) * LIMIT;

  const from = dateFrom ? `${dateFrom}T00:00:00` : undefined;
  const to   = dateTo   ? `${dateTo}T23:59:59`   : undefined;

  const admin = createAdminClient();

  // ── Base query builder ──────────────────────────────────────────────────
  const applyFilters = (query: any) => {
    if (from) query = query.gte('fecha_entrada', from);
    if (to)   query = query.lte('fecha_entrada', to);
    if (q) {
      const esc = q.replace(/[%_]/g, '\\$&');
      query = query.or(
        `nombre.ilike.%${esc}%,email.ilike.%${esc}%,telefono.ilike.%${esc}%,modelo_raw.ilike.%${esc}%`
      );
    }
    return query;
  };

  try {

    // ── Count + leads page ──────────────────────────────────────────────────
    const [{ count: total }, { data: leads }] = await Promise.all([
      applyFilters(admin.from('mmc_leads').select('*', { count: 'exact', head: true })),
      applyFilters(
        admin.from('mmc_leads')
          .select('id, nombre, email, telefono, modelo_raw, origen, status, fecha_entrada')
          .order('fecha_entrada', { ascending: false })
          .range(offset, offset + LIMIT - 1)
      ),
    ]);

    // ── KPIs via DB function ────────────────────────────────────────────────
    const { data: kpiRow } = await admin.rpc('mmc_kpi_leads', {
      p_from: from ? `${from}+00` : null,
      p_to:   to   ? `${to}+00`   : null,
    });

    const kpi = Array.isArray(kpiRow) && kpiRow.length > 0 ? kpiRow[0] : {};

    // ── Enrich page leads with next pending appointment ─────────────────────
    const leadIds = (leads ?? []).map((l: any) => l.id);
    let pendingAppts: any[] = [];
    if (leadIds.length > 0) {
      const { data: appts } = await admin
        .from('mmc_appointments')
        .select('lead_id, fecha_cita, status')
        .in('lead_id', leadIds)
        .in('status', ['pending'])
        .order('fecha_cita', { ascending: true });
      pendingAppts = appts ?? [];
    }

    // First pending appointment per lead
    const apptByLead = new Map<string, string>();
    for (const a of pendingAppts) {
      if (!apptByLead.has(a.lead_id)) apptByLead.set(a.lead_id, a.fecha_cita);
    }

    const enrichedLeads = (leads ?? []).map((l: any) => ({
      ...l,
      proxima_cita: apptByLead.get(l.id) ?? null,
    }));

    return NextResponse.json({
      leads: enrichedLeads,
      total: total ?? 0,
      page,
      pages: Math.ceil((total ?? 0) / LIMIT),
      kpis: {
        entrantes:       Number(kpi.entrantes       ?? 0),
        gestionados:     Number(kpi.gestionados     ?? 0),
        contactados:     Number(kpi.contactados     ?? 0),
        tiempoMedioMin:  kpi.tiempo_medio_min != null ? Number(kpi.tiempo_medio_min) : null,
      },
    });
  } catch (err: any) {
    console.error('[api/leads]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
