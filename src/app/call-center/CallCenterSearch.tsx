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
  Calendar,
  History,
  User,
  Loader2,
  Search,
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
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

export default function CallCenterSearch({
  initialQuery,
  initialLead,
  candidates,
  operatorId,
  comerciales,
}: {
  initialQuery: string;
  initialLead: Lead | null;
  candidates: Lead[];
  operatorId: string;
  comerciales: { id: string; name: string; role: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tel, setTel] = useState(initialQuery);
  const [selected, setSelected] = useState<Lead | null>(initialLead);
  const [calls, setCalls] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reporte form state
  const [callResult, setCallResult] = useState<CallResult | ''>('');
  const [noInterestReason, setNoInterestReason] = useState<NoInterestReason | ''>('');
  const [citaDate, setCitaDate] = useState(new Date().toISOString().slice(0, 10));
  const [citaTime, setCitaTime] = useState('10:00');
  const [citaComercial, setCitaComercial] = useState<string>('');
  const [qmiMotivo, setQmiMotivo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [commsOptIn, setCommsOptIn] = useState<boolean | null>(null);

  // Cargar histórico cuando hay lead seleccionado
  useEffect(() => {
    if (!selected) {
      setCalls([]);
      return;
    }
    (async () => {
      setLoadingHistory(true);
      const { data } = await supabase
        .from('mmc_calls')
        .select('id, call_at, agent_name, qcode_description, qcode_type, talk_time_s')
        .eq('lead_id', selected.id)
        .order('call_at', { ascending: false })
        .limit(15);
      setCalls(data ?? []);
      setLoadingHistory(false);
    })();
  }, [selected, supabase]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/call-center?tel=${encodeURIComponent(tel.trim())}`);
  }

  async function onSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !callResult) return;

    startTransition(async () => {
      // 1) Crear operator report
      const payload: any = {
        lead_id: selected.id,
        operator_id: operatorId,
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

      const { error: rErr } = await supabase.from('mmc_operator_reports').insert(payload);
      if (rErr) {
        toast.error('Error guardando reporte', { description: rErr.message });
        return;
      }

      // 2) Si es cita → crear en Microsoft Bookings vía /api/bookings/create
      //    (crea el evento en calendario del comercial + invita al lead por email
      //     + guarda mmc_appointment local con graph_event_id)
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
            toast.error('Cita creada en panel pero falló Bookings', {
              description: err.error,
            });
            // Fallback: crear localmente sin Bookings para no perder el dato
            await supabase.from('mmc_appointments').insert({
              lead_id: selected.id,
              commercial_id: citaComercial,
              tipo,
              fecha_cita: citaFecha.toISOString(),
              status: 'pending',
              sync_source: 'panel_fallback',
            });
          }
          await supabase.from('mmc_leads').update({ status: 'appointment' }).eq('id', selected.id);
        }
      } else if (callResult === 'no_interesado') {
        await supabase
          .from('mmc_leads')
          .update({ status: 'lost', lost_reason: noInterestReason || null })
          .eq('id', selected.id);
      } else if (callResult === 'contacto_erroneo') {
        await supabase.from('mmc_leads').update({ status: 'bad_contact' }).eq('id', selected.id);
      } else if (
        callResult === 'no_contesta' ||
        callResult === 'cuelga_al_identificarse' ||
        callResult === 'quiere_mas_info_concesionario'
      ) {
        await supabase.from('mmc_leads').update({ status: 'contacted' }).eq('id', selected.id);
      }

      toast.success('Reporte guardado', {
        description: isCitaResult(callResult) ? 'Cita creada automáticamente' : undefined,
      });

      // Reset form
      setCallResult('');
      setNoInterestReason('');
      setQmiMotivo('');
      setObservaciones('');
      setCommsOptIn(null);
      // Recargar histórico
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Buscador */}
      <Card className="border-l-4 border-l-ymc-red">
        <CardContent className="pt-6">
          <form onSubmit={onSearch} className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="tel" className="text-xs uppercase tracking-wider text-muted-foreground">
                Teléfono que ha saltado en Presence
              </Label>
              <Input
                id="tel"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                placeholder="600 123 456"
                className="h-12 text-lg font-mono"
                autoFocus
              />
            </div>
            <Button type="submit" size="lg" className="bg-ymc-red hover:bg-ymc-redDark text-white h-12">
              <Search className="h-5 w-5 mr-2" />
              Buscar
            </Button>
          </form>

          {candidates.length > 1 && (
            <div className="mt-4 text-xs text-muted-foreground">
              Hay {candidates.length} leads con este teléfono. Mostrando el más reciente.{' '}
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
                        {c.nombre} · {format(new Date(c.fecha_entrada), "d MMM yyyy", { locale: es })}
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

      {/* Lead encontrado */}
      {selected ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Ficha del lead */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-xl flex items-center justify-between">
                  <span>{selected.nombre}</span>
                  <Link
                    href={`/leads/${selected.id}`}
                    className="text-xs text-muted-foreground hover:text-ymc-red inline-flex items-center gap-1"
                    target="_blank"
                  >
                    Ficha <ExternalLink className="h-3 w-3" />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary" className="font-mono">
                    {ORIGIN_LABEL[selected.origen]}
                  </Badge>
                  {selected.formulario && (
                    <span className="text-xs text-muted-foreground truncate">
                      via {selected.formulario}
                    </span>
                  )}
                </div>
                {selected.telefono && (
                  <a href={`tel:${selected.telefono}`} className="flex items-center gap-2 hover:underline">
                    <Phone className="h-4 w-4 text-ymc-red" />
                    <span className="font-mono">{selected.telefono}</span>
                  </a>
                )}
                {selected.email && (
                  <a href={`mailto:${selected.email}`} className="flex items-center gap-2 hover:underline truncate">
                    <Mail className="h-4 w-4 text-ymc-red" />
                    <span className="truncate">{selected.email}</span>
                  </a>
                )}
                {selected.modelo_raw && (
                  <div className="flex items-center gap-2">
                    <Bike className="h-4 w-4 text-ymc-red" />
                    <span>{selected.modelo_raw}</span>
                  </div>
                )}
                {selected.mensajes_preferencias && (
                  <div className="flex items-start gap-2 text-muted-foreground bg-slate-50 p-2 rounded-md mt-2">
                    <MessageSquare className="h-4 w-4 text-ymc-red mt-0.5 shrink-0" />
                    <em>"{selected.mensajes_preferencias}"</em>
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-2 border-t">
                  Lead desde{' '}
                  <strong>
                    {format(new Date(selected.fecha_entrada), "d MMM yyyy", { locale: es })}
                  </strong>
                </div>
              </CardContent>
            </Card>

            {/* Histórico llamadas (resumen) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-ymc-red" />
                  Últimas llamadas
                  <span className="text-xs text-muted-foreground font-sans font-normal">
                    ({calls.length}
                    {selected.bq_total_attempts ? ` de ${selected.bq_total_attempts}` : ''})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingHistory ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : calls.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-1">Nunca se le ha llamado.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {calls.slice(0, 8).map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">
                            {format(new Date(c.call_at), "d MMM · HH:mm", { locale: es })}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {c.agent_name || '—'}
                          </div>
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
                          {c.qcode_description || '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Formulario reporte */}
          <form onSubmit={onSubmitReport} className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-lg">Reportar resultado de la llamada</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Paso 1: resultado */}
                <div className="space-y-2">
                  <Label className="text-base font-medium">Resultado de la llamada *</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(Object.keys(CALL_RESULT_LABEL) as CallResult[])
                      .filter((k) => k !== 'no_contactado') // no se reporta manualmente
                      .map((k) => (
                        <Button
                          key={k}
                          type="button"
                          variant={callResult === k ? 'default' : 'outline'}
                          className={`justify-start text-left h-auto py-2.5 ${
                            callResult === k ? 'bg-ymc-red hover:bg-ymc-redDark text-white' : ''
                          }`}
                          onClick={() => setCallResult(k)}
                        >
                          <span className="text-sm">{CALL_RESULT_LABEL[k]}</span>
                        </Button>
                      ))}
                  </div>
                </div>

                {/* Condicional según resultado */}
                {callResult === 'no_interesado' && (
                  <div className="space-y-2 rounded-md border bg-amber-50/60 p-4">
                    <Label className="text-sm font-medium">Motivo *</Label>
                    <div className="grid gap-1.5">
                      {(Object.keys(NO_INTEREST_REASON_LABEL) as NoInterestReason[]).map((k) => (
                        <Button
                          key={k}
                          type="button"
                          variant={noInterestReason === k ? 'default' : 'outline'}
                          className={`justify-start text-left ${
                            noInterestReason === k ? 'bg-amber-600 hover:bg-amber-700' : ''
                          }`}
                          onClick={() => setNoInterestReason(k)}
                        >
                          {NO_INTEREST_REASON_LABEL[k]}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {callResult && isCitaResult(callResult) && (
                  <div className="space-y-3 rounded-md border bg-green-50/60 p-4">
                    <Label className="text-sm font-medium">Datos de la cita *</Label>
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
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="citaComercial" className="text-xs text-muted-foreground">
                        Comercial asignado
                      </Label>
                      <select
                        id="citaComercial"
                        value={citaComercial}
                        onChange={(e) => setCitaComercial(e.target.value)}
                        className="w-full border rounded-md px-3 py-2 text-sm bg-white"
                      >
                        <option value="">— Sin asignar —</option>
                        {comerciales.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.role === 'gerente' ? '(gerente)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {callResult === 'quiere_mas_info_concesionario' && (
                  <div className="space-y-2 rounded-md border bg-ymc-redLight/40 p-4">
                    <Label htmlFor="qmiMotivo" className="text-sm font-medium">
                      ¿Sobre qué necesita más información?
                    </Label>
                    <Input
                      id="qmiMotivo"
                      value={qmiMotivo}
                      onChange={(e) => setQmiMotivo(e.target.value)}
                      placeholder="Ej: financiación, accesorios, stock..."
                    />
                  </div>
                )}

                {/* Paso 3: opt-in marketing */}
                {callResult && (
                  <div>
                    <Label className="text-sm font-medium">
                      ¿Acepta comunicaciones comerciales?
                    </Label>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant={commsOptIn === true ? 'default' : 'outline'}
                        onClick={() => setCommsOptIn(true)}
                        className={commsOptIn === true ? 'bg-green-600 hover:bg-green-700' : ''}
                        size="sm"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Sí
                      </Button>
                      <Button
                        type="button"
                        variant={commsOptIn === false ? 'default' : 'outline'}
                        onClick={() => setCommsOptIn(false)}
                        className={commsOptIn === false ? 'bg-slate-700 hover:bg-slate-800' : ''}
                        size="sm"
                      >
                        <XCircle className="h-4 w-4 mr-1" /> No
                      </Button>
                    </div>
                  </div>
                )}

                {/* Observaciones */}
                {callResult && (
                  <div className="space-y-2">
                    <Label htmlFor="obs" className="text-sm font-medium">
                      Observaciones (opcional)
                    </Label>
                    <Textarea
                      id="obs"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Anotaciones adicionales..."
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
                    className="w-full bg-ymc-red hover:bg-ymc-redDark text-white"
                  >
                    {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Guardar reporte
                  </Button>
                )}
              </CardContent>
            </Card>
          </form>
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            {initialQuery ? (
              <>
                <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-3" />
                <p className="font-medium">
                  No encontramos ningún lead con el teléfono <span className="font-mono">{initialQuery}</span>
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Puede que sea un lead que aún no tenemos en el sistema, que esté en los no-contactables de Presence, o que haya un typo.
                </p>
              </>
            ) : (
              <>
                <Phone className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  Introduce un teléfono para empezar.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
