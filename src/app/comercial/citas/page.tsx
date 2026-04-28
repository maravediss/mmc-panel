import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Calendar, AlertTriangle, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import ApptItem from './ApptItem';

export const dynamic = 'force-dynamic';

type StatusFilter =
  | 'all'
  | 'today'
  | 'tomorrow'
  | 'upcoming'
  | 'pending_overdue'
  | 'attended'
  | 'no_show'
  | 'cancelled';

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'Todas',
  today: 'Hoy',
  tomorrow: 'Mañana',
  upcoming: 'Próximas',
  pending_overdue: 'Sin cerrar',
  attended: 'Asistieron',
  no_show: 'No asistieron',
  cancelled: 'Canceladas',
};

const STATUS_ORDER: StatusFilter[] = [
  'all',
  'today',
  'tomorrow',
  'upcoming',
  'pending_overdue',
  'attended',
  'no_show',
  'cancelled',
];

function eur(n: number | null | undefined) {
  return `${(Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
}

export default async function ComercialCitasPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    tipo?: string;
    q?: string;
    from?: string;
    to?: string;
    commercial?: string;
  };
}) {
  const me = await getCurrentCommercial();
  if (!me) redirect('/login');
  if (me.role === 'operadora') redirect('/operator');

  const isManager = me.role === 'admin' || me.role === 'gerente';
  const supabase = createClient();

  // Si manager, puede inspeccionar a otro comercial
  let targetId = me.id;
  let targetName = me.display_name || me.name;
  if (isManager && searchParams.commercial) {
    const { data: c } = await supabase
      .from('mmc_commercials')
      .select('id, name, display_name')
      .eq('id', searchParams.commercial)
      .maybeSingle();
    if (c) {
      targetId = c.id;
      targetName = c.display_name || c.name;
    }
  }

  const status: StatusFilter = (STATUS_ORDER as string[]).includes(
    searchParams.status || ''
  )
    ? (searchParams.status as StatusFilter)
    : 'all';
  const tipo = searchParams.tipo;
  const q = (searchParams.q || '').trim();
  const fromParam = searchParams.from;
  const toParam = searchParams.to;

  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow0 = new Date(today0);
  tomorrow0.setDate(tomorrow0.getDate() + 1);
  const dayAfter0 = new Date(tomorrow0);
  dayAfter0.setDate(dayAfter0.getDate() + 1);

  let query = supabase
    .from('mmc_v_appointments_full')
    .select('*')
    .eq('commercial_id', targetId)
    .order('fecha_cita', { ascending: status === 'pending_overdue' ? false : true })
    .limit(300);

  switch (status) {
    case 'today':
      query = query
        .gte('fecha_cita', today0.toISOString())
        .lt('fecha_cita', tomorrow0.toISOString());
      break;
    case 'tomorrow':
      query = query
        .gte('fecha_cita', tomorrow0.toISOString())
        .lt('fecha_cita', dayAfter0.toISOString());
      break;
    case 'upcoming':
      query = query.gte('fecha_cita', now.toISOString()).eq('status', 'pending');
      break;
    case 'pending_overdue':
      query = query.eq('is_pending_overdue', true);
      break;
    case 'attended':
      query = query.eq('status', 'attended');
      break;
    case 'no_show':
      query = query.eq('status', 'no_show');
      break;
    case 'cancelled':
      query = query.eq('status', 'cancelled');
      break;
  }

  if (tipo && ['prueba_moto', 'concesionario', 'taller'].includes(tipo)) {
    query = query.eq('tipo', tipo);
  }
  if (q) {
    query = query.or(
      `lead_nombre.ilike.%${q}%,lead_telefono.ilike.%${q}%,lead_email.ilike.%${q}%`
    );
  }
  if (fromParam) query = query.gte('fecha_cita', fromParam);
  if (toParam) query = query.lt('fecha_cita', toParam);

  const { data: rows } = await query;
  const items = (rows ?? []) as any[];

  // Stats rápidos para los chips de la cabecera
  const [
    { count: cToday },
    { count: cTomorrow },
    { count: cUpcoming },
    { count: cOverdue },
  ] = await Promise.all([
    supabase
      .from('mmc_v_appointments_full')
      .select('*', { count: 'exact', head: true })
      .eq('commercial_id', targetId)
      .gte('fecha_cita', today0.toISOString())
      .lt('fecha_cita', tomorrow0.toISOString()),
    supabase
      .from('mmc_v_appointments_full')
      .select('*', { count: 'exact', head: true })
      .eq('commercial_id', targetId)
      .gte('fecha_cita', tomorrow0.toISOString())
      .lt('fecha_cita', dayAfter0.toISOString()),
    supabase
      .from('mmc_v_appointments_full')
      .select('*', { count: 'exact', head: true })
      .eq('commercial_id', targetId)
      .gte('fecha_cita', now.toISOString())
      .eq('status', 'pending'),
    supabase
      .from('mmc_v_appointments_full')
      .select('*', { count: 'exact', head: true })
      .eq('commercial_id', targetId)
      .eq('is_pending_overdue', true),
  ]);

  const counts: Partial<Record<StatusFilter, number>> = {
    today: cToday ?? 0,
    tomorrow: cTomorrow ?? 0,
    upcoming: cUpcoming ?? 0,
    pending_overdue: cOverdue ?? 0,
  };

  const baseQs = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (targetId !== me.id) sp.set('commercial', targetId);
    Object.entries(extra).forEach(([k, v]) => v && sp.set(k, v));
    return sp.toString();
  };

  return (
    <AppShell commercial={me}>
      <header className="mb-5">
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Calendar className="h-6 w-6 text-ymc-red" /> Mis citas
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {targetName} · {items.length} resultado{items.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* Banner alerta de citas sin cerrar */}
      {(cOverdue ?? 0) > 0 && status !== 'pending_overdue' && (
        <Link
          href={`/comercial/citas?${baseQs({ status: 'pending_overdue' })}`}
          className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">
              Tienes {cOverdue} cita{cOverdue === 1 ? '' : 's'} sin cerrar.
            </p>
            <p className="text-xs text-amber-700">
              Cerrarlas mantiene actualizado el reporte gerencial.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-amber-700 mt-1" />
        </Link>
      )}

      {/* Filtros: chips de status */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_ORDER.map((s) => {
          const active = status === s;
          const count = counts[s];
          return (
            <Link
              key={s}
              href={`/comercial/citas?${baseQs({
                status: s === 'all' ? '' : s,
                tipo: tipo || '',
                q,
              })}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                active
                  ? 'bg-ymc-red text-white border-ymc-red'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-ymc-red'
              }`}
            >
              {STATUS_LABEL[s]}
              {count !== undefined && (
                <span
                  className={`text-[10px] rounded-full px-1.5 ${
                    active ? 'bg-white/20' : 'bg-slate-100'
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Filtros: tipo + búsqueda */}
      <form className="flex flex-wrap gap-2 mb-5" action="/comercial/citas" method="get">
        {targetId !== me.id && <input type="hidden" name="commercial" value={targetId} />}
        {status !== 'all' && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, teléfono, email…"
          className="flex-1 min-w-[200px] rounded-md border bg-white px-3 py-1.5 text-sm"
        />
        <select
          name="tipo"
          defaultValue={tipo || ''}
          className="rounded-md border bg-white px-3 py-1.5 text-sm"
        >
          <option value="">Todos los tipos</option>
          <option value="prueba_moto">Prueba de moto</option>
          <option value="concesionario">Visita concesionario</option>
          <option value="taller">Cita de taller</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-ymc-red px-3 py-1.5 text-sm font-medium text-white hover:bg-ymc-redDark"
        >
          Aplicar
        </button>
        {(q || tipo) && (
          <Link
            href={`/comercial/citas?${baseQs({ status: status === 'all' ? '' : status })}`}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Listado */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No hay citas que coincidan con los filtros aplicados.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <ApptItem key={a.id} a={a} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
