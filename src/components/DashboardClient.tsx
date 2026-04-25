'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { format, subDays, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { Users, Phone, Calendar, TrendingUp, Euro, Headphones, Target, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Preset = 'today' | '7d' | '30d' | 'thisMonth' | '90d' | 'all' | 'custom';

interface DateRange { from: string | null; to: string | null }

interface Stats {
  generatedAt: string;
  kpis: {
    totalLeads: number;
    apptsTotal: number;
    apptsAttended: number;
    apptsNoShow: number;
    salesCount: number;
    margenTotal: number;
    conversion: number;
  };
  distributions: {
    origen: Record<string, number>;
    status: Record<string, number>;
    models: Record<string, number>;
    qcodes: Record<string, number>;
  };
  agentStats: { name: string; count: number; answered: number; avgTalk: number }[];
  commercialStats: { name: string; count: number; margen: number }[];
  recentSales: any[];
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function toIsoStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}
function toIsoEnd(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
}
function toDateInput(iso: string | null) {
  if (!iso) return '';
  return iso.split('T')[0];
}
function fromDateInput(s: string, isEnd = false) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return isEnd ? toIsoEnd(new Date(y, m - 1, d)) : toIsoStart(new Date(y, m - 1, d));
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today',     label: 'Hoy' },
  { id: '7d',        label: '7 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: '30d',       label: '30 días' },
  { id: '90d',       label: '90 días' },
  { id: 'all',       label: 'Todo' },
  { id: 'custom',    label: 'Personalizado' },
];

function getPresetRange(preset: Preset): DateRange {
  const now = new Date();
  switch (preset) {
    case 'today':     return { from: toIsoStart(now),                           to: toIsoEnd(now) };
    case '7d':        return { from: toIsoStart(subDays(now, 6)),               to: toIsoEnd(now) };
    case 'thisMonth': return { from: toIsoStart(startOfMonth(now)),             to: toIsoEnd(now) };
    case '30d':       return { from: toIsoStart(subDays(now, 29)),              to: toIsoEnd(now) };
    case '90d':       return { from: toIsoStart(subDays(now, 89)),              to: toIsoEnd(now) };
    case 'all':       return { from: null, to: null };
    default:          return { from: null, to: null };
  }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function DashboardClient() {
  const [preset, setPreset]       = useState<Preset>('all');
  const [range, setRange]         = useState<DateRange>({ from: null, to: null });
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [stats, setStats]         = useState<Stats | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async (r: DateRange) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (r.from) params.set('from', r.from);
      if (r.to)   params.set('to',   r.to);
      const res = await fetch(`/api/dashboard/stats?${params}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data: Stats = await res.json();
      setStats(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial y cuando cambia el rango
  useEffect(() => {
    fetchStats(range);
  }, [range, fetchStats]);

  // Auto-refresh cada 5 minutos
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchStats(range);
    }, 5 * 60 * 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [range, fetchStats]);

  function handlePreset(p: Preset) {
    setPreset(p);
    if (p !== 'custom') {
      const r = getPresetRange(p);
      setRange(r);
      setCustomFrom(toDateInput(r.from));
      setCustomTo(toDateInput(r.to));
    }
  }

  function applyCustom() {
    setPreset('custom');
    setRange({
      from: fromDateInput(customFrom, false),
      to:   fromDateInput(customTo, true),
    });
  }

  const generatedAt = stats?.generatedAt
    ? format(new Date(stats.generatedAt), "d MMM yyyy · HH:mm", { locale: es })
    : null;

  return (
    <div>
      {/* Cabecera */}
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Analítica</h1>
          <p className="text-sm text-muted-foreground">Visión global del funnel de leads</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
          {generatedAt && <span>Actualizado {generatedAt}</span>}
          <button
            onClick={() => fetchStats(range)}
            className="ml-1 rounded p-1 hover:bg-slate-100"
            title="Actualizar ahora"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Selector de período */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => handlePreset(p.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              preset === p.id
                ? 'bg-ymc-red text-white'
                : 'border border-slate-200 text-slate-600 hover:border-ymc-red hover:text-ymc-red'
            }`}
          >
            {p.label}
          </button>
        ))}
        {/* Inputs personalizados */}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-xs"
            />
            <button
              onClick={applyCustom}
              className="rounded bg-ymc-red px-3 py-1 text-xs font-medium text-white hover:bg-ymc-redDark"
            >
              Aplicar
            </button>
          </div>
        )}
        {/* Badge del rango activo cuando no es "Todo" ni "Personalizado" */}
        {range.from && preset !== 'custom' && (
          <span className="text-xs text-slate-400 ml-1">
            {format(new Date(range.from), "d MMM", { locale: es })} – {range.to ? format(new Date(range.to), "d MMM yyyy", { locale: es }) : '…'}
          </span>
        )}
      </div>

      {/* Estado de carga / error */}
      {error && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-600">Error cargando datos: {error}</CardContent>
        </Card>
      )}

      {/* Skeleton mientras carga por primera vez */}
      {!stats && loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-white p-5 animate-pulse">
              <div className="h-3 w-20 bg-slate-200 rounded mb-4" />
              <div className="h-8 w-16 bg-slate-200 rounded" />
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPI
              icon={<Users className="h-5 w-5" />}
              label={range.from ? 'Leads en período' : 'Leads totales'}
              value={stats.kpis.totalLeads}
              color="red"
            />
            <KPI
              icon={<Calendar className="h-5 w-5" />}
              label="Citas generadas"
              value={stats.kpis.apptsTotal}
              sublabel={`${stats.kpis.apptsAttended} asistieron · ${stats.kpis.apptsNoShow} no-show`}
            />
            <KPI
              icon={<TrendingUp className="h-5 w-5" />}
              label="Ventas"
              value={stats.kpis.salesCount}
              sublabel={`${stats.kpis.conversion.toFixed(1)}% cierre post-cita`}
              color="green"
            />
            <KPI
              icon={<Euro className="h-5 w-5" />}
              label="Margen total"
              value={`${stats.kpis.margenTotal.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`}
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
                  { label: 'Leads capturados',    value: stats.kpis.totalLeads },
                  { label: 'Contactados',          value: stats.kpis.totalLeads - (stats.distributions.status['new'] ?? 0) },
                  { label: 'Con cita agendada',    value: stats.kpis.apptsTotal },
                  { label: 'Asistieron a la cita', value: stats.kpis.apptsAttended },
                  { label: 'Compraron',            value: stats.kpis.salesCount },
                ]}
              />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Origen */}
            <Card>
              <CardHeader><CardTitle className="font-display text-lg">Origen de leads</CardTitle></CardHeader>
              <CardContent><BarList items={sortedEntries(stats.distributions.origen)} color="#e30613" /></CardContent>
            </Card>

            {/* Estado */}
            <Card>
              <CardHeader><CardTitle className="font-display text-lg">Estado de leads</CardTitle></CardHeader>
              <CardContent><BarList items={sortedEntries(stats.distributions.status)} color="#464a51" /></CardContent>
            </Card>

            {/* Modelos */}
            <Card>
              <CardHeader><CardTitle className="font-display text-lg">Modelos más vendidos</CardTitle></CardHeader>
              <CardContent>
                {Object.keys(stats.distributions.models).length === 0
                  ? <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
                  : <BarList items={sortedEntries(stats.distributions.models).slice(0, 10)} color="#e30613" />}
              </CardContent>
            </Card>

            {/* Comerciales */}
            <Card>
              <CardHeader><CardTitle className="font-display text-lg">Ventas por comercial</CardTitle></CardHeader>
              <CardContent>
                {stats.commercialStats.length === 0
                  ? <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
                  : (
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="text-left font-medium pb-2">Comercial</th>
                          <th className="text-right font-medium pb-2">Ventas</th>
                          <th className="text-right font-medium pb-2">Margen €</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.commercialStats.map(c => (
                          <tr key={c.name} className="border-t">
                            <td className="py-2">{c.name}</td>
                            <td className="text-right">{c.count}</td>
                            <td className="text-right">{c.margen.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €</td>
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
                {Object.keys(stats.distributions.qcodes).length === 0
                  ? <p className="text-sm text-muted-foreground">Sin llamadas en este período.</p>
                  : <BarList items={sortedEntries(stats.distributions.qcodes).slice(0, 10)} color="#848282" />}
              </CardContent>
            </Card>

            {/* Agentes */}
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <Headphones className="h-5 w-5 text-ymc-red" />
                  Rendimiento call center
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats.agentStats.length === 0
                  ? <p className="text-sm text-muted-foreground">Sin llamadas en este período.</p>
                  : (
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
                        {stats.agentStats.map(a => (
                          <tr key={a.name} className="border-t">
                            <td className="py-2 truncate max-w-[180px]">{a.name}</td>
                            <td className="text-right">{a.count}</td>
                            <td className="text-right">{a.answered} ({a.count ? Math.round((a.answered / a.count) * 100) : 0}%)</td>
                            <td className="text-right">{a.avgTalk > 0 ? `${a.avgTalk}s` : '—'}</td>
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
            <CardHeader><CardTitle className="font-display text-lg">Últimas ventas</CardTitle></CardHeader>
            <CardContent>
              {stats.recentSales.length === 0
                ? <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>
                : (
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
                      {stats.recentSales.map((s: any) => (
                        <tr key={s.id} className="border-t">
                          <td className="py-2">{format(new Date(s.fecha_compra), "d MMM yyyy", { locale: es })}</td>
                          <td>{s.lead_nombre ?? '—'}</td>
                          <td>{s.model_name ?? s.model_raw ?? '—'}</td>
                          <td>{s.commercial_name ?? '—'}</td>
                          <td className="text-right font-medium">
                            {s.margen_eur ? `${Number(s.margen_eur).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function KPI({ icon, label, value, sublabel, color }: {
  icon: React.ReactNode; label: string; value: string | number; sublabel?: string; color?: 'red' | 'green';
}) {
  const cls = color === 'red' ? 'text-ymc-red' : color === 'green' ? 'text-green-600' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-white p-5">
      <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className={`mt-2 font-display text-3xl font-bold ${cls}`}>{value}</div>
      {sublabel && <div className="text-xs text-muted-foreground mt-1">{sublabel}</div>}
    </div>
  );
}

function Funnel({ stages }: { stages: { label: string; value: number }[] }) {
  const max = Math.max(...stages.map(s => s.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const pct     = (s.value / max) * 100;
        const prev    = i > 0 ? stages[i - 1].value : s.value;
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
              <div className="h-full rounded" style={{
                width: `${Math.max(pct, 1)}%`,
                background: i === stages.length - 1 ? '#22c55e' : i === 0 ? '#e30613' : `hsl(${355 - i * 20} ${90 - i * 10}% ${50 + i * 5}%)`,
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarList({ items, color }: { items: [string, number][]; color: string }) {
  const total = items.reduce((s, [, v]) => s + v, 0) || 1;
  const max   = Math.max(...items.map(([, v]) => v), 1);
  return (
    <div className="space-y-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="truncate mr-2">{k}</span>
            <span className="text-muted-foreground shrink-0">{v} <span className="text-xs">({Math.round((v / total) * 100)}%)</span></span>
          </div>
          <div className="h-2 bg-slate-100 rounded">
            <div className="h-full rounded" style={{ width: `${(v / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function sortedEntries(d: Record<string, number>): [string, number][] {
  return Object.entries(d).sort((a, b) => b[1] - a[1]);
}
