'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Search, ChevronLeft, ChevronRight, RefreshCw,
  Users, CheckCheck, Phone, Clock,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ORIGIN_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_COLOR } from '@/lib/mappings';
import type { LeadOrigin, LeadStatus } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadRow {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  modelo_raw: string | null;
  origen: string;
  status: string;
  fecha_entrada: string;
  proxima_cita: string | null;
}

interface Kpis {
  entrantes: number;
  gestionados: number;
  contactados: number;
  tiempoMedioMin: number | null;
}

interface ApiResponse {
  leads: LeadRow[];
  total: number;
  page: number;
  pages: number;
  kpis: Kpis;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function fmtMinutes(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min.toFixed(0)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub,
}: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
}) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <span className="text-ymc-red">{icon}</span>
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Status cell ──────────────────────────────────────────────────────────────

function StatusCell({ status, proximaCita }: { status: string; proximaCita: string | null }) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${LEAD_STATUS_COLOR[status as LeadStatus] ?? 'bg-slate-300'}`} />
        <span className="text-sm">{LEAD_STATUS_LABEL[status as LeadStatus] ?? status}</span>
      </div>
      {status === 'appointment' && proximaCita && (
        <div className="text-[10px] text-amber-600 mt-0.5 pl-3.5">
          {format(new Date(proximaCita), "d MMM · HH:mm", { locale: es })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LeadsPageClient() {
  const [dateFrom, setDateFrom]       = useState(todayISO());
  const [dateTo,   setDateTo]         = useState(todayISO());
  const [search, setSearch]           = useState('');
  const [debouncedSearch, setDebounced] = useState('');
  const [page, setPage]               = useState(1);
  const [data, setData]               = useState<ApiResponse | null>(null);
  const [loading, setLoading]         = useState(true);
  const [refreshKey, setRefreshKey]   = useState(0);
  const [rotating, setRotating]       = useState(false);
  const firstLoad                     = useRef(true);

  // Keep dateTo >= dateFrom
  function handleDateFrom(val: string) {
    setDateFrom(val);
    if (dateTo < val) setDateTo(val);
  }
  function handleDateTo(val: string) {
    setDateTo(val);
    if (dateFrom > val) setDateFrom(val);
  }

  // Debounce search 350ms
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  useEffect(() => {
    if (!firstLoad.current) setPage(1);
  }, [dateFrom, dateTo, debouncedSearch]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, page: String(page) });
      if (debouncedSearch) params.set('q', debouncedSearch);
      const res = await fetch(`/api/leads?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
      firstLoad.current = false;
    }
  }, [dateFrom, dateTo, page, debouncedSearch, refreshKey]); // eslint-disable-line

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 5 minutes (sync interval)
  useEffect(() => {
    const t = setInterval(() => setRefreshKey(k => k + 1), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  function manualRefresh() {
    setRotating(true);
    setTimeout(() => setRotating(false), 800);
    setRefreshKey(k => k + 1);
  }

  const kpis = data?.kpis;

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">Base de datos de leads capturados · actualización automática cada 5 min</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={e => handleDateFrom(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:border-ymc-red focus:outline-none"
            />
            <span className="text-xs text-muted-foreground">—</span>
            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              onChange={e => handleDateTo(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:border-ymc-red focus:outline-none"
            />
          </div>
          <button
            onClick={manualRefresh}
            title="Actualizar ahora"
            className="h-9 w-9 rounded-md border border-input bg-background flex items-center justify-center hover:bg-slate-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-muted-foreground ${rotating ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="flex flex-wrap gap-3 mb-6">
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Leads entrantes"
          value={kpis?.entrantes ?? '—'}
          sub={
            dateFrom === dateTo
              ? (dateFrom === todayISO() ? 'hoy' : format(new Date(dateFrom + 'T12:00:00'), "d MMM yyyy", { locale: es }))
              : `${format(new Date(dateFrom + 'T12:00:00'), "d MMM", { locale: es })} – ${format(new Date(dateTo + 'T12:00:00'), "d MMM yyyy", { locale: es })}`
          }
        />
        <KpiCard
          icon={<CheckCheck className="h-4 w-4" />}
          label="Gestionados"
          value={kpis?.gestionados ?? '—'}
          sub="con actividad"
        />
        <KpiCard
          icon={<Phone className="h-4 w-4" />}
          label="Contactados"
          value={kpis?.contactados ?? '—'}
          sub="cogieron el teléfono"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Tiempo medio 1er contacto"
          value={fmtMinutes(kpis?.tiempoMedioMin ?? null)}
          sub="hasta 1ª llamada del call center"
        />
      </div>

      {/* ── Search bar ── */}
      <form className="mb-4 flex gap-2" onSubmit={e => e.preventDefault()}>
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, teléfono o modelo…"
            className="pl-9"
          />
        </div>
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-sm text-muted-foreground px-3 py-2 hover:text-foreground"
          >
            Limpiar
          </button>
        )}
      </form>

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0">
          <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium w-[120px]">Fecha entrada</th>
                  <th className="px-4 py-3 text-left font-medium">Nombre</th>
                  <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Teléfono</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Email</th>
                  <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Modelo</th>
                  <th className="px-4 py-3 text-left font-medium">Canal</th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(data?.leads ?? []).map((l) => (
                  <tr
                    key={l.id}
                    className="hover:bg-ymc-redLight/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(l.fecha_entrada), "d MMM yyyy", { locale: es })}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/leads/${l.id}`}
                        className="hover:text-ymc-red hover:underline transition-colors"
                      >
                        {l.nombre}
                      </Link>
                      {/* Mobile-only: tel + email below name */}
                      <div className="md:hidden text-xs text-muted-foreground mt-0.5">
                        {l.telefono}
                        {l.telefono && l.email && ' · '}
                        {l.email}
                      </div>
                      {/* Mobile-only: model below name */}
                      {l.modelo_raw && (
                        <div className="lg:hidden text-xs text-muted-foreground mt-0.5 italic">
                          {l.modelo_raw}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                      {l.telefono ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell max-w-[200px] truncate">
                      {l.email ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell max-w-[160px] truncate">
                      {l.modelo_raw ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-xs font-normal whitespace-nowrap">
                        {ORIGIN_LABEL[l.origen as LeadOrigin] ?? l.origen}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <StatusCell status={l.status} proximaCita={l.proxima_cita} />
                    </td>
                  </tr>
                ))}
                {!loading && (data?.leads ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                      No hay resultados para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      {(data?.pages ?? 0) > 1 && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {data ? `${(data.page - 1) * 50 + 1}–${Math.min(data.page * 50, data.total)} de ${data.total} leads` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-8 w-8 rounded-md border flex items-center justify-center disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium px-2">
              {page} / {data?.pages ?? 1}
            </span>
            <button
              onClick={() => setPage(p => Math.min(data?.pages ?? 1, p + 1))}
              disabled={page === (data?.pages ?? 1)}
              className="h-8 w-8 rounded-md border flex items-center justify-center disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Info footer ── */}
      <p className="text-xs text-muted-foreground text-center mt-4">
        El sync con el Sheet se ejecuta cada 5 min · datos de appointments y llamadas en tiempo real
      </p>
    </div>
  );
}
