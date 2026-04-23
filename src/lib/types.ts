export type LeadOrigin =
  | 'META'
  | 'SEO'
  | 'SEM'
  | 'SEO_SEM'
  | 'INSTAGRAM'
  | 'WALK_IN'
  | 'PRESENCE'
  | 'OTHER';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'appointment'
  | 'attended'
  | 'sold'
  | 'lost'
  | 'bad_contact';

export type AppointmentType = 'prueba_moto' | 'concesionario' | 'taller';
export type AppointmentStatus = 'pending' | 'attended' | 'no_show' | 'cancelled';
export type NoSaleReason =
  | 'otro_concesionario_yamaha'
  | 'otra_marca'
  | 'financiacion_rechazada'
  | 'ya_no_quiere'
  | 'otro';
export type CommercialRole = 'comercial' | 'gerente' | 'admin';

export interface Lead {
  id: string;
  sheet_entry_id: string | null;
  sheet_row_hash: string | null;
  bq_queue_id: number | null;
  origen: LeadOrigin;
  formulario: string | null;
  fecha_entrada: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  seleccionar_peticion: string | null;
  mensajes_preferencias: string | null;
  modelo_id: string | null;
  modelo_raw: string | null;
  status: LeadStatus;
  lost_reason: string | null;
  comunicaciones_comerciales: boolean | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface Commercial {
  id: string;
  auth_user_id: string | null;
  name: string;
  display_name: string | null;
  email: string | null;
  role: CommercialRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  lead_id: string;
  commercial_id: string | null;
  tipo: AppointmentType;
  fecha_cita: string;
  status: AppointmentStatus;
  no_show_motivo: string | null;
  notes: string | null;
  attended_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  lead?: Lead;
  commercial?: Commercial;
}

export interface Sale {
  id: string;
  lead_id: string;
  appointment_id: string | null;
  commercial_id: string;
  model_id: string | null;
  model_raw: string | null;
  fecha_compra: string;
  margen_eur: number | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}
