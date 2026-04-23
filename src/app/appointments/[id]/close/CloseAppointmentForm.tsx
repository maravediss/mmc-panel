'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Check, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NO_SALE_REASON_LABEL } from '@/lib/mappings';
import type { NoSaleReason } from '@/lib/types';

type Step = 'attendance' | 'outcome' | 'details' | 'done';

export default function CloseAppointmentForm({
  appointment,
  existingSale,
  existingNoSale,
  commercialId,
  canEdit,
}: {
  appointment: any;
  existingSale: any;
  existingNoSale: any;
  commercialId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  const startStep: Step =
    appointment.status === 'pending' ? 'attendance' : 'done';

  const [step, setStep] = useState<Step>(startStep);
  const [attended, setAttended] = useState<boolean | null>(
    appointment.status === 'attended' ? true : appointment.status === 'no_show' ? false : null
  );
  const [noShowMotivo, setNoShowMotivo] = useState(appointment.no_show_motivo || '');

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

  if (!canEdit) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Esta cita no está asignada a ti. Pide a un gerente que te la reasigne si necesitas cerrarla.
        </CardContent>
      </Card>
    );
  }

  async function saveAttendance(attendedNow: boolean) {
    setAttended(attendedNow);
    if (!attendedNow) {
      // Update appt directly as no_show, capturar motivo en siguiente paso
      setStep('details');
      return;
    }
    setStep('outcome');
  }

  async function submitAll() {
    startTransition(async () => {
      // 1) Update appointment
      const updateBase: any = {
        notes: notes || null,
        status: attended ? 'attended' : 'no_show',
        attended_at: attended ? new Date().toISOString() : null,
        no_show_motivo: !attended ? noShowMotivo || null : null,
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

      // 2) Si no asistió, no hay más. Listo.
      if (!attended) {
        toast.success('Cita cerrada como No asistió');
        router.push('/');
        router.refresh();
        return;
      }

      // 3) Asistió + compra
      if (bought) {
        // Borrar no_sale si existía
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
        // Asistió + no compra
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

      router.push('/');
      router.refresh();
    });
  }

  // Ya cerrada (vista read-only)
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cerrar cita</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Paso 1: asistencia */}
        <div>
          <Label className="text-base font-medium">¿Acudió el cliente?</Label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Button
              type="button"
              size="lg"
              variant={attended === true ? 'default' : 'outline'}
              onClick={() => saveAttendance(true)}
              className={attended === true ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              <Check className="h-5 w-5 mr-2" /> Sí, acudió
            </Button>
            <Button
              type="button"
              size="lg"
              variant={attended === false ? 'default' : 'outline'}
              onClick={() => saveAttendance(false)}
              className={attended === false ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              <X className="h-5 w-5 mr-2" /> No acudió
            </Button>
          </div>
        </div>

        {/* Paso 2a: no acudió → motivo */}
        {attended === false && (
          <div className="space-y-2">
            <Label htmlFor="no_show_motivo">Motivo de la ausencia</Label>
            <Textarea
              id="no_show_motivo"
              placeholder="Ej: canceló por WhatsApp, no contesta, reprograma..."
              value={noShowMotivo}
              onChange={(e) => setNoShowMotivo(e.target.value)}
              rows={3}
            />
          </div>
        )}

        {/* Paso 2b: acudió → ¿compró? */}
        {attended === true && (
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
        {attended === true && bought === true && (
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
        {attended === true && bought === false && (
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

        {/* Notas libres */}
        {attended !== null && (
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
        )}

        {/* Submit */}
        {attended !== null && (
          <Button
            type="button"
            size="lg"
            onClick={submitAll}
            disabled={
              pending ||
              (attended === true && bought === null) ||
              (attended === true && bought === true && (!modelRaw || !fechaCompra)) ||
              (attended === true &&
                bought === false &&
                (!noSaleReason || (noSaleReason === 'otro' && !noSaleText)))
            }
            className="w-full"
          >
            {pending && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
            Guardar y cerrar cita
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
