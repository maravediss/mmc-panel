'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { Loader2, Check, X, CalendarClock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NO_SALE_REASON_LABEL } from '@/lib/mappings';
import type { NoSaleReason } from '@/lib/types';

type Step = 'attendance' | 'outcome' | 'reschedule' | 'details' | 'done';
type Decision = 'attended' | 'no_show' | 'rescheduled' | null;
type CitaTipo = 'prueba_moto' | 'concesionario' | 'taller';

const MORNING = ['09:00', '10:00', '11:00', '12:00', '13:00'];
const AFTERNOON = ['16:00', '17:00', '18:00', '19:00'];

function getWorkingDays(n = 14): Date[] {
  const days: Date[] = [];
  let d = addDays(new Date(), 1);
  while (days.length < n) {
    if (d.getDay() !== 0) days.push(new Date(d));
    d = addDays(d, 1);
  }
  return days;
}

const TIPO_LABEL: Record<CitaTipo, { label: string; emoji: string }> = {
  prueba_moto: { label: 'Prueba de moto', emoji: '🏍️' },
  concesionario: { label: 'Visita concesionario', emoji: '🏪' },
  taller: { label: 'Cita de taller', emoji: '🔧' },
};

export default function CloseAppointmentForm({
  appointment,
  existingSale,
  existingNoSale,
  commercialId,
  canEdit,
  redirectTo = '/',
  comerciales = [],
}: {
  appointment: any;
  existingSale: any;
  existingNoSale: any;
  commercialId: string;
  canEdit: boolean;
  redirectTo?: string;
  comerciales?: { id: string; name: string; display_name: string | null; role: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  const startStep: Step = appointment.status === 'pending' ? 'attendance' : 'done';

  const [step, setStep] = useState<Step>(startStep);
  const [decision, setDecision] = useState<Decision>(
    appointment.status === 'attended'
      ? 'attended'
      : appointment.status === 'no_show'
      ? 'no_show'
      : null
  );
  const [noShowMotivo, setNoShowMotivo] = useState(appointment.no_show_motivo || '');

  // Outcome
  const [bought, setBought] = useState<boolean | null>(
    existingSale ? true : existingNoSale ? false : null
  );
  const [modelRaw, setModelRaw] = useState(existingSale?.model_raw || '');
  const [margenEur, setMargenEur] = useState<string>(
    existingSale?.margen_eur ? String(existingSale.margen_eur) : ''
  );
  const [fechaCompra, setFechaCompra] = useState(
    existingSale?.fecha_compra || new Date().toISOString().slice(0, 10)
  );
  const [noSaleReason, setNoSaleReason] = useState<NoSaleReason | ''>(
    existingNoSale?.motivo || ''
  );
  const [noSaleText, setNoSaleText] = useState(existingNoSale?.motivo_texto || '');
  const [notes, setNotes] = useState(appointment.notes || '');

  // Reschedule fields
  const [rTipo, setRTipo] = useState<CitaTipo>(
    (appointment.tipo as CitaTipo) || 'concesionario'
  );
  const [rDate, setRDate] = useState<Date | null>(null);
  const [rTime, setRTime] = useState('');
  const [rComercialId, setRComercialId] = useState(appointment.commercial_id || '');
  const [rNotas, setRNotas] = useState('');

  if (!canEdit) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Esta cita no está asignada a ti. Pide a un gerente que te la reasigne si necesitas cerrarla.
        </CardContent>
      </Card>
    );
  }

  function pick(d: Decision) {
    setDecision(d);
    if (d === 'no_show') setStep('details');
    else if (d === 'attended') setStep('outcome');
    else if (d === 'rescheduled') setStep('reschedule');
  }

  async function submitClose() {
    startTransition(async () => {
      const updateBase: any = {
        notes: notes || null,
        status: decision === 'attended' ? 'attended' : 'no_show',
        attended_at: decision === 'attended' ? new Date().toISOString() : null,
        no_show_motivo: decision === 'no_show' ? noShowMotivo || null : null,
        closed_at: new Date().toISOString(),
      };

      const { error: apptErr } = await supabase
        .from('mmc_appointments')
        .update(updateBase)
        .eq('id', appointment.id);

      if (apptErr) {
        toast.error('Error guardando la cita', { description: apptErr.message });
        return;
      }

      if (decision === 'no_show') {
        toast.success('Cita cerrada como No asistió');
        router.push(redirectTo);
        router.refresh();
        return;
      }

      // attended + bought
      if (bought) {
        await supabase.from('mmc_no_sale_reasons').delete().eq('appointment_id', appointment.id);

        const salePayload = {
          lead_id: appointment.lead.id,
          appointment_id: appointment.id,
          commercial_id: commercialId,
          model_raw: modelRaw || null,
          fecha_compra: fechaCompra,
          margen_eur: margenEur ? parseFloat(margenEur.replace(',', '.')) : null,
          notas: notes || null,
        };

        let saleErr;
        if (existingSale) {
          ({ error: saleErr } = await supabase
            .from('mmc_sales')
            .update(salePayload)
            .eq('id', existingSale.id));
        } else {
          ({ error: saleErr } = await supabase.from('mmc_sales').insert(salePayload));
        }

        if (saleErr) {
          toast.error('Error guardando la venta', { description: saleErr.message });
          return;
        }

        await supabase.from('mmc_leads').update({ status: 'sold' }).eq('id', appointment.lead.id);
        toast.success('Venta registrada');
      } else {
        // attended + no compra
        await supabase.from('mmc_sales').delete().eq('appointment_id', appointment.id);

        const nsrPayload = {
          lead_id: appointment.lead.id,
          appointment_id: appointment.id,
          motivo: noSaleReason,
          motivo_texto: noSaleText || null,
        };

        if (existingNoSale) {
          await supabase
            .from('mmc_no_sale_reasons')
            .update(nsrPayload)
            .eq('id', existingNoSale.id);
        } else {
          const { error } = await supabase.from('mmc_no_sale_reasons').insert(nsrPayload);
          if (error) {
            toast.error('Error guardando el motivo', { description: error.message });
            return;
          }
        }

        await supabase.from('mmc_leads').update({ status: 'lost' }).eq('id', appointment.lead.id);
        toast.success('Cita cerrada sin venta');
      }

      router.push(redirectTo);
      router.refresh();
    });
  }

  async function submitReschedule() {
    if (!rDate || !rTime || !rComercialId) {
      toast.error('Falta seleccionar fecha, hora o comercial');
      return;
    }
    startTransition(async () => {
      // 1) Crear nueva cita vía Bookings (preferente) o fallback local
      const fechaIso = `${format(rDate, 'yyyy-MM-dd')}T${rTime}:00`;
      let createdOk = false;
      try {
        const res = await fetch('/api/bookings/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: appointment.lead.id,
            tipo: rTipo,
            fecha_iso: fechaIso,
            commercial_id: rComercialId,
            notas:
              (rNotas ? `${rNotas}\n` : '') +
              `[Reagendada desde cita ${format(new Date(appointment.fecha_cita), "d MMM HH:mm", { locale: es })}]`,
          }),
        });
        createdOk = res.ok;
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'unknown' }));
          toast.error('No se pudo crear en Outlook, guardando local', { description: err.error });
          await supabase.from('mmc_appointments').insert({
            lead_id: appointment.lead.id,
            commercial_id: rComercialId,
            tipo: rTipo,
            fecha_cita: fechaIso,
            status: 'pending',
            sync_source: 'panel_fallback',
            notes: rNotas || null,
          });
          createdOk = true;
        }
      } catch (e: any) {
        toast.error('Error al crear la nueva cita', { description: e?.message });
        return;
      }

      if (!createdOk) return;

      // 2) Cancelar la cita actual con motivo reagendada
      const reschedNote =
        `[Reagendada al ${format(rDate, "d MMM 'a las' HH:mm", { locale: es })}` +
        ` con ${comerciales.find(c => c.id === rComercialId)?.display_name || comerciales.find(c => c.id === rComercialId)?.name || 'comercial'}]` +
        (rNotas ? ` ${rNotas}` : '');

      await supabase
        .from('mmc_appointments')
        .update({
          status: 'cancelled',
          no_show_motivo: 'reagendada',
          notes: appointment.notes ? `${appointment.notes}\n${reschedNote}` : reschedNote,
          closed_at: new Date().toISOString(),
        })
        .eq('id', appointment.id);

      // 3) Mantener lead como 'appointment' (sigue habiendo cita activa, la nueva)
      await supabase
        .from('mmc_leads')
        .update({ status: 'appointment' })
        .eq('id', appointment.lead.id);

      toast.success('Cita reagendada');
      router.push(redirectTo);
      router.refresh();
    });
  }

  // Cita ya cerrada
  if (startStep === 'done' && step === 'done') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cita ya cerrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Estado: <strong>{appointment.status}</strong>
          </p>
          {existingSale && (
            <div className="rounded-md border bg-green-50 p-3">
              <p className="font-medium text-green-900">Venta registrada</p>
              <p>Modelo: {existingSale.model_raw ?? '—'}</p>
              <p>Margen: {existingSale.margen_eur ? `${existingSale.margen_eur} €` : '—'}</p>
              <p>Fecha compra: {existingSale.fecha_compra}</p>
            </div>
          )}
          {existingNoSale && (
            <div className="rounded-md border bg-amber-50 p-3">
              <p className="font-medium text-amber-900">No compra</p>
              <p>Motivo: {NO_SALE_REASON_LABEL[existingNoSale.motivo as NoSaleReason]}</p>
              {existingNoSale.motivo_texto && <p>Detalle: {existingNoSale.motivo_texto}</p>}
            </div>
          )}
          <Button variant="outline" onClick={() => setStep('attendance')}>
            Editar cierre
          </Button>
        </CardContent>
      </Card>
    );
  }

  const workingDays = getWorkingDays();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cerrar cita</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Paso 1: 3 opciones */}
        <div>
          <Label className="text-base font-medium">¿Qué pasó con esta cita?</Label>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              type="button"
              size="lg"
              variant={decision === 'attended' ? 'default' : 'outline'}
              onClick={() => pick('attended')}
              className={
                decision === 'attended'
                  ? 'bg-green-600 hover:bg-green-700 h-auto py-3'
                  : 'h-auto py-3'
              }
            >
              <Check className="h-5 w-5 mr-2" /> Sí, acudió
            </Button>
            <Button
              type="button"
              size="lg"
              variant={decision === 'no_show' ? 'default' : 'outline'}
              onClick={() => pick('no_show')}
              className={
                decision === 'no_show'
                  ? 'bg-red-600 hover:bg-red-700 h-auto py-3'
                  : 'h-auto py-3'
              }
            >
              <X className="h-5 w-5 mr-2" /> No acudió
            </Button>
            <Button
              type="button"
              size="lg"
              variant={decision === 'rescheduled' ? 'default' : 'outline'}
              onClick={() => pick('rescheduled')}
              className={
                decision === 'rescheduled'
                  ? 'bg-amber-500 hover:bg-amber-600 h-auto py-3'
                  : 'h-auto py-3'
              }
            >
              <CalendarClock className="h-5 w-5 mr-2" /> Reagendar cita
            </Button>
          </div>
        </div>

        {/* Reschedule flow */}
        {decision === 'rescheduled' && (
          <div className="space-y-5 rounded-lg border p-4 bg-amber-50/40">
            {/* Tipo */}
            <div>
              <Label className="text-sm font-medium">Tipo de cita</Label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(Object.keys(TIPO_LABEL) as CitaTipo[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRTipo(t)}
                    className={`rounded-lg border-2 px-3 py-2.5 text-sm transition-all flex items-center gap-1.5 justify-center ${
                      rTipo === t
                        ? 'border-ymc-red bg-ymc-redLight text-ymc-red font-semibold'
                        : 'border-slate-200 bg-white hover:border-ymc-red/40'
                    }`}
                  >
                    <span>{TIPO_LABEL[t].emoji}</span>
                    <span className="hidden sm:inline">{TIPO_LABEL[t].label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Día */}
            <div>
              <Label className="text-sm font-medium">¿Qué día?</Label>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {workingDays.map((d) => {
                  const iso = format(d, 'yyyy-MM-dd');
                  const sel = rDate && format(rDate, 'yyyy-MM-dd') === iso;
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setRDate(d)}
                      className={`shrink-0 flex flex-col items-center rounded-xl border-2 px-3 py-2 min-w-[60px] transition-all ${
                        sel
                          ? 'border-ymc-red bg-ymc-red text-white'
                          : 'border-slate-200 bg-white hover:border-ymc-red/50'
                      }`}
                    >
                      <span
                        className={`text-xs font-medium ${
                          sel ? 'text-white/80' : 'text-muted-foreground'
                        }`}
                      >
                        {format(d, 'EEE', { locale: es }).slice(0, 3)}
                      </span>
                      <span className="font-bold text-base">{format(d, 'd')}</span>
                      <span
                        className={`text-[10px] ${sel ? 'text-white/70' : 'text-muted-foreground'}`}
                      >
                        {format(d, 'MMM', { locale: es })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hora */}
            {rDate && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">¿A qué hora?</Label>
                <div className="space-y-2">
                  {[
                    { label: 'Mañana', slots: MORNING },
                    { label: 'Tarde', slots: AFTERNOON },
                  ].map(({ label, slots }) => (
                    <div key={label}>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        {label}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {slots.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setRTime(t)}
                            className={`rounded-lg border-2 px-3 py-1.5 text-sm font-mono font-medium transition-all ${
                              rTime === t
                                ? 'border-ymc-red bg-ymc-red text-white'
                                : 'border-slate-200 bg-white hover:border-ymc-red/50'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comercial */}
            {rTime && (
              <div>
                <Label className="text-sm font-medium">¿Con qué comercial?</Label>
                {comerciales.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No se han cargado los comerciales — recarga la página y vuelve a intentarlo.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {comerciales.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setRComercialId(c.id)}
                        className={`rounded-lg border-2 px-4 py-2 text-sm transition-all ${
                          rComercialId === c.id
                            ? 'border-ymc-red bg-ymc-red text-white font-semibold'
                            : 'border-slate-200 bg-white hover:border-ymc-red/50'
                        }`}
                      >
                        {c.display_name || c.name}
                        {c.role === 'gerente' && (
                          <span className="ml-1 text-xs opacity-70">(gerente)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Notas reagendar */}
            <div className="space-y-2">
              <Label htmlFor="r_notas" className="text-sm">
                Motivo / notas (opcional)
              </Label>
              <Textarea
                id="r_notas"
                placeholder="Ej: el cliente pidió cambiar la hora, tiene compromiso..."
                value={rNotas}
                onChange={(e) => setRNotas(e.target.value)}
                rows={2}
              />
            </div>

            <Button
              type="button"
              size="lg"
              onClick={submitReschedule}
              disabled={pending || !rDate || !rTime || !rComercialId}
              className="w-full bg-amber-500 hover:bg-amber-600"
            >
              {pending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
              <CalendarClock className="h-5 w-5 mr-2" />
              Confirmar reagendado
            </Button>
          </div>
        )}

        {/* Paso 2a: no acudió → motivo */}
        {decision === 'no_show' && (
          <div className="space-y-2">
            <Label htmlFor="no_show_motivo">Motivo de la ausencia</Label>
            <Textarea
              id="no_show_motivo"
              placeholder="Ej: canceló por WhatsApp, no contesta, no se presentó..."
              value={noShowMotivo}
              onChange={(e) => setNoShowMotivo(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {/* Paso 2b: acudió → ¿compró? */}
        {decision === 'attended' && (
          <div>
            <Label className="text-base font-medium">¿Compró la moto?</Label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Button
                type="button"
                size="lg"
                variant={bought === true ? 'default' : 'outline'}
                onClick={() => setBought(true)}
                className={bought === true ? 'bg-green-600 hover:bg-green-700' : ''}
              >
                <Check className="h-5 w-5 mr-2" /> Sí
              </Button>
              <Button
                type="button"
                size="lg"
                variant={bought === false ? 'default' : 'outline'}
                onClick={() => setBought(false)}
                className={bought === false ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                <X className="h-5 w-5 mr-2" /> No
              </Button>
            </div>
          </div>
        )}

        {/* Paso 3a: compró → datos venta */}
        {decision === 'attended' && bought === true && (
          <div className="space-y-4 rounded-lg border p-4 bg-green-50/50">
            <div className="space-y-2">
              <Label htmlFor="modelRaw">Modelo vendido *</Label>
              <Input
                id="modelRaw"
                placeholder="Ej: MT-07 35kW, NMAX 125, Tracer 9..."
                value={modelRaw}
                onChange={(e) => setModelRaw(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="margen">Margen (€)</Label>
                <Input
                  id="margen"
                  type="text"
                  inputMode="decimal"
                  placeholder="1250.00"
                  value={margenEur}
                  onChange={(e) => setMargenEur(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fecha_compra">Fecha de compra *</Label>
                <Input
                  id="fecha_compra"
                  type="date"
                  value={fechaCompra}
                  onChange={(e) => setFechaCompra(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* Paso 3b: no compró → motivo */}
        {decision === 'attended' && bought === false && (
          <div className="space-y-4 rounded-lg border p-4 bg-amber-50/50">
            <div className="space-y-2">
              <Label>Motivo *</Label>
              <div className="grid gap-2">
                {(Object.keys(NO_SALE_REASON_LABEL) as NoSaleReason[]).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    variant={noSaleReason === k ? 'default' : 'outline'}
                    onClick={() => setNoSaleReason(k)}
                    className="justify-start"
                  >
                    {NO_SALE_REASON_LABEL[k]}
                  </Button>
                ))}
              </div>
            </div>
            {noSaleReason === 'otro' && (
              <div className="space-y-2">
                <Label htmlFor="noSaleText">Especificar motivo *</Label>
                <Textarea
                  id="noSaleText"
                  value={noSaleText}
                  onChange={(e) => setNoSaleText(e.target.value)}
                  rows={3}
                  required
                />
              </div>
            )}
          </div>
        )}

        {/* Notas libres + submit (solo para attended/no_show, no para reschedule que tiene su propio submit) */}
        {(decision === 'attended' || decision === 'no_show') && (
          <>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas adicionales (opcional)</Label>
              <Textarea
                id="notes"
                placeholder="Cualquier detalle relevante..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              type="button"
              size="lg"
              onClick={submitClose}
              disabled={
                pending ||
                (decision === 'attended' && bought === null) ||
                (decision === 'attended' && bought === true && (!modelRaw || !fechaCompra)) ||
                (decision === 'attended' &&
                  bought === false &&
                  (!noSaleReason || (noSaleReason === 'otro' && !noSaleText)))
              }
              className="w-full"
            >
              {pending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
              Guardar y cerrar cita
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
