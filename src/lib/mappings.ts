import type {
  AppointmentType,
  AppointmentStatus,
  LeadOrigin,
  LeadStatus,
  NoSaleReason,
} from './types';

export const ORIGIN_LABEL: Record<LeadOrigin, string> = {
  META: 'Meta Ads',
  SEO: 'SEO',
  SEM: 'SEM',
  SEO_SEM: 'SEO/SEM',
  INSTAGRAM: 'Instagram',
  WALK_IN: 'Walk-in',
  PRESENCE: 'Call Center',
  OTHER: 'Otros',
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  appointment: 'Con cita',
  attended: 'Acudió',
  sold: 'Vendido',
  lost: 'Perdido',
  bad_contact: 'Contacto erróneo',
};

export const LEAD_STATUS_COLOR: Record<LeadStatus, string> = {
  new: 'bg-blue-500',
  contacted: 'bg-sky-500',
  appointment: 'bg-amber-500',
  attended: 'bg-violet-500',
  sold: 'bg-green-500',
  lost: 'bg-zinc-400',
  bad_contact: 'bg-red-500',
};

export const APPT_TYPE_LABEL: Record<AppointmentType, string> = {
  prueba_moto: 'Prueba de moto',
  concesionario: 'Visita concesionario',
  taller: 'Cita de taller',
};

export const APPT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  attended: 'Asistió',
  no_show: 'No asistió',
  cancelled: 'Cancelada',
};

export const APPT_STATUS_COLOR: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-500',
  attended: 'bg-green-500',
  no_show: 'bg-red-500',
  cancelled: 'bg-zinc-400',
};

export const NO_SALE_REASON_LABEL: Record<NoSaleReason, string> = {
  otro_concesionario_yamaha: 'Comprada en otro concesionario Yamaha',
  otra_marca: 'Ha comprado otra marca',
  financiacion_rechazada: 'Financiación rechazada',
  ya_no_quiere: 'Ya no quiere la moto',
  otro: 'Otro motivo',
};
