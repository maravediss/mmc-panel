import Link from 'next/link';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, Clock, User, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { APPT_TYPE_LABEL, APPT_STATUS_LABEL, APPT_STATUS_COLOR } from '@/lib/mappings';
import type { Appointment, Lead, Commercial } from '@/lib/types';

type AppointmentRow = Appointment & {
  lead: Pick<Lead, 'id' | 'nombre' | 'modelo_raw' | 'telefono' | 'email'>;
  commercial: Pick<Commercial, 'id' | 'name'> | null;
};

export default async function HomePage() {
  const commercial = await getCurrentCommercial();
  const supabase = createClient();

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

  const isManager = commercial.role === 'admin' || commercial.role === 'gerente';

  const { data: upcoming } = await supabase
    .from('mmc_appointments')
    .select(
      'id, tipo, fecha_cita, status, commercial_id, lead:mmc_leads!inner(id, nombre, modelo_raw, telefono, email), commercial:mmc_commercials(id, name)'
    )
    .eq('status', 'pending')
    .gte('fecha_cita', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('fecha_cita', { ascending: true })
    .limit(100);

  const { data: overdue } = await supabase
    .from('mmc_appointments')
    .select(
      'id, tipo, fecha_cita, status, commercial_id, lead:mmc_leads!inner(id, nombre, modelo_raw, telefono, email), commercial:mmc_commercials(id, name)'
    )
    .eq('status', 'pending')
    .lt('fecha_cita', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('fecha_cita', { ascending: false })
    .limit(50);

  const all = (upcoming ?? []) as unknown as AppointmentRow[];
  const pendingOverdue = (overdue ?? []) as unknown as AppointmentRow[];

  const todayAppts = all.filter((a) => isToday(new Date(a.fecha_cita)));
  const tomorrowAppts = all.filter((a) => isTomorrow(new Date(a.fecha_cita)));
  const futureAppts = all.filter(
    (a) =>
      !isToday(new Date(a.fecha_cita)) &&
      !isTomorrow(new Date(a.fecha_cita)) &&
      !isPast(new Date(a.fecha_cita))
  );

  return (
    <AppShell commercial={commercial}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">
          Hola, {commercial.display_name || commercial.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isManager ? 'Vista global de citas' : 'Tus citas'}
        </p>
      </header>

      {pendingOverdue.length > 0 && (
        <Section
          title={`⚠️ Pendientes de cerrar (${pendingOverdue.length})`}
          appointments={pendingOverdue}
          accent="red"
        />
      )}

      <Section
        title={`Hoy (${todayAppts.length})`}
        emptyMessage="No hay citas hoy."
        appointments={todayAppts}
      />

      <Section
        title={`Mañana (${tomorrowAppts.length})`}
        emptyMessage="No hay citas mañana."
        appointments={tomorrowAppts}
      />

      <Section
        title={`Próximas (${futureAppts.length})`}
        emptyMessage="No hay más citas programadas."
        appointments={futureAppts}
      />
    </AppShell>
  );
}

function Section({
  title,
  emptyMessage,
  appointments,
  accent,
}: {
  title: string;
  emptyMessage?: string;
  appointments: AppointmentRow[];
  accent?: 'red';
}) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-medium mb-3">{title}</h2>
      {appointments.length === 0 ? (
        emptyMessage && (
          <p className="text-sm text-muted-foreground bg-white border rounded-md px-4 py-3">
            {emptyMessage}
          </p>
        )
      ) : (
        <div className="space-y-2">
          {appointments.map((a) => (
            <AppointmentCard key={a.id} appt={a} accent={accent} />
          ))}
        </div>
      )}
    </section>
  );
}

function AppointmentCard({ appt, accent }: { appt: AppointmentRow; accent?: 'red' }) {
  const d = new Date(appt.fecha_cita);
  const isOverdue = isPast(d) && appt.status === 'pending';
  return (
    <Link
      href={`/appointments/${appt.id}/close`}
      className={`block bg-white border rounded-md px-4 py-3 hover:shadow-sm transition ${
        accent === 'red' || isOverdue ? 'border-red-200' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{appt.lead?.nombre ?? '—'}</span>
            <Badge variant="secondary">{APPT_TYPE_LABEL[appt.tipo]}</Badge>
            {appt.commercial && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {appt.commercial.name}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-muted-foreground inline-flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {format(d, "d 'de' MMMM", { locale: es })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {format(d, 'HH:mm')}
            </span>
            {appt.lead?.modelo_raw && <span>· {appt.lead.modelo_raw}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className={`h-2 w-2 rounded-full ${APPT_STATUS_COLOR[appt.status]}`} />
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {APPT_STATUS_LABEL[appt.status]}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
