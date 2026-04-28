'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

export type Period = 'today' | '7d' | '30d' | 'month' | 'quarter' | 'year';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  month: 'Mes',
  quarter: 'Trimestre',
  year: 'Año',
};

export const PERIOD_ORDER: Period[] = ['today', '7d', '30d', 'month', 'quarter', 'year'];

/**
 * Resuelve un período en un rango [from, to). `to` es exclusivo.
 * Para "today" devuelve [00:00 hoy, 00:00 mañana).
 */
export function resolvePeriod(period: Period, now: Date = new Date()): { from: Date; to: Date } {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(startOfDay);
  tomorrow.setDate(tomorrow.getDate() + 1);

  switch (period) {
    case 'today':
      return { from: startOfDay, to: tomorrow };
    case '7d': {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 7);
      return { from, to: tomorrow };
    }
    case '30d': {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 30);
      return { from, to: tomorrow };
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      return { from: new Date(now.getFullYear(), q * 3, 1), to: tomorrow };
    }
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: tomorrow };
  }
}

/**
 * Período anterior equivalente — para comparativas. Mismo número de días.
 */
export function previousPeriod(period: Period, now: Date = new Date()): { from: Date; to: Date } {
  const cur = resolvePeriod(period, now);
  const ms = cur.to.getTime() - cur.from.getTime();
  const to = new Date(cur.from);
  const from = new Date(cur.from.getTime() - ms);
  return { from, to };
}

export function PeriodSelector({ value }: { value: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(p: Period) {
    const next = new URLSearchParams(params.toString());
    next.set('period', p);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
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
