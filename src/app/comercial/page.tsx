import { redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Calendar,
  CheckCircle2,
  XCircle,
  Euro,
  TrendingUp,
  Target,
  Trophy,
  Flame,
  Clock,
  ChevronRight,
  AlertTriangle,
  Bike,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  KPICard,
  PeriodSelector,
  DeltaBadge,
  resolvePeriod,
  previousPeriod,
  type Period,
  PERIOD_LABEL,
} from '@/components/KPISet';
import { APPT_TYPE_LABEL } from '@/lib/mappings';
import CommercialSelector from '@/components/CommercialSelector';

export const dynamic = 'force-dynamic';

const VALID_PERIODS: Period[] = ['today', '7d', '30d', 'month', 'quarter', 'year'];

function eur(n: number | null | undefined) {
  return `${(Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`;
}

export default async function ComercialDashboardPage({
  searchParams,
}: {
  searchParams: { period?: string; commercial?: string };
}) {
  const me = await getCurrentCommercial();
  if (!me) redirect('/login');
  if (me.role === 'operadora') redirect('/operator');

  const isManager = me.role === 'admin' || me.role === 'gerente';
  const period: Period = VALID_PERIODS.includes(searchParams.period as Period)
    ? (searchParams.period as Period)
    : '30d';

  const supabase = createClient();

  // El gerente puede inspeccionar a otro comercial via ?commercial=ID
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

  // Listado completo de comerciales para el selector (solo manager)
  let allCommercials: { id: string; name: string; display_name: string | null }[] = [];
  if (isManager) {
    const { data } = await supabase
      .from('mmc_commercials')
      .select('id, name, display_name, role, is_active')
      .eq('is_active', true)
      .in('role', ['comercial', 'gerente', 'admin'])
      .order('name');
    allCommercials = (data ?? []) as any;
  }

  // Resolver rangos
  const cur = resolvePeriod(period);
  const prev = previousPeriod(period);

  // KPIs propios + KPIs media concesionario (sólo si manager o si quiere comparar)
  const [{ data: curRows }, { data: prevRows }, { data: nextAppts }, { data: pendingClose }] =
    await Promise.all([
      supabase.rpc('mmc_commercial_kpis', {
        p_commercial_id: targetId,
        p_from: cur.from.toISOString(),
        p_to: cur.to.toISOString(),
      }),
      supabase.rpc('mmc_commercial_kpis', {
        p_commercial_id: targetId,
        p_from: prev.from.toISOString(),
        p_to: prev.to.toISOString(),
      }),
      // Próximas 5 citas (futuras pending) para preview
      supabase
        .from('mmc_v_appointments_full')
        .select('*')
        .eq('commercial_id', targetId)
        .eq('status', 'pending')
        .gte('fecha_cita', new Date().toISOString())
        .order('fecha_cita', { ascending: true })
        .limit(5),
      // Citas pasadas sin cerrar
      supabase
        .from('mmc_v_appointments_full')
        .select('*')
        .eq('commercial_id', targetId)
        .eq('is_pending_overdue', true)
        .order('fecha_cita', { ascending: false })
        .limit(5),
    ]);

  const k = (curRows && curRows[0]) || ({} as any);
  const kPrev = (prevRows && prevRows[0]) || ({} as any);

  // Media del concesionario en este período (sólo si manager)
  let avg: { citas: number; ventas: number; margen: number; conversion: number } | null = null;
  if (isManager && allCommercials.length > 0) {
    const promises = allCommercials.map((c) =>
      supabase.rpc('mmc_commercial_kpis', {
        p_commercial_id: c.id,
        p_from: cur.from.toISOString(),
        p_to: cur.to.toISOString(),
      })
    );
    const results = await Promise.all(promises);
    const rows = results.map((r) => (r.data && r.data[0]) || {});
    const n = rows.length || 1;
    avg = {
      citas: rows.reduce((s, r: any) => s + (r.citas_asignadas || 0), 0) / n,
      ventas: rows.reduce((s, r: any) => s + (r.ventas_count || 0), 0) / n,
      margen: rows.reduce((s, r: any) => s + Number(r.ventas_margen_eur || 0), 0) / n,
      conversion:
        rows.reduce((s, r: any) => s + Number(r.conversion_pct || 0), 0) / n,
    };
  }

  return (
    <AppShell commercial={me}>
      {/* Header */}
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Mi panel comercial</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {targetName} · {PERIOD_LABEL[period]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && allCommercials.length > 1 && (
            <CommercialSelector commercials={allCommercials} value={targetId} />
          )}
          <PeriodSelector value={period} />
        </div>
      </header>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
        <KPICard
          icon={<Calendar className="h-4 w-4" />}
          label="Citas asignadas"
          value={k.citas_asignadas ?? 0}
          sub={
            <span>
              <CheckCircle2 className="h-3 w-3 inline mr-1 text-green-600" />
              {k.citas_atendidas ?? 0} acude · {k.citas_no_show ?? 0}{' '}
              <XCircle className="h-3 w-3 inline -mt-0.5 text-red-600" />
            </span>
          }
          delta={
            <DeltaBadge current={k.citas_asignadas ?? 0} previous={kPrev.citas_asignadas ?? 0} />
          }
          href={`/comercial/citas?period=${period}${
            targetId !== me.id ? `&commercial=${targetId}` : ''
          }`}
        />
        <KPICard
          icon={<Target className="h-4 w-4" />}
          label="% asistencia"
          value={`${(k.asistencia_pct ?? 0).toFixed(0)}%`}
          sub={`${k.citas_atendidas ?? 0} de ${k.citas_asignadas ?? 0}`}
          color="sky"
        />
        <KPICard
          icon={<Trophy className="h-4 w-4" />}
          label="Ventas"
          value={k.ventas_count ?? 0}
          sub={
            <span>
              Conversión <strong>{(k.conversion_pct ?? 0).toFixed(0)}%</strong>
            </span>
          }
          delta={<DeltaBadge current={k.ventas_count ?? 0} previous={kPrev.ventas_count ?? 0} />}
          color="green"
        />
        <KPICard
          icon={<Euro className="h-4 w-4" />}
          label="Margen total"
          value={eur(k.ventas_margen_eur)}
          sub={`Ticket medio ${eur(k.ticket_medio_eur)}`}
          delta={
            <DeltaBadge
              current={Number(k.ventas_margen_eur || 0)}
              previous={Number(kPrev.ventas_margen_eur || 0)}
            />
          }
          color="green"
        />
      </div>

      {/* KPIs secundarios + comparativa */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6">
        <KPICard
          icon={<Flame className="h-4 w-4" />}
          label="Pipeline activo"
          value={k.pipeline_leads ?? 0}
          sub={`Margen est. ${eur(k.pipeline_margen_eur)}`}
          color="red"
        />
        <KPICard
          icon={<Bike className="h-4 w-4" />}
          label="Modelo top vendido"
          value={k.modelo_top_vendido ?? '—'}
          sub={
            k.modelo_top_demandado
              ? `Más demandado: ${k.modelo_top_demandado}`
              : 'Sin datos suficientes'
          }
        />
        <KPICard
          icon={<Clock className="h-4 w-4" />}
          label="Tiempo medio cierre"
          value={`${(k.tiempo_medio_cierre_dias ?? 0).toFixed(1)} d`}
          sub="Cita → fecha de compra"
        />
      </div>

      {/* Comparativa con la media */}
      {avg && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-ymc-red" />
              Yo vs media del concesionario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Comparison label="Citas" mine={k.citas_asignadas ?? 0} avg={avg.citas} />
              <Comparison label="Ventas" mine={k.ventas_count ?? 0} avg={avg.ventas} />
              <Comparison
                label="Margen €"
                mine={Number(k.ventas_margen_eur || 0)}
                avg={avg.margen}
                fmt={(n) => eur(n)}
              />
              <Comparison
                label="Conversión %"
                mine={Number(k.conversion_pct || 0)}
                avg={avg.conversion}
                fmt={(n) => `${n.toFixed(1)}%`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Citas próximas + Pendientes de cerrar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-ymc-red" />
              Próximas citas
              <span className="text-sm text-muted-foreground font-sans font-normal">
                ({(nextAppts ?? []).length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(nextAppts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">Sin citas próximas.</p>
            ) : (
              (nextAppts ?? []).map((a: any) => <ApptRow key={a.id} a={a} />)
            )}
            <div className="pt-2">
              <Link
                href={`/comercial/citas?period=${period}${
                  targetId !== me.id ? `&commercial=${targetId}` : ''
                }`}
                className="text-sm font-medium text-ymc-red inline-flex items-center hover:gap-1.5 transition-all"
              >
                Ver todas mis citas
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className={(pendingClose ?? []).length > 0 ? 'border-amber-200 bg-amber-50/30' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Citas sin cerrar
              <span className="text-sm text-muted-foreground font-sans font-normal">
                ({(pendingClose ?? []).length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(pendingClose ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">
                Ninguna cita pasada sin cerrar. ¡Buen trabajo!
              </p>
            ) : (
              (pendingClose ?? []).map((a: any) => <ApptRow key={a.id} a={a} overdue />)
            )}
            {(pendingClose ?? []).length > 0 && (
              <div className="pt-2">
                <Link
                  href={`/comercial/citas?status=pending_overdue${
                    targetId !== me.id ? `&commercial=${targetId}` : ''
                  }`}
                  className="text-sm font-medium text-amber-700 inline-flex items-center hover:gap-1.5 transition-all"
                >
                  Ver todas
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Comparison({
  label,
  mine,
  avg,
  fmt = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 }),
}: {
  label: string;
  mine: number;
  avg: number;
  fmt?: (n: number) => string;
}) {
  const diffPct = avg === 0 ? 0 : ((mine - avg) / Math.abs(avg)) * 100;
  const positive = diffPct > 0.5;
  const negative = diffPct < -0.5;
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{fmt(mine)}</div>
      <div className="text-xs text-muted-foreground mt-0.5">
        Media {fmt(avg)} ·{' '}
        <span
          className={
            positive
              ? 'text-green-600 font-medium'
              : negative
              ? 'text-red-600 font-medium'
              : ''
          }
        >
          {diffPct > 0 ? '+' : ''}
          {diffPct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function ApptRow({ a, overdue }: { a: any; overdue?: boolean }) {
  const d = new Date(a.fecha_cita);
  return (
    <Link
      href={`/comercial/citas/${a.id}/cerrar`}
      className={`block rounded-md border p-3 hover:shadow-sm transition ${
        overdue ? 'bg-white border-amber-200' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium truncate">{a.lead_nombre}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3 inline mr-1" />
            {format(d, "d MMM · HH:mm", { locale: es })}{' '}
            <Badge variant="secondary" className="text-[10px] ml-0.5">
              {APPT_TYPE_LABEL[a.tipo as keyof typeof APPT_TYPE_LABEL]}
            </Badge>
            {a.modelo_oficial && ` · ${a.modelo_oficial}`}
            {a.margen_estimado && (
              <>
                {' · '}
                <span className="font-medium">{eur(a.margen_estimado)}</span>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

