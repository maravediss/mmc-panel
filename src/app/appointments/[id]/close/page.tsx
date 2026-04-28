import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowLeft, Calendar, Clock, Mail, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CloseAppointmentForm from './CloseAppointmentForm';
import { APPT_TYPE_LABEL, APPT_STATUS_LABEL, APPT_STATUS_COLOR } from '@/lib/mappings';

export default async function CloseAppointmentPage({
  params,
}: {
  params: { id: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  const supabase = createClient();
  const { data: appt } = await supabase
    .from('mmc_appointments')
    .select(
      'id, tipo, fecha_cita, status, commercial_id, notes, no_show_motivo, lead:mmc_leads!inner(id, nombre, email, telefono, modelo_raw, mensajes_preferencias, origen, formulario), commercial:mmc_commercials(id, name)'
    )
    .eq('id', params.id)
    .maybeSingle();

  if (!appt) notFound();

  const lead = (appt as any).lead;
  const assigned = (appt as any).commercial;

  const { data: sale } = await supabase
    .from('mmc_sales')
    .select('*')
    .eq('appointment_id', appt.id)
    .maybeSingle();

  const { data: noSale } = await supabase
    .from('mmc_no_sale_reasons')
    .select('*')
    .eq('appointment_id', appt.id)
    .maybeSingle();

  const { data: comerciales } = await supabase
    .from('mmc_commercials')
    .select('id, name, display_name, role')
    .eq('is_active', true)
    .in('role', ['comercial', 'gerente', 'admin'])
    .order('name');

  const d = new Date(appt.fecha_cita);

  return (
    <AppShell commercial={commercial}>
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-xl">{lead.nombre}</CardTitle>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{APPT_TYPE_LABEL[appt.tipo as keyof typeof APPT_TYPE_LABEL]}</Badge>
                <span className={`inline-flex items-center gap-1.5 text-xs`}>
                  <span className={`h-2 w-2 rounded-full ${APPT_STATUS_COLOR[appt.status as keyof typeof APPT_STATUS_COLOR]}`} />
                  {APPT_STATUS_LABEL[appt.status as keyof typeof APPT_STATUS_LABEL]}
                </span>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="inline-flex items-center gap-1 text-foreground">
                <Calendar className="h-4 w-4" />
                {format(d, "d 'de' MMMM yyyy", { locale: es })}
              </div>
              <div className="inline-flex items-center gap-1 text-muted-foreground mt-0.5">
                <Clock className="h-3.5 w-3.5" />
                {format(d, 'HH:mm')}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {lead.telefono && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <a href={`tel:${lead.telefono}`} className="hover:underline">
                {lead.telefono}
              </a>
            </div>
          )}
          {lead.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <a href={`mailto:${lead.email}`} className="hover:underline">
                {lead.email}
              </a>
            </div>
          )}
          {lead.modelo_raw && (
            <div className="text-muted-foreground">
              <span className="text-foreground font-medium">Modelo de interés:</span>{' '}
              {lead.modelo_raw}
            </div>
          )}
          {lead.mensajes_preferencias && (
            <div className="text-muted-foreground">
              <span className="text-foreground font-medium">Mensaje del cliente:</span>{' '}
              {lead.mensajes_preferencias}
            </div>
          )}
          {assigned && (
            <div className="text-muted-foreground">
              <span className="text-foreground font-medium">Comercial asignado:</span>{' '}
              {assigned.name}
            </div>
          )}
        </CardContent>
      </Card>

      <CloseAppointmentForm
        appointment={appt as any}
        existingSale={sale as any}
        existingNoSale={noSale as any}
        commercialId={commercial.id}
        canEdit={
          commercial.role !== 'comercial' ||
          appt.commercial_id === commercial.id
        }
        comerciales={(comerciales ?? []) as any}
      />
    </AppShell>
  );
}
