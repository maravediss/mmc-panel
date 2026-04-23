import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowLeft,
  Phone,
  Mail,
  Calendar,
  Clock,
  User,
  Bike,
  Headphones,
  CheckCircle2,
  XCircle,
  TrendingUp,
  MessageSquare,
  Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ORIGIN_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, APPT_TYPE_LABEL, APPT_STATUS_LABEL, APPT_STATUS_COLOR } from '@/lib/mappings';
import { QCODE_TYPE_LABEL, QCODE_TYPE_COLOR } from '@/lib/call-mappings';
import type { LeadOrigin, LeadStatus, AppointmentType, AppointmentStatus } from '@/lib/types';

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  const supabase = createClient();

  const { data: lead } = await supabase
    .from('mmc_leads')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!lead) notFound();

  // FK dropped by CASCADE in schema_v5 — fetch model separately
  let modelo: { id: string; name: string; family: string; cc: number | null } | null = null;
  if (lead.modelo_id) {
    const { data: m } = await supabase
      .from('mmc_models')
      .select('id, name, family, cc')
      .eq('id', lead.modelo_id)
      .maybeSingle();
    modelo = m ?? null;
  }

  // Margen estimado del modelo (si se vendiera hoy)
  let margenEstimado: number | null = null;
  if (lead.modelo_id) {
    const { data: margenRow } = await supabase
      .from('mmc_model_margins')
      .select('margin_eur, year')
      .eq('model_id', lead.modelo_id)
      .order('year', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (margenRow) margenEstimado = Number(margenRow.margin_eur);
  }

  const { data: calls } = await supabase
    .from('mmc_calls')
    .select('*')
    .eq('lead_id', params.id)
    .order('call_at', { ascending: false });

  const { data: appointments } = await supabase
    .from('mmc_appointments')
    .select('*, commercial:mmc_commercials(name)')
    .eq('lead_id', params.id)
    .order('fecha_cita', { ascending: false });

  const { data: sales } = await supabase
    .from('mmc_sales')
    .select('*, commercial:mmc_commercials(name)')
    .eq('lead_id', params.id);

  const { data: reports } = await supabase
    .from('mmc_operator_reports')
    .select('*, operator:mmc_commercials!mmc_operator_reports_operator_id_fkey(name)')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false });

  const callsList = calls ?? [];
  const apptsList = appointments ?? [];
  const salesList = sales ?? [];
  const reportsList = reports ?? [];

  const answered = callsList.filter((c: any) => (c.talk_time_s || 0) > 0).length;

  return (
    <AppShell commercial={commercial}>
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      {/* Header del lead */}
      <Card className="mb-6 border-l-4 border-l-ymc-red">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
            <div>
              <h1 className="font-display text-2xl font-bold">{lead.nombre}</h1>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="font-mono">
                  {ORIGIN_LABEL[lead.origen as LeadOrigin]}
                </Badge>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className={`h-2 w-2 rounded-full ${LEAD_STATUS_COLOR[lead.status as LeadStatus]}`} />
                  {LEAD_STATUS_LABEL[lead.status as LeadStatus]}
                </span>
                <span className="text-xs text-muted-foreground">
                  · lead desde {format(new Date(lead.fecha_entrada), "d MMM yyyy", { locale: es })}
                </span>
              </div>
            </div>
            <div className="text-right">
              {(modelo?.name || lead.modelo_raw) && (
                <div className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Bike className="h-4 w-4 text-ymc-red" />
                  {modelo?.name || lead.modelo_raw}
                </div>
              )}
              {modelo?.name && lead.modelo_raw && modelo.name !== lead.modelo_raw && (
                <div className="text-[10px] text-muted-foreground italic mt-0.5">
                  forma: "{lead.modelo_raw}"
                </div>
              )}
              {margenEstimado != null && (
                <div className="text-xs text-ymc-red font-medium mt-1">
                  Margen est. {margenEstimado.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €
                </div>
              )}
              {lead.formulario && (
                <div className="text-xs text-muted-foreground mt-1">
                  via {lead.formulario}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {lead.telefono && (
              <a href={`tel:${lead.telefono}`} className="inline-flex items-center gap-2 hover:underline">
                <Phone className="h-4 w-4 text-ymc-red" />
                <span className="font-medium">{lead.telefono}</span>
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-2 hover:underline">
                <Mail className="h-4 w-4 text-ymc-red" />
                <span className="truncate">{lead.email}</span>
              </a>
            )}
            {lead.mensajes_preferencias && (
              <div className="md:col-span-2 text-muted-foreground inline-flex items-start gap-2">
                <MessageSquare className="h-4 w-4 text-ymc-red mt-0.5 shrink-0" />
                <em>"{lead.mensajes_preferencias}"</em>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Métricas resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          icon={<Headphones className="h-5 w-5" />}
          label="Llamadas"
          value={lead.bq_total_attempts ?? callsList.length}
        />
        <MetricCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Contestadas"
          value={answered}
        />
        <MetricCard
          icon={<Calendar className="h-5 w-5" />}
          label="Citas"
          value={apptsList.length}
        />
        <MetricCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Ventas"
          value={salesList.length}
          accent={salesList.length > 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Columna principal */}
        <div className="lg:col-span-3 space-y-6">
          {/* Timeline de llamadas */}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Headphones className="h-5 w-5 text-ymc-red" />
                Histórico de llamadas
                <span className="text-sm text-muted-foreground font-sans">({callsList.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {callsList.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No hay llamadas registradas.</p>
              ) : (
                <ol className="relative border-l-2 border-slate-200 pl-6 ml-2 space-y-4">
                  {callsList.map((c: any) => (
                    <li key={c.id} className="relative">
                      <span className="absolute -left-[33px] top-1 h-3 w-3 rounded-full bg-ymc-red ring-4 ring-white" />
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="text-sm font-medium">
                            {format(new Date(c.call_at), "EEEE d 'de' MMMM · HH:mm", { locale: es })}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {c.agent_name ?? '—'}
                            {c.talk_time_s > 0 && ` · ${formatDuration(c.talk_time_s)}`}
                            {c.hangup_type && ` · colgó ${c.hangup_type === 'Agent' ? 'operadora' : 'cliente'}`}
                          </div>
                        </div>
                        {c.qcode_type && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded-md border ${
                              QCODE_TYPE_COLOR[c.qcode_type] || 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            {c.qcode_description || QCODE_TYPE_LABEL[c.qcode_type] || c.qcode_type}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Reportes de operadora */}
          {reportsList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-ymc-red" />
                  Reportes de operadora
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {reportsList.map((r: any) => (
                  <div key={r.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-medium">{r.operator?.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(r.created_at), "d MMM · HH:mm", { locale: es })}
                      </span>
                    </div>
                    <div className="mt-1">
                      <Badge variant="secondary">{r.call_result}</Badge>
                    </div>
                    {r.observaciones && (
                      <p className="text-muted-foreground mt-2 italic">{r.observaciones}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Columna lateral */}
        <div className="lg:col-span-2 space-y-6">
          {/* Citas */}
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5 text-ymc-red" />
                Citas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {apptsList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay citas.</p>
              ) : (
                apptsList.map((a: any) => (
                  <Link
                    key={a.id}
                    href={`/appointments/${a.id}/close`}
                    className="block rounded-md border p-3 text-sm hover:shadow-sm transition"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Badge variant="secondary">
                        {APPT_TYPE_LABEL[a.tipo as AppointmentType]}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span className={`h-2 w-2 rounded-full ${APPT_STATUS_COLOR[a.status as AppointmentStatus]}`} />
                        {APPT_STATUS_LABEL[a.status as AppointmentStatus]}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {format(new Date(a.fecha_cita), "d MMM 'a las' HH:mm", { locale: es })}
                    </div>
                    {a.commercial && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        <User className="h-3 w-3 inline" /> {a.commercial.name}
                      </div>
                    )}
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Ventas */}
          {salesList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Ventas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {salesList.map((s: any) => (
                  <div key={s.id} className="rounded-md border bg-green-50 p-3 text-sm">
                    <div className="font-medium">{s.model_raw ?? '—'}</div>
                    <div className="text-muted-foreground text-xs">
                      {format(new Date(s.fecha_compra), "d MMM yyyy", { locale: es })}
                      {s.margen_eur && ` · ${Number(s.margen_eur).toFixed(0)} €`}
                      {s.commercial && ` · ${s.commercial.name}`}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Datos Presence */}
          {(lead.bq_total_attempts || lead.bq_last_agent) && (
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <Tag className="h-5 w-5 text-ymc-red" />
                  Datos Presence
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1.5">
                {lead.bq_total_attempts != null && (
                  <Row label="Intentos totales" value={String(lead.bq_total_attempts)} />
                )}
                {lead.bq_no_answer_counter != null && (
                  <Row label="Sin respuesta" value={String(lead.bq_no_answer_counter)} />
                )}
                {lead.bq_busy_counter != null && (
                  <Row label="Comunicando" value={String(lead.bq_busy_counter)} />
                )}
                {lead.bq_last_agent && <Row label="Última operadora" value={lead.bq_last_agent} />}
                {lead.bq_last_qcode && <Row label="Último QCODE" value={lead.bq_last_qcode} />}
                {lead.bq_optn_resultado && (
                  <Row label="Resultado argumentario" value={lead.bq_optn_resultado} />
                )}
                {lead.bq_last_call_at && (
                  <Row
                    label="Última llamada"
                    value={format(new Date(lead.bq_last_call_at), "d MMM · HH:mm", { locale: es })}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-4 ${
        accent ? 'border-green-200 bg-green-50' : ''
      }`}
    >
      <div className={`inline-flex items-center gap-2 text-xs text-muted-foreground ${accent ? 'text-green-700' : ''}`}>
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className={`mt-1 font-display text-2xl font-bold ${accent ? 'text-green-700' : ''}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function formatDuration(s: number): string {
  if (!s) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
