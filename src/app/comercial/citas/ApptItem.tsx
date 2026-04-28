'use client';

import Link from 'next/link';
import { format, isToday, isTomorrow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Clock,
  Phone,
  Mail,
  CheckCircle2,
  XCircle,
  Ban,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { APPT_TYPE_LABEL, APPT_STATUS_LABEL } from '@/lib/mappings';

export default function ApptItem({ a }: { a: any }) {
  const d = new Date(a.fecha_cita);
  const isOverdue = a.is_pending_overdue;
  const stColor =
    a.status === 'attended'
      ? 'bg-green-500'
      : a.status === 'no_show'
      ? 'bg-red-500'
      : a.status === 'cancelled'
      ? 'bg-zinc-400'
      : isOverdue
      ? 'bg-amber-500'
      : 'bg-amber-300';

  const isCloseable = a.status === 'pending';

  const dateLabel = isToday(d)
    ? `Hoy · ${format(d, 'HH:mm')}`
    : isTomorrow(d)
    ? `Mañana · ${format(d, 'HH:mm')}`
    : format(d, "d MMM yyyy · HH:mm", { locale: es });

  return (
    <Link
      href={`/comercial/citas/${a.id}/cerrar`}
      className={`block rounded-md border bg-white p-3.5 hover:shadow-sm transition-all ${
        isOverdue ? 'border-amber-300 bg-amber-50/40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{a.lead_nombre}</span>
            <Badge variant="secondary" className="text-[10px]">
              {APPT_TYPE_LABEL[a.tipo as keyof typeof APPT_TYPE_LABEL]}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs">
              <span className={`h-2 w-2 rounded-full ${stColor}`} />
              {isOverdue && a.status === 'pending'
                ? 'Sin cerrar'
                : APPT_STATUS_LABEL[a.status as keyof typeof APPT_STATUS_LABEL]}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {dateLabel}
            </span>
            {a.lead_telefono && (
              <a
                href={`tel:${a.lead_telefono}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:text-ymc-red"
              >
                <Phone className="h-3 w-3" />
                {a.lead_telefono}
              </a>
            )}
            {a.lead_email && (
              <span className="inline-flex items-center gap-1 truncate max-w-[180px]">
                <Mail className="h-3 w-3" />
                <span className="truncate">{a.lead_email}</span>
              </span>
            )}
            {a.modelo_oficial && (
              <span className="inline-flex items-center gap-1">
                · <strong className="text-foreground">{a.modelo_oficial}</strong>
              </span>
            )}
            {a.margen_estimado != null && (
              <span className="inline-flex items-center gap-1 text-foreground font-medium">
                · {(Number(a.margen_estimado) || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isCloseable && (
            <Badge className="bg-ymc-red text-white text-[10px]">
              {isOverdue ? '¡Cerrar ya!' : 'Cerrar'}
            </Badge>
          )}
          {a.status === 'attended' && (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          )}
          {a.status === 'no_show' && <XCircle className="h-4 w-4 text-red-600" />}
          {a.status === 'cancelled' && <Ban className="h-4 w-4 text-zinc-500" />}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </Link>
  );
}
