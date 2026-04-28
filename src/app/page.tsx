import { redirect } from 'next/navigation';
import Link from 'next/link';
import { format, isToday, isTomorrow, isPast, subHours } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Calendar,
  Clock,
  Users,
  Headphones,
  BarChart3,
  Phone,
  PhoneMissed,
  TrendingUp,
  ChevronRight,
  Flame,
  Euro,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { APPT_TYPE_LABEL, APPT_STATUS_COLOR, APPT_STATUS_LABEL, ORIGIN_LABEL } from '@/lib/mappings';
import type { Commercial } from '@/lib/types';

export const dynamic = 'force-dynamic';

function greeting(): { hello: string; emoji: string } {
  const h = new Date().getHours();
  if (h < 6) return { hello: 'Buenas noches', emoji: '🌙' };
  if (h < 12) return { hello: 'Buenos días', emoji: '☀️' };
  if (h < 20) return { hello: 'Buenas tardes', emoji: '👋' };
  return { hello: 'Buenas noches', emoji: '🌙' };
}

export default async function HomePage() {
  const commercial = await getCurrentCommercial();
  if (!commercial) {
    return (
      <AppShell commercial={null}>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-lg font-medium">Tu usuario aún no está asociado a un comercial.</p>
            <p className="text-sm text-muted-foreground">
              Contacta con el administrador para completar el alta.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  // Operadoras van directamente a su panel, sin home
  if (commercial.role === 'operadora') {
    redirect('/operator');
  }

  const supabase = createClient();
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const last24h = subHours(now, 24).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const isManager = commercial.role === 'admin' || commercial.role === 'gerente';

  const [
    { count: leadsNew24h },
    { count: leadsAllTime },
    { count: calls24h },
    { count: pendingCalls },
    { count: apptsToday },
    { data: mySalesMonth },
    { data: mySales },
    { data: todayAppts },
    { data: stuckLeads },
    { data: hotLeads },
  ] = await Promise.all([
    supabase.from('mmc_leads').select('*', { count: 'exact', head: true }).gte('fecha_entrada', last24h),
    supabase.from('mmc_leads').select('*', { count: 'exact', head: true }),
    supabase.from('mmc_calls').select('*', { count: 'exact', head: true }).gte('call_at', last24h),
    supabase
      .from('mmc_leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .is('bq_last_call_at', null),
    supabase
      .from('mmc_appointments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('fecha_cita', today0)
      .lt('fecha_cita', new Date(Date.now() + 86400000).toISOString()),
    supabase
      .from('mmc_sales')
      .select('margen_eur, commercial_id')
      .gte('fecha_compra', monthStart.slice(0, 10)),
    supabase
      .from('mmc_sales')
      .select('margen_eur, fecha_compra')
      .eq('commercial_id', commercial.id)
      .gte('fecha_compra', monthStart.slice(0, 10)),
    supabase
      .from('mmc_appointments')
      .select(
        'id, tipo, fecha_cita, status, lead:mmc_leads!inner(id, nombre, modelo_raw, telefono), commercial:mmc_commercials(name)'
      )
      .eq('status', 'pending')
      .gte('fecha_cita', today0)
      .lt('fecha_cita', new Date(Date.now() + 86400000).toISOString())
      .order('fecha_cita', { ascending: true }),
    // Leads estancados: más de 48h sin llamar y sin cita
    supabase
      .from('mmc_leads')
      .select('id, nombre, modelo_raw, fecha_entrada, telefono, bq_total_attempts')
      .eq('status', 'new')
      .lt('fecha_entrada', subHours(now, 48).toISOString())
      .order('fecha_entrada', { ascending: false })
      .limit(5),
    // Leads "calientes": nuevos en últimas 24h
    supabase
      .from('mmc_leads')
      .select('id, nombre, modelo_raw, fecha_entrada, origen')
      .eq('status', 'new')
      .gte('fecha_entrada', last24h)
      .order('fecha_entrada', { ascending: false })
      .limit(5),
  ]);

  const mySalesCountMonth = (mySales ?? []).length;
  const mySalesMargenMonth = (mySales ?? []).reduce(
    (s: number, r: any) => s + (Number(r.margen_eur) || 0),
    0
  );
  const totalSalesMonth = (mySalesMonth ?? []).length;
  const totalMargenMonth = (mySalesMonth ?? []).reduce(
    (s: number, r: any) => s + (Number(r.margen_eur) || 0),
    0
  );

  const { hello, emoji } = greeting();
  const firstName = (commercial.display_name || commercial.name).split(' ')[0];

  return (
    <AppShell commercial={commercial}>
      {/* Saludo */}
      <header className="mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">
          {hello}, {firstName} <span className="font-sans">{emoji}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {format(now, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}
        </p>
      </header>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <QuickStat
          icon={<Users className="h-4 w-4" />}
          label="Leads nuevos 24h"
          value={leadsNew24h ?? 0}
          href="/leads"
          color="red"
        />
        <QuickStat
          icon={<Phone className="h-4 w-4" />}
          label="Llamadas 24h"
          value={calls24h ?? 0}
          href="/call-center"
        />
        <QuickStat
          icon={<Calendar className="h-4 w-4" />}
          label="Citas hoy"
          value={apptsToday ?? 0}
          href="/"
          color={(apptsToday ?? 0) > 0 ? 'amber' : 'default'}
        />
        {isManager ? (
          <QuickStat
            icon={<Euro className="h-4 w-4" />}
            label={`${format(now, 'MMM', { locale: es })} · ventas`}
            value={totalSalesMonth}
            sub={`${totalMargenMonth.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`}
            href="/dashboard"
            color="green"
          />
        ) : (
          <QuickStat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Tus ventas mes"
            value={mySalesCountMonth}
            sub={`${mySalesMargenMonth.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`}
            color="green"
          />
        )}
      </div>

      {/* Accesos rápidos al módulo principal según rol */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {(commercial.role === 'comercial' || isManager) && (
          <AccessCard
            icon={<Calendar className="h-6 w-6" />}
            title="Mi panel"
            description={
              (apptsToday ?? 0) > 0
                ? `Tienes ${apptsToday} cita${(apptsToday ?? 0) > 1 ? 's' : ''} hoy. KPIs, citas y cierre rápido.`
                : 'Tu panel personal: KPIs, citas y cierre.'
            }
            href="/comercial"
            cta="Abrir panel"
            accent={!isManager}
          />
        )}
        {isManager && (
          <AccessCard
            icon={<Headphones className="h-6 w-6" />}
            title="Call center"
            description={`${pendingCalls ?? 0} leads por llamar. Busca por teléfono cuando te salte en Presence.`}
            href="/call-center"
            cta="Abrir call center"
            accent
          />
        )}
        {isManager && (
          <>
            <AccessCard
              icon={<Users className="h-6 w-6" />}
              title="Base de leads"
              description={`${(leadsAllTime ?? 0).toLocaleString('es-ES')} leads totales. Búsqueda y filtros.`}
              href="/leads"
              cta="Ver listado"
            />
            <AccessCard
              icon={<BarChart3 className="h-6 w-6" />}
              title="Analítica"
              description="KPIs, embudo, ventas por comercial, rendimiento call center."
              href="/dashboard"
              cta="Abrir dashboard"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Citas hoy */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-ymc-red" />
              Citas hoy
              <span className="text-sm text-muted-foreground font-sans font-normal">
                ({(todayAppts ?? []).length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(todayAppts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">No hay citas para hoy.</p>
            ) : (
              (todayAppts ?? []).map((a: any) => (
                <Link
                  key={a.id}
                  href={`/comercial/citas/${a.id}/cerrar`}
                  className="block rounded-md border p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-medium">{a.lead?.nombre}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {format(new Date(a.fecha_cita), 'HH:mm', { locale: es })}
                        {' · '}
                        <Badge variant="secondary" className="text-[10px]">
                          {APPT_TYPE_LABEL[a.tipo as keyof typeof APPT_TYPE_LABEL]}
                        </Badge>
                        {a.lead?.modelo_raw && ` · ${a.lead.modelo_raw}`}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Leads calientes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Flame className="h-5 w-5 text-ymc-red" />
              Leads nuevos 24h
              <span className="text-sm text-muted-foreground font-sans font-normal">
                ({(hotLeads ?? []).length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(hotLeads ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">Ningún lead entrado en las últimas 24h.</p>
            ) : (
              (hotLeads ?? []).map((l: any) => (
                <Link
                  key={l.id}
                  href={`/leads/${l.id}`}
                  className="block rounded-md border p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{l.nombre}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(l.fecha_entrada), "HH:mm", { locale: es })} ·{' '}
                        <Badge variant="secondary" className="text-[10px]">
                          {ORIGIN_LABEL[l.origen as keyof typeof ORIGIN_LABEL]}
                        </Badge>
                        {l.modelo_raw && ` · ${l.modelo_raw}`}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Leads estancados */}
        {isManager && (stuckLeads ?? []).length > 0 && (
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Leads estancados (sin contactar +48h)
                <span className="text-sm text-muted-foreground font-sans font-normal">
                  ({(stuckLeads ?? []).length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(stuckLeads ?? []).map((l: any) => (
                <Link
                  key={l.id}
                  href={`/leads/${l.id}`}
                  className="block rounded-md border bg-white p-3 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{l.nombre}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Entró{' '}
                        {format(new Date(l.fecha_entrada), "d MMM · HH:mm", { locale: es })}
                        {l.modelo_raw && ` · ${l.modelo_raw}`}
                        {l.telefono && ` · ${l.telefono}`}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Consejo/Tip */}
        <Card className="border-ymc-redLight bg-gradient-to-br from-white to-ymc-redLight/40">
          <CardContent className="py-5">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-ymc-red shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display font-semibold mb-1">¿Sabías que…?</h3>
                <p className="text-sm text-muted-foreground">
                  Los datos del Google Sheet se sincronizan cada <strong>5 minutos</strong> y las
                  llamadas de Presence cada <strong>15 minutos</strong>. Si cierras una cita aquí,
                  la actualización queda registrada al instante y sustituye al Sheet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function QuickStat({
  icon,
  label,
  value,
  sub,
  href,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  href?: string;
  color?: 'red' | 'amber' | 'green' | 'default';
}) {
  const colorCls =
    color === 'red'
      ? 'text-ymc-red'
      : color === 'amber'
      ? 'text-amber-600'
      : color === 'green'
      ? 'text-green-600'
      : '';

  const content = (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground uppercase tracking-wide">
          {icon}
          <span className="hidden sm:inline">{label}</span>
          <span className="sm:hidden">{label.replace('Leads ', '').replace('Llamadas ', '')}</span>
        </div>
      </div>
      <div className={`mt-1 font-display text-2xl md:text-3xl font-bold ${colorCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:opacity-90 transition">
        {content}
      </Link>
    );
  }
  return content;
}

function AccessCard({
  icon,
  title,
  description,
  href,
  cta,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  cta: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group block rounded-lg border p-5 transition hover:shadow-md bg-white ${
        accent ? 'border-ymc-red/30 hover:border-ymc-red' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`h-12 w-12 rounded-lg flex items-center justify-center shrink-0 ${
            accent ? 'bg-ymc-red text-white' : 'bg-ymc-redLight text-ymc-red'
          }`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
          <div className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-ymc-red group-hover:gap-2 transition-all">
            {cta}
            <ChevronRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}
