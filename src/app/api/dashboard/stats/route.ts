import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Pagina hasta vaciar — evita el truncamiento de 1000 filas de PostgREST
async function fetchAll<T>(
  build: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  for (;;) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function countBy(rows: any[], key: string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const row of rows) {
    const v = row[key] ?? '—';
    r[v] = (r[v] ?? 0) + 1;
  }
  return r;
}

function countByFlex<T>(rows: T[], pick: (r: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const row of rows) {
    const v = pick(row) || '—';
    r[v] = (r[v] ?? 0) + 1;
  }
  return r;
}

export async function GET(req: NextRequest) {
  // Verificar sesión
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from') ?? undefined;
  const to   = searchParams.get('to')   ?? undefined;

  const admin = createAdminClient();

  // Helpers para añadir filtros de fecha según la tabla
  const fLead  = (q: any) => { if (from) q = q.gte('fecha_entrada', from); if (to) q = q.lte('fecha_entrada', to); return q; };
  const fAppt  = (q: any) => { if (from) q = q.gte('fecha_cita',    from); if (to) q = q.lte('fecha_cita',    to); return q; };
  const fSale  = (q: any) => { if (from) q = q.gte('fecha_compra',  from); if (to) q = q.lte('fecha_compra',  to); return q; };
  const fCall  = (q: any) => { if (from) q = q.gte('call_at',       from); if (to) q = q.lte('call_at',       to); return q; };

  try {
    const [
      { count: totalLeads },
      { count: apptsTotal },
      { count: apptsAttended },
      { count: apptsNoShow },
      { count: salesCount },
      { data: salesMargen },
      { data: recentSales },
      allOrigins,
      allStatus,
      allModels,
      allCommSales,
      allQcodes,
      allAgents,
    ] = await Promise.all([
      fLead(admin.from('mmc_leads').select('*', { count: 'exact', head: true })),
      fAppt(admin.from('mmc_appointments').select('*', { count: 'exact', head: true })),
      fAppt(admin.from('mmc_appointments').select('*', { count: 'exact', head: true }).eq('status', 'attended')),
      fAppt(admin.from('mmc_appointments').select('*', { count: 'exact', head: true }).eq('status', 'no_show')),
      fSale(admin.from('mmc_sales').select('*', { count: 'exact', head: true })),
      fSale(admin.from('mmc_sales').select('margen_eur').limit(5000)),
      fSale(
        admin.from('mmc_sales')
          .select('id, model_raw, fecha_compra, margen_eur, commercial:mmc_commercials(name), lead:mmc_leads(nombre)')
          .order('fecha_compra', { ascending: false })
          .limit(8)
      ),
      // Distribuciones — paginadas para no truncarse
      fetchAll((s, e) => fLead(admin.from('mmc_leads').select('origen')).range(s, e)),
      fetchAll((s, e) => fLead(admin.from('mmc_leads').select('status')).range(s, e)),
      fetchAll((s, e) => fSale(admin.from('mmc_sales').select('model_raw, model:mmc_models(name)')).range(s, e)),
      fetchAll((s, e) => fSale(admin.from('mmc_sales').select('commercial_id, margen_eur, commercial:mmc_commercials(name)')).range(s, e)),
      fetchAll((s, e) => fCall(admin.from('mmc_calls').select('qcode_type, qcode_description')).range(s, e)),
      fetchAll((s, e) => fCall(admin.from('mmc_calls').select('agent_name, talk_time_s')).range(s, e)),
    ]);

    const origenDist = countBy(allOrigins, 'origen');
    const statusDist = countBy(allStatus, 'status');
    const modelsDist = countByFlex(allModels, (r: any) => r.model?.name ?? r.model_raw ?? 'Sin especificar');
    const qcodeDist  = countByFlex(allQcodes, (r: any) => r.qcode_description ?? r.qcode_type ?? 'Otro');
    const margenTotal = (salesMargen ?? []).reduce((s: number, r: any) => s + (Number(r.margen_eur) || 0), 0);

    // Agrupar agentes
    const agentMap = new Map<string, { count: number; answered: number; totalTalk: number }>();
    for (const r of allAgents as any[]) {
      const name = r.agent_name || 'Sin asignar';
      const cur  = agentMap.get(name) ?? { count: 0, answered: 0, totalTalk: 0 };
      cur.count++;
      if ((r.talk_time_s || 0) > 0) { cur.answered++; cur.totalTalk += r.talk_time_s; }
      agentMap.set(name, cur);
    }
    const agentStats = Array.from(agentMap.entries())
      .map(([name, v]) => ({ name, count: v.count, answered: v.answered, avgTalk: v.answered ? Math.round(v.totalTalk / v.answered) : 0 }))
      .filter(a => a.count >= 3)
      .sort((a, b) => b.count - a.count);

    // Agrupar comerciales
    const commMap = new Map<string, { count: number; margen: number }>();
    for (const r of allCommSales as any[]) {
      const name = r.commercial?.name || '—';
      const cur  = commMap.get(name) ?? { count: 0, margen: 0 };
      cur.count++;
      cur.margen += Number(r.margen_eur) || 0;
      commMap.set(name, cur);
    }
    const commercialStats = Array.from(commMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count);

    const apptsTotalN    = apptsTotal    ?? 0;
    const apptsAttendedN = apptsAttended ?? 0;
    const apptsNoShowN   = apptsNoShow   ?? 0;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      kpis: {
        totalLeads:    totalLeads    ?? 0,
        apptsTotal:    apptsTotalN,
        apptsAttended: apptsAttendedN,
        apptsNoShow:   apptsNoShowN,
        salesCount:    salesCount   ?? 0,
        margenTotal,
        conversion: apptsAttendedN > 0 ? ((salesCount ?? 0) / apptsAttendedN) * 100 : 0,
      },
      distributions: { origen: origenDist, status: statusDist, models: modelsDist, qcodes: qcodeDist },
      agentStats,
      commercialStats,
      recentSales: recentSales ?? [],
    });
  } catch (err: any) {
    console.error('[dashboard/stats]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
