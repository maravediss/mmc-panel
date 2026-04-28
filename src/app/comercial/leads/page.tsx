import { redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Users, ChevronRight, Phone, Mail, Bike, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, ORIGIN_LABEL } from '@/lib/mappings';

export const dynamic = 'force-dynamic';

export default async function ComercialLeadsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; commercial?: string };
}) {
  const me = await getCurrentCommercial();
  if (!me) redirect('/login');
  if (me.role === 'operadora') redirect('/operator');

  const isManager = me.role === 'admin' || me.role === 'gerente';
  const supabase = createClient();

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

  // Mis leads = leads que tienen al menos una cita conmigo
  // Usamos appointments para obtener los lead_ids únicos del comercial
  const { data: apptLeads } = await supabase
    .from('mmc_appointments')
    .select('lead_id')
    .eq('commercial_id', targetId);

  const leadIds = Array.from(
    new Set((apptLeads ?? []).map((r: any) => r.lead_id).filter(Boolean))
  );

  let leads: any[] = [];
  if (leadIds.length > 0) {
    let q = supabase
      .from('mmc_v_lead_with_model')
      .select('*')
      .in('id', leadIds)
      .order('updated_at', { ascending: false })
      .limit(300);

    if (searchParams.status && searchParams.status !== 'all') {
      q = q.eq('status', searchParams.status);
    }
    if (searchParams.q) {
      const term = searchParams.q.trim();
      q = q.or(`nombre.ilike.%${term}%,telefono.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data } = await q;
    leads = (data ?? []) as any[];
  }

  const baseQs = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (targetId !== me.id) sp.set('commercial', targetId);
    Object.entries(extra).forEach(([k, v]) => v && sp.set(k, v));
    return sp.toString();
  };

  const q = (searchParams.q || '').trim();
  const status = searchParams.status || 'all';

  const STATUS_CHIPS: { key: string; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'appointment', label: 'Con cita' },
    { key: 'attended', label: 'Acudió' },
    { key: 'sold', label: 'Vendidos' },
    { key: 'lost', label: 'Perdidos' },
  ];

  return (
    <AppShell commercial={me}>
      <header className="mb-5">
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6 text-ymc-red" /> Mis leads
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {targetName} · {leads.length} resultado{leads.length === 1 ? '' : 's'}
          {leadIds.length > leads.length && ` de ${leadIds.length} totales`}
        </p>
      </header>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_CHIPS.map((s) => {
          const active = status === s.key;
          return (
            <Link
              key={s.key}
              href={`/comercial/leads?${baseQs({
                status: s.key === 'all' ? '' : s.key,
                q,
              })}`}
              className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                active
                  ? 'bg-ymc-red text-white border-ymc-red'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-ymc-red'
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      <form className="flex flex-wrap gap-2 mb-5" action="/comercial/leads" method="get">
        {targetId !== me.id && <input type="hidden" name="commercial" value={targetId} />}
        {status !== 'all' && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, teléfono, email…"
          className="flex-1 min-w-[200px] rounded-md border bg-white px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-ymc-red px-3 py-1.5 text-sm font-medium text-white hover:bg-ymc-redDark"
        >
          Buscar
        </button>
        {q && (
          <Link
            href={`/comercial/leads?${baseQs({ status: status === 'all' ? '' : status })}`}
            className="rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpiar
          </Link>
        )}
      </form>

      {leads.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {leadIds.length === 0
              ? 'Aún no tienes leads asignados con cita.'
              : 'No hay leads que coincidan con los filtros aplicados.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <LeadRow key={l.id} l={l} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function LeadRow({ l }: { l: any }) {
  return (
    <Link
      href={`/leads/${l.id}`}
      className="block rounded-md border bg-white p-3.5 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{l.nombre}</span>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  LEAD_STATUS_COLOR[l.status as keyof typeof LEAD_STATUS_COLOR]
                }`}
              />
              {LEAD_STATUS_LABEL[l.status as keyof typeof LEAD_STATUS_LABEL]}
            </span>
            {l.origen && (
              <Badge variant="secondary" className="text-[10px]">
                {ORIGIN_LABEL[l.origen as keyof typeof ORIGIN_LABEL] || l.origen}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(l.fecha_entrada), 'd MMM yyyy', { locale: es })}
            </span>
            {l.telefono && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {l.telefono}
              </span>
            )}
            {l.email && (
              <span className="inline-flex items-center gap-1 truncate max-w-[180px]">
                <Mail className="h-3 w-3" />
                <span className="truncate">{l.email}</span>
              </span>
            )}
            {(l.modelo_oficial || l.modelo_raw) && (
              <span className="inline-flex items-center gap-1">
                <Bike className="h-3 w-3" />
                <strong className="text-foreground">{l.modelo_oficial || l.modelo_raw}</strong>
              </span>
            )}
            {l.margen_estimado != null && (
              <span className="inline-flex items-center gap-1 text-foreground font-medium">
                · {(Number(l.margen_estimado) || 0).toLocaleString('es-ES', {
                  maximumFractionDigits: 0,
                })}{' '}
                €
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
      </div>
    </Link>
  );
}
