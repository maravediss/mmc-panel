import { redirect } from 'next/navigation';
import { subDays, startOfMonth, startOfDay, format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Users,
  Phone,
  Calendar,
  TrendingUp,
  Euro,
  Headphones,
  Target,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');
  if (commercial.role !== 'admin' && commercial.role !== 'gerente') {
    return (
      <AppShell commercial={commercial}>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Sin permisos para la analítica.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const supabase = createClient();
  const now = new Date();
  const monthStart = startOfMonth(now).toISOString();
  const last30 = subDays(now, 30).toISOString();
  const last60 = subDays(now, 60).toISOString();

  // Consultas paralelas
  const [
    { count: totalLeads },
    { count: leadsThisMonth },
    { count: apptsTotal },
    { count: apptsAttended },
    { count: apptsNoShow },
    { count: salesCount },
    { data: salesSum },
    { data: recentSales },
    { data: allOrigins },
    { data: allStatus },
    { data: allModels },
    { data: allCommSales },
    { data: allQcodes },
    { data: allAgents },
  ] = await Promise.all([
    supabase.from('mmc_leads').select('*', { count: 'exact', head: true }),
    supabase.from('mmc_leads').select('*', { count: 'exact', head: true }).gte('fecha_entrada', monthStart),
    supabase.from('mmc_appointments').select('*', { count: 'exact', head: true }),
    supabase.from('mmc_appointments').select('*', { count: 'exact', head: true }).eq('status', 'attended'),
    supabase.from('mmc_appointments').select('*', { count: 'exact', head: true }).eq('status', 'no_show'),
    supabase.from('mmc_sales').select('*', { count: 'exact', head: true }),
    supabase.from('mmc_sales').select('margen_eur'),
    supabase
      .from('mmc_sales')
      .select('id, model_raw, fecha_compra, margen_eur, commercial:mmc_commercials(name), lead:mmc_leads(nombre)')
      .order('fecha_compra', { ascending: false })
      .limit(8),
    supabase.from('mmc_leads').select('origen'),
    supabase.from('mmc_leads').select('status'),
    supabase.from('mmc_sales').select('model_raw'),
    supabase.from('mmc_sales').select('commercial_id, margen_eur, commercial:mmc_commercials(name)'),
    supabase.from('mmc_calls').select('qcode_type, qcode_description'),
    supabase.from('mmc_calls').select('agent_name, talk_time_s'),
  ]);

  const origenDist = countBy(allOrigins ?? [], 'origen');
  const statusDist = countBy(allStatus ?? [], 'status');
  const modelsDist = countByFlex(allModels ?? [], (r: any) => r.model_raw || 'Sin especificar');
  const qcodeDist = countByFlex(allQcodes ?? [], (r: any) => r.qcode_description || r.qcode_type || 'Otro');
  const agentStats = aggregateAgents(allAgents ?? []);
  const commercialStats = aggregateCommercials(allCommSales ?? []);

  const margenTotal = (salesSum ?? []).reduce((sum: number, r: any) => sum + (Number(r.margen_eur) || 0), 0);
  const apptsTotalN = apptsTotal ?? 0;
  const apptsAttendedN = apptsAttended ?? 0;
  const apptsNoShowN = apptsNoShow ?? 0;
  const conversion = apptsAttendedN > 0 ? ((salesCount ?? 0) / apptsAttendedN) * 100 : 0;

  return (
    <AppShell commercial={commercial}>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Analítica</h1>
          <p className="text-sm text-muted-foreground">Visión global del funnel de leads</p>
        </div>
        <div className="text-xs text-muted-foreground">
          Actualizado {format(now, "d MMM yyyy · HH:mm", { locale: es })}
        </div>
      </header>

      {/* KPIs top */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPI
          icon={<Users className="h-5 w-5" />}
          label="Leads totales"
          value={totalLeads ?? 0}
          sublabel={`${leadsThisMonth ?? 0} este mes`}
          color="red"
        />
        <KPI
          icon={<Calendar className="h-5 w-5" />}
          label="Citas generadas"
          value={apptsTotalN}
          sublabel={`${apptsAttendedN} asistieron · ${apptsNoShowN} no-show`}
        />
        <KPI
          icon={<TrendingUp className="h-5 w-5" />}
          label="Ventas"
          value={salesCount ?? 0}
          sublabel={`${conversion.toFixed(1)}% cierre post-cita`}
          color="green"
        />
        <KPI
          icon={<Euro className="h-5 w-5" />}
          label="Margen total"
          value={`${margenTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`}
        />
      </div>

      {/* Embudo */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-ymc-red" />
            Embudo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Funnel
            stages={[
              { label: 'Leads capturados', value: totalLeads ?? 0 },
              {
                label: 'Contactados',
                value: (totalLeads ?? 0) - (statusDist['new'] ?? 0),
              },
              { label: 'Con cita agendada', value: apptsTotalN },
              { label: 'Asistieron a la cita', value: apptsAttendedN },
              { label: 'Compraron', value: salesCount ?? 0 },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Origen */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Origen de leads</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList items={sortedEntries(origenDist)} color="#e30613" />
          </CardContent>
        </Card>

        {/* Status */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Estado de leads</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList items={sortedEntries(statusDist)} color="#464a51" />
          </CardContent>
        </Card>

        {/* Top modelos */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Modelos más vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            {modelsDist.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas aún.</p>
            ) : (
              <BarList items={sortedEntries(modelsDist).slice(0, 10)} color="#e30613" />
            )}
          </CardContent>
        </Card>

        {/* Top comerciales */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Ventas por comercial</CardTitle>
          </CardHeader>
          <CardContent>
            {commercialStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin ventas aún.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left font-medium pb-2">Comercial</th>
                    <th className="text-right font-medium pb-2">Ventas</th>
                    <th className="text-right font-medium pb-2">Margen €</th>
                  </tr>
                </thead>
                <tbody>
                  {commercialStats.map((c) => (
                    <tr key={c.name} className="border-t">
                      <td className="py-2">{c.name}</td>
                      <td className="text-right">{c.count}</td>
                      <td className="text-right">
                        {c.margen.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Resultados Presence */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Phone className="h-5 w-5 text-ymc-red" />
              Resultados de llamadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarList items={sortedEntries(qcodeDist).slice(0, 10)} color="#848282" />
          </CardContent>
        </Card>

        {/* Agentes call center */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Headphones className="h-5 w-5 text-ymc-red" />
              Rendimiento call center
            </CardTitle>
          </CardHeader>
          <CardContent>
            {agentStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin llamadas aún.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="text-left font-medium pb-2">Operadora</th>
                    <th className="text-right font-medium pb-2">Llamadas</th>
                    <th className="text-right font-medium pb-2">Contestadas</th>
                    <th className="text-right font-medium pb-2">Tiempo medio</th>
                  </tr>
                </thead>
                <tbody>
                  {agentStats.map((a) => (
                    <tr key={a.name} className="border-t">
                      <td className="py-2 truncate max-w-[180px]">{a.name}</td>
                      <td className="text-right">{a.count}</td>
                      <td className="text-right">
                        {a.answered} ({a.count ? Math.round((a.answered / a.count) * 100) : 0}%)
                      </td>
                      <td className="text-right">
                        {a.avgTalk > 0 ? `${Math.round(a.avgTalk)}s` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ventas recientes */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="font-display text-lg">Últimas ventas</CardTitle>
        </CardHeader>
        <CardContent>
          {(recentSales ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas registradas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="text-left font-medium pb-2">Fecha</th>
                  <th className="text-left font-medium pb-2">Cliente</th>
                  <th className="text-left font-medium pb-2">Modelo</th>
                  <th className="text-left font-medium pb-2">Comercial</th>
                  <th className="text-right font-medium pb-2">Margen</th>
                </tr>
              </thead>
              <tbody>
                {(recentSales ?? []).map((s: any) => (
                  <tr key={s.id} className="border-t">
                    <td className="py-2">
                      {format(new Date(s.fecha_compra), "d MMM yyyy", { locale: es })}
                    </td>
                    <td>{s.lead?.nombre ?? '—'}</td>
                    <td>{s.model_raw ?? '—'}</td>
                    <td>{s.commercial?.name ?? '—'}</td>
                    <td className="text-right font-medium">
                      {s.margen_eur
                        ? `${Number(s.margen_eur).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function KPI({
  icon,
  label,
  value,
  sublabel,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sublabel?: string;
  color?: 'red' | 'green';
}) {
  const colorClass =
    color === 'red' ? 'text-ymc-red' : color === 'green' ? 'text-green-600' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-2 font-display text-3xl font-bold ${colorClass}`}>{value}</div>
      {sublabel && <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>}
    </div>
  );
}

function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct = (s.value / max) * 100;
        const prev = i > 0 ? stages[i - 1].value : s.value;
        const dropPct = prev > 0 ? Math.round((s.value / prev) * 100) : 0;
        return (
          <div key={s.label}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-medium">{s.label}</span>
              <span className="text-muted-foreground">
                {s.value} {i > 0 && <span className="text-xs">({dropPct}%)</span>}
              </span>
            </div>
            <div className="h-6 bg-slate-100 rounded">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.max(pct, 1)}%`,
                  background:
                    i === stages.length - 1
                      ? '#22c55e'
                      : i === 0
                      ? '#e30613'
                      : `hsl(${355 - i * 20} ${90 - i * 10}% ${50 + i * 5}%)`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarList({
  items,
  color,
}: {
  items: [string, number][];
  color: string;
}) {
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  const max = Math.max(...items.map(([, v]) => v), 1);
  return (
    <div className="space-y-2">
      {items.map(([k, v]) => {
        const pct = (v / max) * 100;
        return (
          <div key={k}>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="truncate mr-2">{k}</span>
              <span className="text-muted-foreground shrink-0">
                {v} <span className="text-xs">({Math.round((v / total) * 100)}%)</span>
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded">
              <div
                className="h-full rounded"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function countBy(rows: any[], key: string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const row of rows) {
    const v = row[key] || '—';
    r[v] = (r[v] || 0) + 1;
  }
  return r;
}

function countByFlex<T>(rows: T[], pick: (r: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const row of rows) {
    const v = pick(row) || '—';
    r[v] = (r[v] || 0) + 1;
  }
  return r;
}

function sortedEntries(d: Record<string, number>): [string, number][] {
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}

function aggregateAgents(
  rows: { agent_name: string | null; talk_time_s: number | null }[]
): { name: string; count: number; answered: number; avgTalk: number }[] {
  const m = new Map<string, { count: number; answered: number; totalTalk: number }>();
  for (const r of rows) {
    const name = r.agent_name || 'Sin asignar';
    const cur = m.get(name) || { count: 0, answered: 0, totalTalk: 0 };
    cur.count++;
    if ((r.talk_time_s || 0) > 0) {
      cur.answered++;
      cur.totalTalk += r.talk_time_s!;
    }
    m.set(name, cur);
  }
  return Array.from(m.entries())
    .map(([name, v]) => ({ name, ...v, avgTalk: v.answered ? v.totalTalk / v.answered : 0 }))
    .filter((a) => a.count >= 3)
    .sort((a, b) => b.count - a.count);
}

function aggregateCommercials(
  rows: { commercial_id: string; margen_eur: number | null; commercial: any }[]
): { name: string; count: number; margen: number }[] {
  const m = new Map<string, { count: number; margen: number }>();
  for (const r of rows) {
    const name = r.commercial?.name || '—';
    const cur = m.get(name) || { count: 0, margen: 0 };
    cur.count++;
    cur.margen += Number(r.margen_eur) || 0;
    m.set(name, cur);
  }
  return Array.from(m.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count);
}
