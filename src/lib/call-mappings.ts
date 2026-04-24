import type { CallResult, NoInterestReason } from './types';

export const CALL_RESULT_LABEL: Record<CallResult, string> = {
  no_contactado: 'No contactado / Sin respuesta',
  no_contesta: 'No contesta',
  contacto_erroneo: 'Contacto erróneo',
  cuelga_al_identificarse: 'Cuelga al identificarse',
  no_interesado: 'No interesado',
  cita_taller: 'Cita de taller',
  cita_concesionario: 'Cita en concesionario',
  cita_prueba_moto: 'Cita prueba de moto',
  quiere_mas_info_concesionario: 'Quiere más información (llama el concesionario)',
  otro: 'Otro',
};

export const NO_INTEREST_REASON_LABEL: Record<NoInterestReason, string> = {
  ya_comprada_otro_sitio: 'Ya la ha comprado en otro sitio',
  precio_alto: 'Precio alto',
  vive_lejos: 'Vive lejos / no quiere desplazarse',
  otra_provincia: 'Es de otra provincia',
  solo_informacion: 'Solo quería información o comparar precios',
  ya_no_quiere: 'Ya no quiere la moto',
};

export const QCODE_TYPE_LABEL: Record<string, string> = {
  'Positive useful': 'Positivo',
  'Negative useful': 'Negativo',
  'Non-useful': 'No útil',
};

export const QCODE_TYPE_COLOR: Record<string, string> = {
  'Positive useful': 'text-green-700 bg-green-50 border-green-200',
  'Negative useful': 'text-amber-700 bg-amber-50 border-amber-200',
  'Non-useful': 'text-slate-600 bg-slate-50 border-slate-200',
};

export function isCitaResult(r: CallResult): boolean {
  return r === 'cita_taller' || r === 'cita_concesionario' || r === 'cita_prueba_moto';
}

export function citaResultToApptType(r: CallResult): 'taller' | 'concesionario' | 'prueba_moto' | null {
  if (r === 'cita_taller') return 'taller';
  if (r === 'cita_concesionario') return 'concesionario';
  if (r === 'cita_prueba_moto') return 'prueba_moto';
  return null;
}
