'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ArrowDown, ArrowUp, Minus, CalendarRange } from 'lucide-react';
import { PERIOD_LABEL, PERIOD_ORDER, type Period } from '@/lib/period';

export function PeriodSelector({
  value,
  customFrom,
  customTo,
}: {
  value: Period;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [showCustom, setShowCustom] = useState(value === 'custom');
  const [from, setFrom] = useState(customFrom || '');
  const [to, setTo] = useState(customTo || '');

  function set(p: Period) {
    const next = new URLSearchParams(params.toString());
    next.set('period', p);
    if (p !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    router.push(`${pathname}?${next.toString()}`);
    router.refresh();
  }

  function applyCustom() {
    if (!from || !to) return;
    const next = new URLSearchParams(params.toString());
    next.set('period', 'custom');
    next.set('from', from);
    next.set('to', to);
    router.push(`${pathname}?${next.toString()}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="inline-flex items-center rounded-md border bg-white p-0.5 text-sm overflow-x-auto max-w-full">
        {PERIOD_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set(p)}
            className={`px-3 py-1.5 rounded-sm whitespace-nowrap transition-colors ${
              value === p
                ? 'bg-ymc-red text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((s) => !s)}
          className={`px-3 py-1.5 rounded-sm whitespace-nowrap transition-colors inline-flex items-center gap-1 ${
            value === 'custom'
              ? 'bg-ymc-red text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          {value === 'custom' && customFrom && customTo ? (
            <span className="font-mono text-xs">
              {customFrom} → {customTo}
            </span>
          ) : (
            <span>Personalizar</span>
          )}
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-2 bg-white border rounded-md p-2 shadow-sm">
          <label className="text-xs text-muted-foreground">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-7 rounded border px-2 text-xs"
          />
          <label className="text-xs text-muted-foreground">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-7 rounded border px-2 text-xs"
          />
          <button
            type="button"
            onClick={applyCustom}
            disabled={!from || !to}
            className="rounded bg-ymc-red px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}

export function DeltaBadge({
  current,
  previous,
  formatter = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 }),
}: {
  current: number;
  previous: number;
  formatter?: (n: number) => string;
}) {
  if (previous === 0 && current === 0) {
    return <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5"><Minus className="h-3 w-3" /> 0%</span>;
  }
  if (previous === 0) {
    return <span className="text-xs text-green-600 inline-flex items-center gap-0.5"><ArrowUp className="h-3 w-3" /> nuevo</span>;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.05) {
    return <span className="text-xs text-muted-foreground inline-flex items-center gap-0.5"><Minus className="h-3 w-3" /> 0%</span>;
  }
  const positive = pct > 0;
  return (
    <span
      className={`text-xs inline-flex items-center gap-0.5 ${
        positive ? 'text-green-600' : 'text-red-600'
      }`}
      title={`Anterior: ${formatter(previous)}`}
    >
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {formatter(Math.abs(pct))}%
    </span>
  );
}

export function KPICard({
  icon,
  label,
  value,
  sub,
  delta,
  color,
  href,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
  color?: 'red' | 'amber' | 'green' | 'sky' | 'default';
  href?: string;
}) {
  const valueCls =
    color === 'red'
      ? 'text-ymc-red'
      : color === 'amber'
      ? 'text-amber-600'
      : color === 'green'
      ? 'text-green-600'
      : color === 'sky'
      ? 'text-sky-600'
      : '';

  const inner = (
    <div className="rounded-lg border bg-white p-4 h-full flex flex-col">
      <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 font-display text-2xl md:text-3xl font-bold ${valueCls}`}>{value}</div>
      <div className="mt-auto pt-1 flex items-center justify-between gap-2">
        {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : <span />}
        {delta}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:opacity-90 transition">
        {inner}
      </Link>
    );
  }
  return inner;
}
