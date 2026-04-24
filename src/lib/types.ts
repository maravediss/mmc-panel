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
export type CommercialRole = 'comercial' | 'gerente' | 'admin' | 'operadora';

export type CallResult =
  | 'no_contactado'
  | 'no_contesta'
  | 'contacto_erroneo'
  | 'cuelga_al_identificarse'
  | 'no_interesado'
  | 'cita_taller'
  | 'cita_concesionario'
  | 'cita_prueba_moto'
  | 'quiere_mas_info_concesionario'
  | 'otro';

export type NoInterestReason =
  | 'ya_comprada_otro_sitio'
  | 'precio_alto'
  | 'vive_lejos'
  | 'otra_provincia'
  | 'solo_informacion'
  | 'ya_no_quiere';

export interface Call {
  id: string;
  lead_id: string | null;
  bq_log_id: number;
  bq_queue_id: number;
  telefono: string | null;
  telefono_normalized: string | null;
  agent_name: string | null;
  qcode: number | null;
  qcode_description: string | null;
  qcode_type: string | null;
  service_name: string | null;
  load_name: string | null;
  scheduled_datetime: string | null;
  ringing_time_s: number | null;
  talk_time_s: number | null;
  handling_time_s: number | null;
  wait_time_s: number | null;
  hangup_type: string | null;
  station: number | null;
  call_at: string;
  recording_url: string | null;
  created_at: string;
}

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
