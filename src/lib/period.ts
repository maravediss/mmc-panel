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
