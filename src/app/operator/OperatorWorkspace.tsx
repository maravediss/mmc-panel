'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Phone,
  Mail,
  Bike,
  History,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  ClipboardList,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ORIGIN_LABEL } from '@/lib/mappings';
import {
  CALL_RESULT_LABEL,
  NO_INTEREST_REASON_LABEL,
  isCitaResult,
  citaResultToApptType,
} from '@/lib/call-mappings';
import type { CallResult, LeadOrigin, NoInterestReason } from '@/lib/types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Report = { call_result: string; created_at: string };
type Lead = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  modelo_raw: string | null;
  origen: LeadOrigin;
  formulario: string | null;
  mensajes_preferencias: string | null;
  fecha_entrada: string;
  status: string;
  bq_total_attempts: number | null;
  bq_last_agent: string | null;
  bq_last_qcode: string | null;
  bq_last_call_at: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const NON_EFFECTIVE = new Set([
  'no_contactado',
  'no_contesta',
  'contacto_erroneo',
  'cuelga_al_identificarse',
]);

const CITA_RESULTS = new Set([
  'cita_taller',
  'cita_concesionario',
  'cita_prueba_moto',
]);

const ARGUMENTARIO_STEPS = [
  {
    step: 1,
    title: 'Apertura e identificación',
    script:
      'Buenos días/tardes, mi nombre es [tu nombre]. Le llamo de parte de Yamaha Málaga Center. ¿Hablo con [nombre del lead]?',
    tip: 'Si no contesta o cuelga, registra el resultado correspondiente.',
  },
  {
    step: 2,
    title: 'Confirmar interés',
    script:
      'Le llamamos porque nos ha dejado sus datos interesado/a en la [modelo]. ¿Sigue con ese interés en este momento?',
    tip: 'Si ya no tiene interés, pregunta el motivo antes de cerrar.',
  },
  {
    step: 3,
    title: 'Presentar propuesta',
    script:
      'Tenemos disponibilidad para una prueba de moto completamente gratuita en nuestro concesionario. Además, contamos con opciones de financiación muy competitivas y nuestro equipo puede asesorarle sin compromiso.',
    tip: 'Adapta el mensaje según el modelo: si es eléctrica, menciona autonomía; si es naked, menciona versatilidad.',
  },
  {
    step: 4,
    title: 'Proponer y concretar cita',
    script:
      '¿Cuándo tendría disponibilidad para pasarse por el concesionario? Puedo reservarle cita directamente con nuestro comercial Francisco. ¿Le va bien esta semana?',
    tip: 'Propón fechas concretas. Si quiere pensarlo, ofrece llamarle en unos días (QMI).',
  },
  {
    step: 5,
    title: 'Cierre y confirmación',
    script:
      'Perfecto, le reservo la cita para el [día] a las [hora] con [comercial]. Recibirá un email de confirmación. ¿Puede confirmarme su correo?',
    tip: 'Antes de colgar, anota el resultado y cualquier observación importante.',
  },
];

// ─── KPI helpers ─────────────────────────────────────────────────────────────

function computeKpis(reports: Report[]) {
  const total = reports.length;
  const effective = reports.filter((r) => !NON_EFFECTIVE.has(r.call_result)).length;
  const citas = reports.filter((r) => CITA_RESULTS.has(r.call_result)).length;
  const contactRate = total > 0 ? Math.round((effective / total) * 100) : 0;
  const conversion = effective > 0 ? Math.round((citas / effective) * 100) : 0;
  return { total, effective, citas, contactRate, conversion };
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const delta = current - previous;
  const pct = previous > 0 ? Math.round((delta / previous) * 100) : 100;
  if (delta > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-green-600 font-medium">
        <TrendingUp className="h-3 w-3" />+{pct}%
      </span>
    );
  if (delta < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-red-500 font-medium">
        <TrendingDown className="h-3 w-3" />
        {pct}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />
      igual
    </span>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  todayVal,
  weekVal,
  prevWeekVal,
  suffix = '',
  accent = false,
}: {
  label: string;
  todayVal: number;
  weekVal: number;
  prevWeekVal: number;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 flex flex-col gap-1 ${
        accent ? 'border-green-200 bg-green-50' : ''
      }`}
    >
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <div className={`font-display text-3xl font-bold leading-none ${accent ? 'text-green-700' : ''}`}>
        {todayVal}
        {suffix}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
        <span>Semana: {weekVal}{suffix}</span>
        <Trend current={weekVal} previous={prevWeekVal} />
      </div>
    </div>
  );
}

// ─── Argumentario ─────────────────────────────────────────────────────────────

function Argumentario() {
  const [open, setOpen] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setOpen((prev) => (prev === i ? null : i));
  }

  function check(i: number, e: React.MouseEvent) {
    e.stopPropagation();
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) { next.delete(i); } else { next.add(i); }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-display text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-ymc-red" />
          Argumentario de llamada
          <span className="text-xs text-muted-foreground font-sans font-normal">
            ({checked.size}/{ARGUMENTARIO_STEPS.length} pasos)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {ARGUMENTARIO_STEPS.map((s) => {
          const isDone = checked.has(s.step);
          const isOpen = open === s.step;
          return (
            <div
              key={s.step}
              className={`rounded-lg border transition-colors ${
                isDone ? 'border-green-200 bg-green-50/60' : 'border-slate-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => toggle(s.step)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              >
                <button
                  type="button"
                  onClick={(e) => check(s.step, e)}
                  className={`shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isDone ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'
                  }`}
                >
                  {isDone && <CheckCircle2 className="h-3.5 w-3.5" />}
                </button>
                <span
                  className={`text-sm font-medium flex-1 ${
                    isDone ? 'line-through text-muted-foreground' : ''
                  }`}
                >
                  {s.step}. {s.title}
                </span>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
              {isOpen && (
                <div className="px-4 pb-3 space-y-2">
                  <div className="text-sm text-slate-700 bg-white rounded-md border p-3 leading-relaxed italic">
                    "{s.script}"
                  </div>
                  <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {s.tip}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {checked.size > 0 && (
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Reiniciar pasos
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OperatorWorkspace({
  commercial,
  todayReports,
  weekReports,
  prevWeekReports,
  initialQuery,
  initialLead,
  candidates,
  comerciales,
}: {
  commercial: { id: string; name: string; display_name: string | null; role: string };
  todayReports: Report[];
  weekReports: Report[];
  prevWeekReports: Report[];
  initialQuery: string;
  initialLead: Lead | null;
  candidates: Lead[];
  comerciales: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tel, setTel] = useState(initialQuery);
  const [selected, setSelected] = useState<Lead | null>(initialLead);
  const [calls, setCalls] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form state
  const [callResult, setCallResult] = useState<CallResult | ''>('');
  const [noInterestReason, setNoInterestReason] = useState<NoInterestReason | ''>('');
  const [citaDate, setCitaDate] = useState(new Date().toISOString().slice(0, 10));
  const [citaTime, setCitaTime] = useState('10:00');
  const [citaComercial, setCitaComercial] = useState('');
  const [qmiMotivo, setQmiMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [commsOptIn, setCommsOptIn] = useState<boolean | null>(null);

  const today = computeKpis(todayReports);
  const week = computeKpis(weekReports);
  const prevWeek = computeKpis(prevWeekReports);

  useEffect(() => {
    if (!selected) { setCalls([]); return; }
    const sb = createClient();
    (async () => {
      setLoadingHistory(true);
      const { data } = await sb
        .from('mmc_calls')
        .select('id, call_at, agent_name, qcode_description, qcode_type, talk_time_s')
        .eq('lead_id', selected.id)
        .order('call_at', { ascending: false })
        .limit(10);
      setCalls(data ?? []);
      setLoadingHistory(false);
    })();
  }, [selected]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/operator?tel=${encodeURIComponent(tel.trim())}`);
  }

  async function onSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !callResult) return;

    startTransition(async () => {
      const payload: any = {
        lead_id: selected.id,
        operator_id: commercial.id,
        telefono_buscado: tel || null,
        call_result: callResult,
        observaciones: observaciones || null,
        comunicaciones_comerciales: commsOptIn,
      };
      if (callResult === 'no_interesado') payload.no_interest_reason = noInterestReason || null;
      if (callResult === 'quiere_mas_info_concesionario') payload.qmi_motivo = qmiMotivo || null;

      let citaFecha: Date | null = null;
      if (isCitaResult(callResult)) {
        citaFecha = new Date(`${citaDate}T${citaTime}:00`);
        payload.cita_fecha = citaFecha.toISOString();
        payload.cita_comercial_id = citaComercial || null;
      }

      const { error } = await supabase.from('mmc_operator_reports').insert(payload);
      if (error) {
        toast.error('Error guardando reporte', { description: error.message });
        return;
      }

      // Cita → Bookings
      if (isCitaResult(callResult) && citaFecha && citaComercial) {
        const tipo = citaResultToApptType(callResult);
        if (tipo) {
          const res = await fetch('/api/bookings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lead_id: selected.id,
              tipo,
              fecha_iso: `${citaDate}T${citaTime}:00`,
              commercial_id: citaComercial,
              notas: observaciones || null,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'unknown' }));
            toast.error('Cita en panel pero falló Bookings', { description: err.error });
            await supabase.from('mmc_appointments').insert({
              lead_id: selected.id,
              commercial_id: citaComercial,
              tipo,
              fecha_cita: citaFecha.toISOString(),
              status: 'pending',
              sync_source: 'panel_fallback',
            });
          } else {
            toast.success('¡Cita creada!', { description: 'Aparecerá en el calendario de Francisco.' });
          }
          await supabase.from('mmc_leads').update({ status: 'appointment' }).eq('id', selected.id);
        }
      } else if (callResult === 'no_interesado') {
        await supabase.from('mmc_leads').update({ status: 'lost' }).eq('id', selected.id);
        toast.success('Reporte guardado');
      } else if (callResult === 'contacto_erroneo') {
        await supabase.from('mmc_leads').update({ status: 'bad_contact' }).eq('id', selected.id);
        toast.success('Reporte guardado');
      } else {
        await supabase.from('mmc_leads').update({ status: 'contacted' }).eq('id', selected.id);
        toast.success('Reporte guardado');
      }

      // Reset
      setCallResult('');
      setNoInterestReason('');
      setQmiMotivo('');
      setObservaciones('');
      setCommsOptIn(null);
      router.refresh();
    });
  }

  const hora = new Date().getHours();
  const saludo =
    hora < 14 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="space-y-6">
      {/* Cabecera personal */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {saludo}, {commercial.display_name || commercial.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
          </p>
        </div>
      </div>

      {/* KPIs ─ hoy + semana */}
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">
          Mi rendimiento
        </p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard
            label="Llamadas"
            todayVal={today.total}
            weekVal={week.total}
            prevWeekVal={prevWeek.total}
          />
          <KpiCard
            label="Contactos"
            todayVal={today.effective}
            weekVal={week.effective}
            prevWeekVal={prevWeek.effective}
          />
          <KpiCard
            label="Tasa contacto"
            todayVal={today.contactRate}
            weekVal={week.contactRate}
            prevWeekVal={prevWeek.contactRate}
            suffix="%"
          />
          <KpiCard
            label="Citas agendadas"
            todayVal={today.citas}
            weekVal={week.citas}
            prevWeekVal={prevWeek.citas}
            accent={today.citas > 0}
          />
          <KpiCard
            label="Conversión"
            todayVal={today.conversion}
            weekVal={week.conversion}
            prevWeekVal={prevWeek.conversion}
            suffix="%"
            accent={today.conversion > 0}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Hoy (número grande) · Semana = últimos 7 días · Flecha = vs semana anterior
        </p>
      </div>

      {/* Búsqueda de teléfono */}
      <Card className="border-l-4 border-l-ymc-red">
        <CardContent className="pt-5">
          <form onSubmit={onSearch} className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="tel" className="text-xs uppercase tracking-wider text-muted-foreground">
                Teléfono que ha saltado en Presence
              </Label>
              <Input
                id="tel"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                placeholder="600 123 456"
                className="h-12 text-lg font-mono mt-1"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="bg-ymc-red hover:bg-ymc-redDark text-white h-12"
            >
              <Search className="h-5 w-5 mr-2" />
              Buscar
            </Button>
            {tel && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                className="h-12"
                onClick={() => {
                  setTel('');
                  setSelected(null);
                  router.push('/operator');
                }}
              >
                Limpiar
              </Button>
            )}
          </form>

          {candidates.length > 1 && (
            <div className="mt-3 text-xs text-muted-foreground">
              {candidates.length} leads con este teléfono.{' '}
              <details className="inline">
                <summary className="cursor-pointer text-ymc-red">ver todos</summary>
                <ul className="mt-2 space-y-1">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected(c)}
                        className={`text-left hover:underline ${
                          selected?.id === c.id ? 'font-medium text-ymc-red' : ''
                        }`}
                      >
                        {c.nombre} ·{' '}
                        {format(new Date(c.fecha_entrada), 'd MMM yyyy', { locale: es })}
                        {c.modelo_raw && ` · ${c.modelo_raw}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Área principal: lead + argumentario + formulario */}
      {selected ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Columna izquierda: ficha + historial + argumentario */}
          <div className="xl:col-span-4 space-y-4">
            {/* Ficha del lead */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-xl flex items-center justify-between">
                  <span>{selected.nombre}</span>
                  <Link
                    href={`/leads/${selected.id}`}
                    className="text-xs text-muted-foreground hover:text-ymc-red inline-flex items-center gap-1"
                    target="_blank"
                  >
                    Ficha completa <ExternalLink className="h-3 w-3" />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2.5">
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {ORIGIN_LABEL[selected.origen]}
                  </Badge>
                  {selected.formulario && (
                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                      via {selected.formulario}
                    </span>
                  )}
                </div>

                {selected.telefono && (
                  <a
                    href={`tel:${selected.telefono}`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <Phone className="h-4 w-4 text-ymc-red shrink-0" />
                    <span className="font-mono font-medium">{selected.telefono}</span>
                  </a>
                )}
                {selected.email && (
                  <a
                    href={`mailto:${selected.email}`}
                    className="flex items-center gap-2 hover:underline truncate"
                  >
                    <Mail className="h-4 w-4 text-ymc-red shrink-0" />
                    <span className="truncate">{selected.email}</span>
                  </a>
                )}
                {selected.modelo_raw && (
                  <div className="flex items-center gap-2">
                    <Bike className="h-4 w-4 text-ymc-red shrink-0" />
                    <span className="font-medium">{selected.modelo_raw}</span>
                  </div>
                )}
                {selected.mensajes_preferencias && (
                  <div className="flex items-start gap-2 text-muted-foreground bg-slate-50 rounded-md p-2 mt-1">
                    <MessageSquare className="h-4 w-4 text-ymc-red mt-0.5 shrink-0" />
                    <em className="text-xs">"{selected.mensajes_preferencias}"</em>
                  </div>
                )}

                <div className="pt-2 border-t text-xs text-muted-foreground space-y-0.5">
                  <div>
                    Lead desde{' '}
                    <strong>
                      {format(new Date(selected.fecha_entrada), 'd MMM yyyy', { locale: es })}
                    </strong>
                  </div>
                  {selected.bq_total_attempts != null && (
                    <div>
                      Intentos previos Presence:{' '}
                      <strong>{selected.bq_total_attempts}</strong>
                    </div>
                  )}
                  {selected.bq_last_agent && (
                    <div>
                      Última agente: <strong>{selected.bq_last_agent}</strong>
                    </div>
                  )}
                  {selected.bq_last_call_at && (
                    <div>
                      Último intento:{' '}
                      <strong>
                        {format(
                          new Date(selected.bq_last_call_at),
                          "d MMM · HH:mm",
                          { locale: es }
                        )}
                      </strong>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Histórico de llamadas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-ymc-red" />
                  Últimas llamadas
                  {selected.bq_total_attempts != null && (
                    <span className="text-xs text-muted-foreground font-sans font-normal">
                      ({calls.length} de {selected.bq_total_attempts})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingHistory ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : calls.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-1">Sin llamadas registradas.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {calls.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">
                            {format(new Date(c.call_at), "d MMM · HH:mm", { locale: es })}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{c.agent_name || '—'}</div>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                            c.qcode_type === 'Positive useful'
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : c.qcode_type === 'Negative useful'
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                        >
                          {c.qcode_description || c.qcode_type || '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Argumentario */}
            <Argumentario />
          </div>

          {/* Columna derecha: formulario de resultado */}
          <form onSubmit={onSubmitReport} className="xl:col-span-8">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="font-display text-lg">
                  Resultado de la llamada con {selected.nombre}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Resultado */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">¿Cómo ha ido la llamada? *</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(Object.keys(CALL_RESULT_LABEL) as CallResult[])
                      .filter((k) => k !== 'no_contactado')
                      .map((k) => {
                        const isCita = CITA_RESULTS.has(k);
                        const isSelected = callResult === k;
                        return (
                          <Button
                            key={k}
                            type="button"
                            variant={isSelected ? 'default' : 'outline'}
                            className={`justify-start text-left h-auto py-3 px-4 ${
                              isSelected && isCita
                                ? 'bg-green-600 hover:bg-green-700 border-green-600 text-white'
                                : isSelected
                                ? 'bg-ymc-red hover:bg-ymc-redDark border-ymc-red text-white'
                                : isCita
                                ? 'border-green-200 hover:bg-green-50'
                                : ''
                            }`}
                            onClick={() => setCallResult(k)}
                          >
                            <span className="text-sm leading-tight">{CALL_RESULT_LABEL[k]}</span>
                          </Button>
                        );
                      })}
                  </div>
                </div>

                {/* No interesado: motivo */}
                {callResult === 'no_interesado' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-2">
                    <Label className="text-sm font-semibold">Motivo de no interés *</Label>
                    <div className="grid gap-1.5">
                      {(Object.keys(NO_INTEREST_REASON_LABEL) as NoInterestReason[]).map((k) => (
                        <Button
                          key={k}
                          type="button"
                          variant={noInterestReason === k ? 'default' : 'outline'}
                          className={`justify-start text-left ${
                            noInterestReason === k
                              ? 'bg-amber-600 hover:bg-amber-700 border-amber-600'
                              : ''
                          }`}
                          onClick={() => setNoInterestReason(k)}
                        >
                          {NO_INTEREST_REASON_LABEL[k]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cita: fecha, hora, comercial */}
                {callResult && isCitaResult(callResult) && (
                  <div className="rounded-lg border border-green-200 bg-green-50/60 p-4 space-y-3">
                    <Label className="text-sm font-semibold">Datos de la cita *</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="citaDate" className="text-xs text-muted-foreground">
                          Fecha
                        </Label>
                        <Input
                          id="citaDate"
                          type="date"
                          value={citaDate}
                          onChange={(e) => setCitaDate(e.target.value)}
                          required
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor="citaTime" className="text-xs text-muted-foreground">
                          Hora
                        </Label>
                        <Input
                          id="citaTime"
                          type="time"
                          value={citaTime}
                          onChange={(e) => setCitaTime(e.target.value)}
                          required
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="citaComercial" className="text-xs text-muted-foreground">
                        Comercial asignado *
                      </Label>
                      <select
                        id="citaComercial"
                        value={citaComercial}
                        onChange={(e) => setCitaComercial(e.target.value)}
                        className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-white"
                        required
                      >
                        <option value="">— Selecciona comercial —</option>
                        {comerciales.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.role === 'gerente' ? '(gerente)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* QMI: motivo */}
                {callResult === 'quiere_mas_info_concesionario' && (
                  <div className="rounded-lg border border-ymc-redLight bg-ymc-redLight/30 p-4 space-y-2">
                    <Label htmlFor="qmiMotivo" className="text-sm font-semibold">
                      ¿Sobre qué necesita más información?
                    </Label>
                    <Input
                      id="qmiMotivo"
                      value={qmiMotivo}
                      onChange={(e) => setQmiMotivo(e.target.value)}
                      placeholder="Ej: financiación, disponibilidad de stock, precio..."
                      className="mt-1"
                    />
                  </div>
                )}

                {/* Comunicaciones comerciales */}
                {callResult && (
                  <div>
                    <Label className="text-sm font-semibold">
                      ¿Acepta comunicaciones comerciales?
                    </Label>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant={commsOptIn === true ? 'default' : 'outline'}
                        onClick={() => setCommsOptIn(commsOptIn === true ? null : true)}
                        className={
                          commsOptIn === true ? 'bg-green-600 hover:bg-green-700 border-green-600' : ''
                        }
                        size="sm"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Sí
                      </Button>
                      <Button
                        type="button"
                        variant={commsOptIn === false ? 'default' : 'outline'}
                        onClick={() => setCommsOptIn(commsOptIn === false ? null : false)}
                        className={
                          commsOptIn === false ? 'bg-slate-700 hover:bg-slate-800 border-slate-700' : ''
                        }
                        size="sm"
                      >
                        <XCircle className="h-4 w-4 mr-1" /> No
                      </Button>
                      {commsOptIn !== null && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCommsOptIn(null)}
                          className="text-muted-foreground text-xs"
                        >
                          No preguntado
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Observaciones */}
                {callResult && (
                  <div className="space-y-1.5">
                    <Label htmlFor="obs" className="text-sm font-semibold">
                      Observaciones (opcional)
                    </Label>
                    <Textarea
                      id="obs"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Notas adicionales sobre la conversación..."
                      rows={3}
                    />
                  </div>
                )}

                {/* Submit */}
                {callResult && (
                  <Button
                    type="submit"
                    size="lg"
                    disabled={
                      pending ||
                      (callResult === 'no_interesado' && !noInterestReason) ||
                      (isCitaResult(callResult) && !citaComercial)
                    }
                    className="w-full bg-ymc-red hover:bg-ymc-redDark text-white font-semibold text-base"
                  >
                    {pending ? (
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 mr-2" />
                    )}
                    Guardar resultado
                  </Button>
                )}
              </CardContent>
            </Card>
          </form>
        </div>
      ) : (
        /* Estado vacío: sin búsqueda activa */
        <Card>
          <CardContent className="py-14 text-center">
            {initialQuery ? (
              <>
                <AlertTriangle className="h-10 w-10 text-amber-400 mx-auto mb-3" />
                <p className="font-display font-semibold text-lg">
                  No encontramos el teléfono{' '}
                  <span className="font-mono">{initialQuery}</span>
                </p>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                  Puede que sea un lead nuevo de Presence no capturado aún en el Sheet, o que
                  haya un formato distinto. Prueba sólo con los últimos 9 dígitos.
                </p>
              </>
            ) : (
              <>
                <Phone className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-display font-semibold text-lg text-muted-foreground">
                  Introduce el teléfono de Presence para empezar
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Busca al lead y registra el resultado de tu llamada.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
