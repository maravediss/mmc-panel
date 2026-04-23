'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Filter, X, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ORIGIN_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_COLOR } from '@/lib/mappings';
import type { LeadOrigin, LeadStatus } from '@/lib/types';

type Filters = {
  q: string;
  origen: string;
  formulario: string;
  modelo: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  contactada: string;
};

export default function LeadsListClient({
  leads,
  total,
  page,
  pageSize,
  origens,
  statuses,
  initialFilters,
}: {
  leads: any[];
  total: number;
  page: number;
  pageSize: number;
  origens: string[];
  statuses: string[];
  initialFilters: Filters;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showFilters, setShowFilters] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeFiltersCount = useMemo(
    () => Object.entries(filters).filter(([k, v]) => k !== 'q' && v).length,
    [filters]
  );

  function applyFilters(next: Partial<Filters>, resetPage = true) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const params = new URLSearchParams();
    // Conservar ?tel si viene
    if (sp.get('tel')) params.set('tel', sp.get('tel')!);
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v as string);
    }
    if (!resetPage) params.set('page', String(page));
    router.push(`/call-center?${params.toString()}#list`);
  }

  function clearAll() {
    const params = new URLSearchParams();
    if (sp.get('tel')) params.set('tel', sp.get('tel')!);
    setFilters({
      q: '', origen: '', formulario: '', modelo: '', status: '',
      dateFrom: '', dateTo: '', contactada: '',
    });
    router.push(`/call-center?${params.toString()}#list`);
  }

  function goToPage(p: number) {
    const params = new URLSearchParams();
    if (sp.get('tel')) params.set('tel', sp.get('tel')!);
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v as string);
    params.set('page', String(p));
    router.push(`/call-center?${params.toString()}#list`);
  }

  return (
    <div id="list" className="space-y-4 scroll-mt-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-semibold">Leads</h2>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString('es-ES')} resultados · página {page} de {totalPages}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters((s) => !s)}
            className={showFilters ? 'bg-ymc-red hover:bg-ymc-redDark text-white' : ''}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filtros
            {activeFiltersCount > 0 && (
              <span className="ml-1.5 bg-white text-ymc-red text-[10px] font-bold rounded-full h-4 min-w-4 px-1 inline-flex items-center justify-center">
                {activeFiltersCount}
              </span>
            )}
          </Button>
          {activeFiltersCount > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {/* Búsqueda siempre visible */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters({ q: filters.q });
        }}
        className="relative"
      >
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="Buscar por nombre, email, teléfono, modelo, formulario…"
          className="pl-9"
        />
      </form>

      {/* Filtros avanzados */}
      {showFilters && (
        <Card>
          <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <FilterField label="Origen">
              <select
                value={filters.origen}
                onChange={(e) => applyFilters({ origen: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                {origens.map((o) => (
                  <option key={o} value={o}>
                    {ORIGIN_LABEL[o as LeadOrigin]}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Estado">
              <select
                value={filters.status}
                onChange={(e) => applyFilters({ status: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABEL[s as LeadStatus]}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Formulario contiene">
              <Input
                value={filters.formulario}
                onChange={(e) => setFilters((f) => ({ ...f, formulario: e.target.value }))}
                onBlur={() => applyFilters({ formulario: filters.formulario })}
                placeholder="Ej: Prueba, Navidad…"
              />
            </FilterField>

            <FilterField label="Modelo contiene">
              <Input
                value={filters.modelo}
                onChange={(e) => setFilters((f) => ({ ...f, modelo: e.target.value }))}
                onBlur={() => applyFilters({ modelo: filters.modelo })}
                placeholder="Ej: MT-07, TMAX…"
              />
            </FilterField>

            <FilterField label="Entrada desde">
              <Input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => applyFilters({ dateFrom: e.target.value })}
              />
            </FilterField>

            <FilterField label="Entrada hasta">
              <Input
                type="date"
                value={filters.dateTo}
                onChange={(e) => applyFilters({ dateTo: e.target.value })}
              />
            </FilterField>

            <FilterField label="¿Llamado?">
              <select
                value={filters.contactada}
                onChange={(e) => applyFilters({ contactada: e.target.value })}
                className="w-full border rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">Cualquiera</option>
                <option value="yes">Sí, alguna vez</option>
                <option value="no">Nunca</option>
              </select>
            </FilterField>
          </CardContent>
        </Card>
      )}

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr className="text-xs uppercase text-muted-foreground">
                  <th className="text-left font-medium px-4 py-2">Fecha entrada</th>
                  <th className="text-left font-medium px-4 py-2">Nombre</th>
                  <th className="text-left font-medium px-4 py-2">Teléfono</th>
                  <th className="text-left font-medium px-4 py-2">Modelo</th>
                  <th className="text-left font-medium px-4 py-2">Origen</th>
                  <th className="text-left font-medium px-4 py-2">Estado</th>
                  <th className="text-right font-medium px-4 py-2">Llamadas</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr
                    key={l.id}
                    className="border-b hover:bg-ymc-redLight/40 transition-colors cursor-pointer"
                    onClick={() => router.push(`/leads/${l.id}`)}
                  >
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {format(new Date(l.fecha_entrada), "d MMM yy · HH:mm", { locale: es })}
                    </td>
                    <td className="px-4 py-2 font-medium truncate max-w-[200px]">
                      {l.nombre}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{l.telefono || '—'}</td>
                    <td className="px-4 py-2 truncate max-w-[140px]">{l.modelo_raw || '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {ORIGIN_LABEL[l.origen as LeadOrigin]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={`h-2 w-2 rounded-full ${LEAD_STATUS_COLOR[l.status as LeadStatus]}`}
                        />
                        {LEAD_STATUS_LABEL[l.status as LeadStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {l.bq_total_attempts || 0}
                    </td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No hay resultados con estos filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y">
            {leads.map((l) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="block px-4 py-3 hover:bg-ymc-redLight/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{l.nombre}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {l.telefono || '—'}{l.modelo_raw && ` · ${l.modelo_raw}`}
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {ORIGIN_LABEL[l.origen as LeadOrigin]}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <span
                          className={`h-2 w-2 rounded-full ${LEAD_STATUS_COLOR[l.status as LeadStatus]}`}
                        />
                        {LEAD_STATUS_LABEL[l.status as LeadStatus]}
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    {format(new Date(l.fecha_entrada), "d MMM", { locale: es })}
                    {l.bq_total_attempts > 0 && (
                      <div className="mt-0.5">{l.bq_total_attempts} ☎</div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
            {leads.length === 0 && (
              <p className="text-center py-12 text-sm text-muted-foreground">
                No hay resultados.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Paginación */}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={goToPage} />
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  const pages = getPaginationPages(page, totalPages);
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap pt-4">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`e-${i}`} className="px-2 text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? 'default' : 'outline'}
            size="sm"
            onClick={() => onChange(p as number)}
            className={p === page ? 'bg-ymc-red hover:bg-ymc-redDark text-white' : ''}
          >
            {p}
          </Button>
        )
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function getPaginationPages(current: number, total: number): (number | '…')[] {
  const out: (number | '…')[] = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) out.push(i);
    return out;
  }
  out.push(1);
  if (current > 3) out.push('…');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) out.push(i);
  if (current < total - 2) out.push('…');
  out.push(total);
  return out;
}
