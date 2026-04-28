export type Period = 'today' | '7d' | '30d' | '90d' | 'month' | 'year' | 'custom';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
  month: 'Mes actual',
  year: 'Año',
  custom: 'Personalizado',
};

export const PERIOD_ORDER: Period[] = [
  'today',
  '7d',
  '30d',
  '90d',
  'month',
  'year',
];

/**
 * Resuelve un período en un rango [from, to). `to` es exclusivo.
 * Para "today" devuelve [00:00 hoy, 00:00 mañana).
 * Para "custom" requiere from/to explícitos vía customFrom/customTo.
 */
export function resolvePeriod(
  period: Period,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null }
): { from: Date; to: Date } {
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
    case '90d': {
      const from = new Date(startOfDay);
      from.setDate(from.getDate() - 90);
      return { from, to: tomorrow };
    }
    case 'month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: tomorrow };
    case 'year':
      return { from: new Date(now.getFullYear(), 0, 1), to: tomorrow };
    case 'custom': {
      const from = custom?.from
        ? new Date(custom.from + 'T00:00:00')
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const to = custom?.to
        ? (() => {
            const d = new Date(custom.to + 'T00:00:00');
            d.setDate(d.getDate() + 1); // exclusivo: incluir el día seleccionado
            return d;
          })()
        : tomorrow;
      return { from, to };
    }
  }
}

/**
 * Período anterior equivalente — para comparativas. Mismo número de días.
 */
export function previousPeriod(
  period: Period,
  now: Date = new Date(),
  custom?: { from?: string | null; to?: string | null }
): { from: Date; to: Date } {
  const cur = resolvePeriod(period, now, custom);
  const ms = cur.to.getTime() - cur.from.getTime();
  const to = new Date(cur.from);
  const from = new Date(cur.from.getTime() - ms);
  return { from, to };
}
