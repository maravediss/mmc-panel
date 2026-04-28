import { redirect } from 'next/navigation';
import {
  TrendingUp,
  Trophy,
  Medal,
  Award,
  Euro,
  Target,
  XCircle,
  AlertTriangle,
  Flame,
  Bike,
  LineChart as LineChartIcon,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { KPICard, PeriodSelector } from '@/components/KPISet';
import { resolvePeriod, PERIOD_LABEL, type Period } from '@/lib/period';

export const dynamic = 'force-dynamic';

const VALID_PERIODS: Period[] = ['today', '7d', '30d', '90d', 'month', 'year', 'custom'];

const MES_LABEL = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

function eur(n: number | null | undefined) {
  return `${(Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
}
function num(n: number | null | undefined) {
  return (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 });
}
function pct(n: number | null | undefined) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}
function mesLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-');
  return `${MES_LABEL[Number(m) - 1]} ${y.slice(2)}`;
}

export default async function AnaliticaPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string };
}) {
  const me = await getCurrentCommercial();
  if (!me) redirect('/login');
  if (me.role === 'operadora') redirect('/operator');

  const period: Period = VALID_PERIODS.includes(searchParams.period as Period)
    ? (searchParams.period as Period)
    : '30d';
  const customFrom = searchParams.from;
  const customTo = searchParams.to;

  const supabase = createClient();
  const { from, to } = resolvePeriod(period, undefined, { from: customFrom, to: customTo });

  // Para evolución mensual: 1-ene-2026 → 00:00 de hoy (excluye día actual,
  // mostramos hasta el día anterior).
  const evoFrom = new Date(2026, 0, 1).toISOString();
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const evoTo = today0.toISOString();

  const [analyticsRes, evoRes] = await Promise.all([
    supabase.rpc('mmc_commercials_analytics', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    supabase.rpc('mmc_monthly_evolution', {
      p_from: evoFrom,
      p_to: evoTo,
    }),
  ]);

  if (analyticsRes.error) {
    return (
      <AppShell commercial={me}>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-base font-medium">No se pudo cargar la analítica.</p>
            <p className="text-sm text-muted-foreground">{analyticsRes.error.message}</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const data = (analyticsRes.data as any) || {};
  const evo: any[] = (evoRes.data as any[]) || [];
  const totals = data.totals || {};
  const commercials: any[] = (data.commercials || []).filter(
    (c: any) => c.role !== 'admin'
  );
  const families: any[] = data.families || [];
  const topModels: any[] = data.top_models || [];

  // Agregados del período
  const ventasTotales = totals.ventas_total || 0;
  const margenTotal = Number(totals.margen_total || 0);
  const citasTotales = totals.citas_total || 0;
  const atendidasTotales = totals.atendidas_total || 0;
  const noShowTotales = totals.no_show_total || 0;
  const pendingOverdueTotal = totals.pending_overdue_total || 0;
  const pipelineMargenTotal = Number(totals.pipeline_margen_total || 0);
  const pipelineLeadsTotal = totals.pipeline_total || 0;
  const margenPerdidoTotal = Number(totals.margen_perdido_total || 0);
  const ticketGlobal = Number(totals.ticket_global || 0);
  const leadsNuevos = totals.leads_nuevos || 0;
  // Conversión robusta: ventas / citas no canceladas
  const conversionGlobal =
    citasTotales > 0 ? (ventasTotales / citasTotales) * 100 : 0;
  const asistenciaGlobal =
    citasTotales > 0 ? (atendidasTotales / citasTotales) * 100 : 0;

  // Rankings
  const byVentas = [...commercials].sort(
    (a, b) => (b.ventas_n || 0) - (a.ventas_n || 0)
  );
  const byMargen = [...commercials].sort(
    (a, b) => Number(b.ventas_margen || 0) - Number(a.ventas_margen || 0)
  );
  const byPipeline = [...commercials].sort(
    (a, b) => Number(b.pipeline_margen || 0) - Number(a.pipeline_margen || 0)
  );
  const byPerdido = [...commercials].sort(
    (a, b) => Number(b.margen_perdido || 0) - Number(a.margen_perdido || 0)
  );

  // Datos para gráfica evolutiva
  const maxVentas = Math.max(...evo.map((m) => m.ventas), 1);
  const maxMargen = Math.max(...evo.map((m) => Number(m.margen_eur)), 1);
  const maxLeads = Math.max(...evo.map((m) => m.leads_nuevos), 1);

  // Totales del histórico evolutivo
  const evoTotalLeads = evo.reduce((s, m) => s + (m.leads_nuevos || 0), 0);
  const evoTotalCitas = evo.reduce((s, m) => s + (m.citas || 0), 0);
  const evoTotalVentas = evo.reduce((s, m) => s + (m.ventas || 0), 0);
  const evoTotalMargen = evo.reduce((s, m) => s + Number(m.margen_eur || 0), 0);
  const evoConversion = evoTotalCitas > 0 ? (evoTotalVentas / evoTotalCitas) * 100 : 0;
  const evoTicketMedio = evoTotalVentas > 0 ? evoTotalMargen / evoTotalVentas : 0;

  const periodLabel =
    period === 'custom' && customFrom && customTo
      ? `${customFrom} → ${customTo}`
      : PERIOD_LABEL[period];

  return (
    <AppShell commercial={me}>
      <header className="mb-5 flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-ymc-red" />
            Analítica del concesionario
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Datos agregados de todos los comerciales · período: {periodLabel}
          </p>
        </div>
        <PeriodSelector value={period} customFrom={customFrom} customTo={customTo} />
      </header>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECCIÓN 1 · Resumen ejecutivo del período                              */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-ymc-red" />
          Resumen del período
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <KPICard
            icon={<Users className="h-4 w-4" />}
            label="Leads nuevos"
            value={num(leadsNuevos)}
            sub="Entrados en el período"
          />
          <KPICard
            icon={<Trophy className="h-4 w-4" />}
            label="Ventas cerradas"
            value={ventasTotales}
            sub={`${num(citasTotales)} citas · ${num(atendidasTotales)} asistieron`}
            color="green"
          />
          <KPICard
            icon={<Euro className="h-4 w-4" />}
            label="Margen facturado"
            value={eur(margenTotal)}
            sub={`Ticket medio ${eur(ticketGlobal)}`}
            color="green"
          />
          <KPICard
            icon={<Target className="h-4 w-4" />}
            label="% Conversión"
            value={pct(conversionGlobal)}
            sub={`Asistencia ${asistenciaGlobal.toFixed(0)}%`}
            color="sky"
          />
        </div>

        {/* Tensión: sin cerrar + perdido + pipeline */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-3">
          <KPICard
            icon={<Flame className="h-4 w-4" />}
            label="🎯 Pipeline activo (€ a ganar)"
            value={eur(pipelineMargenTotal)}
            sub={`${num(pipelineLeadsTotal)} leads con cita pendiente`}
            color="red"
          />
          <KPICard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="⚠️ Margen perdido"
            value={eur(margenPerdidoTotal)}
            sub={`${num(noShowTotales)} no asistieron + asistencias sin venta`}
            color="amber"
          />
          <KPICard
            icon={<XCircle className="h-4 w-4" />}
            label="Citas sin cerrar"
            value={pendingOverdueTotal}
            sub="Pasadas y aún sin reportar"
            color="amber"
          />
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECCIÓN 2 · Evolución mensual                                         */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <LineChartIcon className="h-5 w-5 text-ymc-red" />
          Evolución mensual
          <span className="text-xs text-muted-foreground font-sans font-normal">
            (1-ene-2026 → ayer)
          </span>
        </h2>

        {/* Totales del histórico evolutivo (independiente del período) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-4">
          <Mini label="Total leads" value={num(evoTotalLeads)} />
          <Mini label="Total citas" value={num(evoTotalCitas)} />
          <Mini label="Total ventas" value={num(evoTotalVentas)} color="green" />
          <Mini label="Margen acum." value={eur(evoTotalMargen)} color="green" />
          <Mini label="Conv. acum." value={pct(evoConversion)} color="sky" />
        </div>

        {/* Gráfica de barras evolutiva (3 series por mes) */}
        <Card className="mb-3">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Tendencia mensual</CardTitle>
          </CardHeader>
          <CardContent>
            {evo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-1 md:gap-3 h-48 mb-3 px-1">
                  {evo.map((m) => {
                    const hL = (m.leads_nuevos / maxLeads) * 100;
                    const hC = (m.citas / Math.max(maxLeads / 5, 1)) * 100;
                    const hV = (m.ventas / Math.max(maxVentas, 1)) * 100;
                    return (
                      <div
                        key={m.mes}
                        className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                      >
                        <div className="flex items-end gap-0.5 h-40 w-full">
                          <div
                            className="flex-1 bg-slate-300 rounded-t"
                            style={{ height: `${hL}%` }}
                            title={`Leads: ${m.leads_nuevos}`}
                          />
                          <div
                            className="flex-1 bg-amber-400 rounded-t"
                            style={{ height: `${hC}%` }}
                            title={`Citas: ${m.citas}`}
                          />
                          <div
                            className="flex-1 bg-ymc-red rounded-t"
                            style={{ height: `${hV}%` }}
                            title={`Ventas: ${m.ventas}`}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {mesLabel(m.mes)}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 bg-slate-300 rounded-sm" /> Leads
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 bg-amber-400 rounded-sm" /> Citas
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-3 bg-ymc-red rounded-sm" /> Ventas
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sparkline de margen € por mes */}
        <Card className="mb-3">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Margen € mensual</CardTitle>
          </CardHeader>
          <CardContent>
            {evo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            ) : (
              <div className="flex items-end justify-between gap-2 h-32 px-1">
                {evo.map((m) => {
                  const h = (Number(m.margen_eur) / maxMargen) * 100;
                  return (
                    <div
                      key={m.mes}
                      className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
                    >
                      <span className="text-[9px] text-muted-foreground tabular-nums">
                        {Number(m.margen_eur) > 0
                          ? eur(m.margen_eur)
                          : ''}
                      </span>
                      <div
                        className="w-full bg-green-600 rounded-t"
                        style={{ height: `${h}%` }}
                        title={`${eur(m.margen_eur)}`}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {mesLabel(m.mes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tabla mensual */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Detalle mensual</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Mes</th>
                  <th className="text-right py-2 px-2">Leads</th>
                  <th className="text-right py-2 px-2">Citas</th>
                  <th className="text-right py-2 px-2">Asisten</th>
                  <th className="text-right py-2 px-2">No asisten</th>
                  <th className="text-right py-2 px-2">Ventas</th>
                  <th className="text-right py-2 px-2">Margen €</th>
                  <th className="text-right py-2 px-2">Ticket €</th>
                  <th className="text-right py-2 px-2">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {evo.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      Sin datos.
                    </td>
                  </tr>
                ) : (
                  evo.map((m) => (
                    <tr key={m.mes} className="border-b hover:bg-slate-50">
                      <td className="py-2 px-2 font-medium capitalize">{mesLabel(m.mes)}</td>
                      <td className="text-right py-2 px-2">{m.leads_nuevos}</td>
                      <td className="text-right py-2 px-2">{m.citas}</td>
                      <td className="text-right py-2 px-2 text-green-700">{m.atendidas}</td>
                      <td className="text-right py-2 px-2 text-red-600">{m.no_show}</td>
                      <td className="text-right py-2 px-2 font-semibold">{m.ventas}</td>
                      <td className="text-right py-2 px-2 font-semibold text-green-700">
                        {eur(m.margen_eur)}
                      </td>
                      <td className="text-right py-2 px-2">{eur(m.ticket_medio_eur)}</td>
                      <td className="text-right py-2 px-2">{pct(m.conversion_pct)}</td>
                    </tr>
                  ))
                )}
                {evo.length > 0 && (
                  <tr className="border-t-2 font-semibold bg-slate-50">
                    <td className="py-2 px-2">Total</td>
                    <td className="text-right py-2 px-2">{num(evoTotalLeads)}</td>
                    <td className="text-right py-2 px-2">{num(evoTotalCitas)}</td>
                    <td className="text-right py-2 px-2 text-green-700">
                      {num(evo.reduce((s, m) => s + m.atendidas, 0))}
                    </td>
                    <td className="text-right py-2 px-2 text-red-600">
                      {num(evo.reduce((s, m) => s + m.no_show, 0))}
                    </td>
                    <td className="text-right py-2 px-2">{num(evoTotalVentas)}</td>
                    <td className="text-right py-2 px-2 text-green-700">
                      {eur(evoTotalMargen)}
                    </td>
                    <td className="text-right py-2 px-2">{eur(evoTicketMedio)}</td>
                    <td className="text-right py-2 px-2">{pct(evoConversion)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECCIÓN 3 · Ranking entre comerciales                                  */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          Ranking comerciales · {periodLabel}
        </h2>

        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Podio · Ventas</CardTitle>
          </CardHeader>
          <CardContent>
            {byVentas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Sin datos suficientes.</p>
            ) : (
              <Podio
                rows={byVentas.slice(0, 3)}
                metric="ventas_n"
                format={(n) => `${n} venta${n === 1 ? '' : 's'}`}
                currentId={me.id}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <RankingList
            title="Margen acumulado"
            icon={<Euro className="h-4 w-4 text-green-600" />}
            rows={byMargen.slice(0, 6)}
            metricKey="ventas_margen"
            format={(n) => eur(Number(n))}
            currentId={me.id}
          />
          <RankingList
            title="Pipeline activo (€ a ganar)"
            icon={<Flame className="h-4 w-4 text-ymc-red" />}
            rows={byPipeline.slice(0, 6)}
            metricKey="pipeline_margen"
            format={(n) => eur(Number(n))}
            subFor={(r) => `${r.pipeline_n || 0} leads pendientes`}
            currentId={me.id}
          />
        </div>

        {/* Tabla detallada — 1 fila por comercial */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-display text-base">Detalle por comercial</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left py-2 px-2">Comercial</th>
                  <th className="text-right py-2 px-2">Citas</th>
                  <th className="text-right py-2 px-2" title="Asistencias">Asisten</th>
                  <th className="text-right py-2 px-2">No asisten</th>
                  <th className="text-right py-2 px-2">Sin cerrar</th>
                  <th className="text-right py-2 px-2">Ventas</th>
                  <th className="text-right py-2 px-2">Margen</th>
                  <th className="text-right py-2 px-2">Conv.</th>
                  <th className="text-right py-2 px-2">Pipeline</th>
                  <th className="text-right py-2 px-2">€ perdido</th>
                </tr>
              </thead>
              <tbody>
                {commercials.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-muted-foreground">
                      Sin comerciales en el período seleccionado.
                    </td>
                  </tr>
                ) : (
                  byVentas.map((c) => {
                    const conv =
                      c.citas > 0 ? ((c.ventas_n || 0) / c.citas) * 100 : 0;
                    const isMe = c.id === me.id;
                    return (
                      <tr
                        key={c.id}
                        className={`border-b hover:bg-slate-50 ${
                          isMe ? 'bg-ymc-redLight/40 font-medium' : ''
                        }`}
                      >
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <Avatar name={c.display_name || c.name} highlight={isMe} />
                            <div className="min-w-0">
                              <div className="truncate">
                                {c.display_name || c.name}
                                {isMe && (
                                  <span className="ml-1 text-[10px] text-ymc-red">(tú)</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2">{c.citas || 0}</td>
                        <td className="text-right py-2 px-2 text-green-700">
                          {c.atendidas || 0}
                        </td>
                        <td className="text-right py-2 px-2 text-red-600">
                          {c.no_show || 0}
                        </td>
                        <td
                          className={`text-right py-2 px-2 ${
                            (c.pending_overdue || 0) > 0 ? 'text-amber-600 font-semibold' : ''
                          }`}
                        >
                          {c.pending_overdue || 0}
                        </td>
                        <td className="text-right py-2 px-2 font-semibold">{c.ventas_n || 0}</td>
                        <td className="text-right py-2 px-2 font-semibold text-green-700">
                          {eur(Number(c.ventas_margen || 0))}
                        </td>
                        <td className="text-right py-2 px-2">{pct(conv)}</td>
                        <td className="text-right py-2 px-2 text-ymc-red">
                          {eur(Number(c.pipeline_margen || 0))}
                        </td>
                        <td className="text-right py-2 px-2 text-amber-600">
                          {eur(Number(c.margen_perdido || 0))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECCIÓN 4 · Producto                                                   */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <Bike className="h-5 w-5 text-ymc-red" />
          Producto
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base">Top modelos vendidos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topModels.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin ventas en el período.</p>
              ) : (
                topModels.map((m: any, i: number) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-5">#{i + 1}</span>
                      <span className="font-medium">{m.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{m.n}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {eur(Number(m.margen))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-display text-base">Distribución por familia</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {families.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin datos.</p>
              ) : (
                families
                  .sort((a: any, b: any) => (b.n || 0) - (a.n || 0))
                  .map((f: any) => {
                    const total = families.reduce((s: number, x: any) => s + (x.n || 0), 0);
                    const pp = total > 0 ? ((f.n || 0) / total) * 100 : 0;
                    return (
                      <div key={f.family} className="space-y-0.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="capitalize font-medium">{f.family}</span>
                          <span className="text-xs text-muted-foreground">
                            {f.n} · {eur(Number(f.margen))} · {pp.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-ymc-red" style={{ width: `${pp}%` }} />
                        </div>
                      </div>
                    );
                  })
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────────── */}
      {/* SECCIÓN 5 · Oportunidad perdida & sin cerrar                          */}
      {/* ──────────────────────────────────────────────────────────────────── */}
      {(byPerdido.some((c) => Number(c.margen_perdido || 0) > 0) ||
        commercials.some((c) => (c.pending_overdue || 0) > 0)) && (
        <section className="mb-3">
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Atención
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RankingList
              title="€ perdido (no asistencias + no compra)"
              icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
              rows={byPerdido.slice(0, 6)}
              metricKey="margen_perdido"
              format={(n) => eur(Number(n))}
              subFor={(r) =>
                `${r.perdidas_no_show || 0} no asistieron · ${
                  r.perdidas_no_compra || 0
                } no compra`
              }
              currentId={me.id}
              inverted
            />
            <Card className="border-amber-200 bg-amber-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">Citas sin cerrar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {commercials
                  .filter((c) => (c.pending_overdue || 0) > 0)
                  .sort((a, b) => (b.pending_overdue || 0) - (a.pending_overdue || 0))
                  .map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between text-sm bg-white rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={c.display_name || c.name}
                          highlight={c.id === me.id}
                        />
                        <span>
                          {c.display_name || c.name}
                          {c.id === me.id && (
                            <span className="ml-1 text-[10px] text-ymc-red">(tú)</span>
                          )}
                        </span>
                      </div>
                      <span className="text-amber-700 font-semibold">
                        {c.pending_overdue} pendiente{c.pending_overdue === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                {!commercials.some((c) => (c.pending_overdue || 0) > 0) && (
                  <p className="text-sm text-muted-foreground py-2">
                    🎉 Ningún comercial con citas sin cerrar.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────

function Mini({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color?: 'red' | 'green' | 'sky' | 'amber';
}) {
  const c =
    color === 'red'
      ? 'text-ymc-red'
      : color === 'green'
      ? 'text-green-600'
      : color === 'sky'
      ? 'text-sky-600'
      : color === 'amber'
      ? 'text-amber-600'
      : '';
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-display text-xl font-semibold ${c}`}>{value}</div>
    </div>
  );
}

function Avatar({ name, highlight }: { name: string; highlight?: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-[10px] font-bold ${
        highlight ? 'bg-ymc-red text-white' : 'bg-slate-200 text-slate-700'
      }`}
    >
      {initials(name)}
    </span>
  );
}

function Podio({
  rows,
  metric,
  format,
  currentId,
}: {
  rows: any[];
  metric: string;
  format: (n: number) => string;
  currentId: string;
}) {
  const order = [1, 0, 2];
  const heights = ['h-24', 'h-32', 'h-20'];
  const colors = [
    'bg-slate-300 text-slate-800',
    'bg-amber-400 text-amber-950',
    'bg-orange-300 text-orange-950',
  ];
  const icons = [
    <Medal key="2" className="h-5 w-5" />,
    <Trophy key="1" className="h-5 w-5" />,
    <Award key="3" className="h-5 w-5" />,
  ];

  return (
    <div className="flex items-end justify-center gap-3 md:gap-6 py-3">
      {order.map((idx, slot) => {
        const r = rows[idx];
        if (!r) {
          return (
            <div
              key={`empty-${slot}`}
              className={`w-24 md:w-28 ${heights[slot]} rounded-t-lg bg-slate-100 opacity-50`}
            />
          );
        }
        const isMe = r.id === currentId;
        return (
          <div key={r.id} className="flex flex-col items-center gap-2 w-24 md:w-32 text-center">
            <Avatar name={r.display_name || r.name} highlight={isMe} />
            <div className="text-xs font-semibold leading-tight">
              {(r.display_name || r.name).split(' ')[0]}
              {isMe && <span className="block text-[9px] text-ymc-red">(tú)</span>}
            </div>
            <div className="text-xs text-muted-foreground">{format(Number(r[metric] || 0))}</div>
            <div
              className={`w-full ${heights[slot]} rounded-t-lg ${colors[slot]} flex flex-col items-center justify-end pb-2`}
            >
              <div className="font-bold text-2xl flex items-center gap-1">
                {icons[slot]}
                {idx + 1}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankingList({
  title,
  icon,
  rows,
  metricKey,
  format,
  subFor,
  currentId,
  inverted = false,
}: {
  title: string;
  icon: React.ReactNode;
  rows: any[];
  metricKey: string | ((r: any) => number);
  format: (n: number) => string;
  subFor?: (r: any) => string;
  currentId: string;
  inverted?: boolean;
}) {
  const get = (r: any) =>
    typeof metricKey === 'function' ? metricKey(r) : Number(r[metricKey] || 0);
  const max = Math.max(...rows.map((r) => Math.abs(get(r))), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin datos.</p>
        ) : (
          rows.map((r, i) => {
            const v = get(r);
            const pp = (Math.abs(v) / max) * 100;
            const isMe = r.id === currentId;
            return (
              <div key={r.id} className="space-y-0.5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-xs font-mono ${
                        i === 0 ? 'text-amber-500 font-bold' : 'text-muted-foreground'
                      } w-5`}
                    >
                      #{i + 1}
                    </span>
                    <Avatar name={r.display_name || r.name} highlight={isMe} />
                    <span
                      className={`truncate ${
                        isMe ? 'font-semibold text-ymc-red' : 'font-medium'
                      }`}
                    >
                      {r.display_name || r.name}
                      {isMe && <span className="ml-1 text-[10px] text-ymc-red">(tú)</span>}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums">{format(v)}</span>
                </div>
                <div className="h-1 rounded-full bg-slate-100 overflow-hidden ml-7">
                  <div
                    className={`h-full ${
                      inverted ? 'bg-amber-500' : i === 0 ? 'bg-ymc-red' : 'bg-slate-400'
                    }`}
                    style={{ width: `${pp}%` }}
                  />
                </div>
                {subFor && <p className="text-[11px] text-muted-foreground ml-7">{subFor(r)}</p>}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
