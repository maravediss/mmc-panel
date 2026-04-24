'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  ArrowLeft, Phone, Mail, Calendar, User, Bike, Headphones,
  CheckCircle2, TrendingUp, MessageSquare, MapPin, Hash,
  Smartphone, Loader2, ArrowRight, XCircle, AlertCircle,
  BarChart3,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ORIGIN_LABEL, APPT_TYPE_LABEL, APPT_STATUS_LABEL, APPT_STATUS_COLOR,
} from '@/lib/mappings';
import {
  CALL_RESULT_LABEL, NO_INTEREST_REASON_LABEL,
  QCODE_TYPE_COLOR, QCODE_TYPE_LABEL,
} from '@/lib/call-mappings';
import type { LeadOrigin, AppointmentType, AppointmentStatus, NoInterestReason, CallResult } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadFull = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  telefono2: string | null;
  direccion: string | null;
  codigo_postal: string | null;
  provincia: string | null;
  tipo_interes: string | null;
  modelo_id: string | null;
  modelo_raw: string | null;
  origen: string;
  formulario: string | null;
  fecha_entrada: string;
  status: string;
  lost_reason: string | null;
  mensajes_preferencias: string | null;
  seleccionar_peticion: string | null;
  bq_total_attempts: number | null;
  bq_no_answer_counter: number | null;
  bq_busy_counter: number | null;
  bq_last_agent: string | null;
  bq_last_qcode: string | null;
  bq_optn_resultado: string | null;
  bq_last_call_at: string | null;
};

type ModeloInfo = { id: string; name: string; family: string; cc: number | null } | null;

type TLEvent =
  | { kind: 'entry'; date: string }
  | { kind: 'call'; date: string; data: any }
  | { kind: 'report'; date: string; data: any };

interface Props {
  lead: LeadFull;
  modelo: ModeloInfo;
  margenEstimado: number | null;
  calls: any[];
  appointments: any[];
  sales: any[];
  reports: any[];
  models: { id: string; name: string; family: string }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PROVINCIAS = [
  'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila', 'Badajoz', 'Barcelona',
  'Burgos', 'Cáceres', 'Cádiz', 'Cantabria', 'Castellón', 'Ciudad Real', 'Córdoba',
  'Cuenca', 'Girona', 'Granada', 'Guadalajara', 'Guipúzcoa', 'Huelva', 'Huesca',
  'Illes Balears', 'Jaén', 'La Coruña', 'La Rioja', 'Las Palmas', 'León', 'Lleida',
  'Lugo', 'Madrid', 'Málaga', 'Murcia', 'Navarra', 'Ourense', 'Palencia', 'Pontevedra',
  'Salamanca', 'Santa Cruz de Tenerife', 'Segovia', 'Sevilla', 'Soria', 'Tarragona',
  'Teruel', 'Toledo', 'Valencia', 'Valladolid', 'Vizcaya', 'Zamora', 'Zaragoza',
];

const TIPO_INTERES_OPTIONS = ['Quiere moto nueva', 'Quiere cita taller'];

const STATUS_CONFIG: Record<string, {
  label: string; dot: string; bg: string; text: string; border: string;
  icon: React.ReactNode;
}> = {
  new:         { label: 'Nuevo',             dot: 'bg-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   icon: <User className="h-4 w-4" /> },
  contacted:   { label: 'Contactado',        dot: 'bg-sky-500',    bg: 'bg-sky-50',    text: 'text-sky-700',    border: 'border-sky-200',    icon: <Phone className="h-4 w-4" /> },
  appointment: { label: 'Con cita',          dot: 'bg-amber-500',  bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  icon: <Calendar className="h-4 w-4" /> },
  attended:    { label: 'Acudió',            dot: 'bg-violet-500', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', icon: <CheckCircle2 className="h-4 w-4" /> },
  sold:        { label: 'Vendido',           dot: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  icon: <TrendingUp className="h-4 w-4" /> },
  lost:        { label: 'No interesado',     dot: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    icon: <XCircle className="h-4 w-4" /> },
  bad_contact: { label: 'Contacto erróneo',  dot: 'bg-red-400',    bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-200',    icon: <AlertCircle className="h-4 w-4" /> },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildDiffUpdates(
  lead: LeadFull,
  f: { fNombre: string; fTel: string; fEmail: string; fTel2: string; fDireccion: string; fCodPostal: string; fProvincia: string; fTipoInteres: string; fModeloId: string }
): Record<string, string | null> {
  const u: Record<string, string | null> = {};
  if (f.fNombre    !== (lead.nombre       ?? ''))              u.nombre        = f.fNombre    || lead.nombre;
  if (f.fTel       !== (lead.telefono     ?? ''))              u.telefono      = f.fTel       || null;
  if (f.fEmail     !== (lead.email        ?? ''))              u.email         = f.fEmail     || null;
  if (f.fTel2      !== (lead.telefono2    ?? ''))              u.telefono2     = f.fTel2      || null;
  if (f.fDireccion !== (lead.direccion    ?? ''))              u.direccion     = f.fDireccion || null;
  if (f.fCodPostal !== (lead.codigo_postal ?? ''))             u.codigo_postal = f.fCodPostal || null;
  if (f.fProvincia !== (lead.provincia    ?? 'Málaga'))        u.provincia     = f.fProvincia;
  if (f.fTipoInteres !== (lead.tipo_interes ?? 'Quiere moto nueva')) u.tipo_interes = f.fTipoInteres || null;
  if (f.fModeloId  !== (lead.modelo_id    ?? ''))              u.modelo_id     = f.fModeloId  || null;
  return u;
}

function friendlyResult(r: string | null): string {
  if (!r) return '—';
  return r.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function formatDuration(s: number): string {
  if (!s) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function entryHasTime(raw: string): boolean {
  const d = new Date(raw);
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ icon, label, value, onChange, type = 'text', className = '' }: {
  icon: React.ReactNode; label: string; value: string;
  onChange: (v: string) => void; type?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        <span className="text-ymc-red">{icon}</span>{label}
      </Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} className="h-9 text-sm" />
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold text-sm text-right">{value}</span>
    </div>
  );
}

function ModelCombobox({
  models, value, onChange,
}: { models: { id: string; name: string; family: string }[]; value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const selected = sorted.find(m => m.id === value);

  useEffect(() => { if (selected) setQuery(selected.name); else if (!value) setQuery(''); }, [value]);
  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = query.trim()
    ? sorted.filter(m => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 14)
    : sorted.slice(0, 14);

  return (
    <div ref={ref} className="relative">
      <Input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange('', ''); }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar modelo..."
        className="h-9 text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 rounded-xl border bg-white shadow-lg max-h-60 overflow-y-auto">
          {filtered.map(m => (
            <button key={m.id} onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(m.id, m.name); setQuery(m.name); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${value === m.id ? 'bg-ymc-redLight text-ymc-red font-medium' : ''}`}>
              <span>{m.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{m.family}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineItem({ ev }: { ev: TLEvent }) {
  const dotCls = (() => {
    if (ev.kind === 'entry')  return 'bg-slate-400 ring-slate-100';
    if (ev.kind === 'report') return 'bg-ymc-red ring-red-100';
    if (ev.kind === 'call')   return (ev.data.talk_time_s ?? 0) > 0 ? 'bg-green-400 ring-green-100' : 'bg-slate-200 ring-slate-50';
    return 'bg-slate-300 ring-slate-100';
  })();

  return (
    <>
      <span className={`absolute -left-[33px] top-1.5 h-3 w-3 rounded-full ring-4 ${dotCls}`} />
      {ev.kind === 'entry' && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-0.5">Entrada como lead</div>
          <div className="text-sm font-medium text-slate-800">
            {format(new Date(ev.date), "EEEE d 'de' MMMM yyyy", { locale: es })}
            {entryHasTime(ev.date) && (
              <span className="text-muted-foreground"> · {format(new Date(ev.date), 'HH:mm')}</span>
            )}
          </div>
        </div>
      )}

      {ev.kind === 'call' && (() => {
        const c = ev.data;
        const answered = (c.talk_time_s ?? 0) > 0;
        return (
          <div>
            <div className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${answered ? 'text-green-600' : 'text-slate-400'}`}>
              {answered ? 'Llamada contestada' : 'Sin respuesta'}
            </div>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm text-slate-700">
                {format(new Date(c.call_at), "d MMM · HH:mm", { locale: es })}
                {c.agent_name && <span className="text-muted-foreground"> · {c.agent_name}</span>}
                {answered && <span className="text-green-700 font-semibold"> · {formatDuration(c.talk_time_s)}</span>}
                {c.hangup_type && (
                  <span className="text-muted-foreground text-xs"> · colgó {c.hangup_type === 'Agent' ? 'operadora' : 'cliente'}</span>
                )}
              </div>
              {c.qcode_type && (
                <span className={`text-xs px-2 py-0.5 rounded-md border shrink-0 ${QCODE_TYPE_COLOR[c.qcode_type] ?? 'bg-slate-50 border-slate-200'}`}>
                  {c.qcode_description || QCODE_TYPE_LABEL[c.qcode_type] || c.qcode_type}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {ev.kind === 'report' && (() => {
        const r = ev.data;
        const resultLabel = CALL_RESULT_LABEL[r.call_result as CallResult] ?? r.call_result;
        const noIntLabel = r.no_interest_reason
          ? (NO_INTEREST_REASON_LABEL[r.no_interest_reason as NoInterestReason] ?? r.no_interest_reason)
          : null;
        return (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-ymc-red mb-0.5">Reporte operadora</div>
            <div className="text-sm text-slate-700">
              {format(new Date(r.created_at), "d MMM · HH:mm", { locale: es })}
              {r.operator?.name && <span className="text-muted-foreground"> · {r.operator.name}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="text-xs">{resultLabel}</Badge>
              {noIntLabel && (
                <Badge variant="secondary" className="text-xs bg-red-50 text-red-700 border-red-100">{noIntLabel}</Badge>
              )}
            </div>
            {r.observaciones && (
              <p className="text-xs text-muted-foreground mt-1 italic">"{r.observaciones}"</p>
            )}
          </div>
        );
      })()}

    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LeadDetailClient({
  lead: initialLead,
  modelo: initialModelo,
  margenEstimado: initialMargen,
  calls,
  appointments,
  sales,
  reports,
  models,
}: Props) {
  const supabase = createClient();

  const [lead, setLead] = useState(initialLead);
  const [modelo, setModelo] = useState(initialModelo);
  const [margenEstimado, setMargenEstimado] = useState(initialMargen);

  // Editable fields
  const [fNombre,     setFNombre]     = useState(initialLead.nombre        ?? '');
  const [fTel,        setFTel]        = useState(initialLead.telefono       ?? '');
  const [fEmail,      setFEmail]      = useState(initialLead.email          ?? '');
  const [fTel2,       setFTel2]       = useState(initialLead.telefono2      ?? '');
  const [fDireccion,  setFDireccion]  = useState(initialLead.direccion      ?? '');
  const [fCodPostal,  setFCodPostal]  = useState(initialLead.codigo_postal  ?? '');
  const [fProvincia,  setFProvincia]  = useState(initialLead.provincia      ?? 'Málaga');
  const [fTipoInteres,setFTipoInteres]= useState(initialLead.tipo_interes   ?? 'Quiere moto nueva');
  const [fModeloId,   setFModeloId]   = useState(initialLead.modelo_id      ?? '');
  const [, setFModeloName]            = useState(initialModelo?.name        ?? '');

  const [saving,  setSaving]  = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  function currentFields() {
    return { fNombre, fTel, fEmail, fTel2, fDireccion, fCodPostal, fProvincia, fTipoInteres, fModeloId };
  }

  const isDirty = Object.keys(buildDiffUpdates(lead, currentFields())).length > 0;

  useEffect(() => { if (savedOk) setSavedOk(false); },
    [fNombre, fTel, fEmail, fTel2, fDireccion, fCodPostal, fProvincia, fTipoInteres, fModeloId]); // eslint-disable-line

  async function handleSave() {
    if (!isDirty) return;
    setSaving(true);
    const updates = buildDiffUpdates(lead, currentFields());
    const { error } = await supabase.from('mmc_leads').update(updates).eq('id', lead.id);
    setSaving(false);
    if (error) {
      toast.error('Error al guardar', { description: error.message });
    } else {
      setLead(prev => ({ ...prev, ...updates } as LeadFull));
      if ('modelo_id' in updates) {
        if (updates.modelo_id) {
          const newM = models.find(m => m.id === updates.modelo_id);
          if (newM) setModelo({ ...newM, cc: null });
          const { data: mg } = await supabase
            .from('mmc_model_margins').select('margin_eur').eq('model_id', updates.modelo_id)
            .order('year', { ascending: false }).limit(1).maybeSingle();
          setMargenEstimado(mg ? Number(mg.margin_eur) : null);
        } else {
          setModelo(null);
          setMargenEstimado(null);
        }
      }
      setSavedOk(true);
    }
  }

  const statusCfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;

  const noInterestLabel = lead.lost_reason
    ? (NO_INTEREST_REASON_LABEL[lead.lost_reason as NoInterestReason] ?? friendlyResult(lead.lost_reason))
    : null;

  // Timeline: solo entrada + llamadas + reportes (citas/ventas ya están en sidebar)
  const MIN_VALID = new Date('2020-01-01').getTime();
  const tlEvents: TLEvent[] = [
    { kind: 'entry' as const, date: lead.fecha_entrada },
    ...calls.map(c => ({ kind: 'call' as const, date: c.call_at, data: c })),
    ...reports.map(r => ({ kind: 'report' as const, date: r.created_at, data: r })),
  ]
    .filter(e => new Date(e.date).getTime() >= MIN_VALID)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const hasPresence = lead.bq_total_attempts != null || !!lead.bq_last_agent;

  return (
    <div>
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5">
        <ArrowLeft className="h-4 w-4" />
        Volver a leads
      </Link>

      {/* ── Header ── */}
      <div className="rounded-2xl overflow-hidden shadow-sm border border-slate-200 mb-6">
        {/* Color strip by status */}
        <div className={`px-6 py-5 ${statusCfg.bg}`}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">{lead.nombre}</h1>
              <div className="flex flex-wrap items-center gap-2">
                {/* Status pill */}
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
                  <span className={`h-2 w-2 rounded-full ${statusCfg.dot}`} />
                  {statusCfg.label}
                </span>
                {/* Canal de entrada */}
                {lead.origen && (
                  <Badge variant="secondary" className="font-normal text-xs">
                    {ORIGIN_LABEL[lead.origen as LeadOrigin] ?? lead.origen}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  · lead desde {format(new Date(lead.fecha_entrada), "d MMM yyyy", { locale: es })}
                </span>
              </div>
            </div>
            {/* Moto + margen */}
            <div className="text-right shrink-0">
              {(modelo?.name || lead.modelo_raw) && (
                <div className="flex items-center justify-end gap-2 mb-1">
                  <Bike className="h-5 w-5 text-ymc-red shrink-0" />
                  <span className="font-bold text-base text-slate-800">{modelo?.name || lead.modelo_raw}</span>
                </div>
              )}
              {margenEstimado != null && (
                <div className="text-sm font-bold text-ymc-red">
                  Margen est.: {margenEstimado.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €
                </div>
              )}
              {modelo?.name && lead.modelo_raw && modelo.name !== lead.modelo_raw && (
                <div className="text-[10px] text-muted-foreground italic mt-0.5">
                  form: "{lead.modelo_raw}"
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Motivo no interesado (solo si lost) */}
        {lead.status === 'lost' && noInterestLabel && (
          <div className="px-6 py-3 bg-red-50 border-t border-red-100 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            <span className="text-sm text-red-700">
              <span className="font-semibold">Motivo:</span> {noInterestLabel}
            </span>
          </div>
        )}

        {/* Mensaje libre del cliente */}
        {lead.mensajes_preferencias && (
          <div className="px-6 py-3 bg-white border-t flex items-start gap-2 text-sm text-muted-foreground">
            <MessageSquare className="h-4 w-4 shrink-0 mt-0.5 text-ymc-red" />
            <em>"{lead.mensajes_preferencias}"</em>
          </div>
        )}
      </div>

      {/* ── Grid principal ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Columna izquierda: datos editables + timeline */}
        <div className="lg:col-span-3 space-y-6">

          {/* Datos personales editables */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <div className="h-1 w-6 bg-ymc-red rounded-full shrink-0" />
                Datos del cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field icon={<User className="h-4 w-4" />} label="Nombre" value={fNombre} onChange={setFNombre} />
                <Field icon={<Phone className="h-4 w-4" />} label="Teléfono" value={fTel} onChange={setFTel} type="tel" />
                <Field icon={<Mail className="h-4 w-4" />} label="Email" value={fEmail} onChange={setFEmail} type="email" />
                <Field icon={<Smartphone className="h-4 w-4" />} label="Teléfono 2 (opcional)" value={fTel2} onChange={setFTel2} type="tel" />
                <Field icon={<MapPin className="h-4 w-4" />} label="Dirección (opcional)" value={fDireccion} onChange={setFDireccion} className="sm:col-span-2" />
                <Field icon={<Hash className="h-4 w-4" />} label="Código postal" value={fCodPostal} onChange={setFCodPostal} />
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="text-ymc-red"><MapPin className="h-4 w-4 inline" /></span>Provincia
                  </Label>
                  <select value={fProvincia} onChange={e => setFProvincia(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:border-ymc-red focus:outline-none">
                    {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              {/* Interés del cliente */}
              <div className="rounded-xl bg-slate-50 p-4 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Interés del cliente</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tipo de interés</Label>
                    <select value={fTipoInteres} onChange={e => setFTipoInteres(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:border-ymc-red focus:outline-none">
                      {TIPO_INTERES_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Bike className="h-3 w-3 text-ymc-red" />Modelo de interés
                    </Label>
                    <ModelCombobox models={models} value={fModeloId}
                      onChange={(id, name) => { setFModeloId(id); setFModeloName(name); }} />
                  </div>
                </div>
                {lead.seleccionar_peticion && (
                  <p className="text-xs text-muted-foreground">Petición: {lead.seleccionar_peticion}</p>
                )}
              </div>

              {/* Botón guardar */}
              <div className="space-y-2">
                <button onClick={handleSave} disabled={!isDirty || saving}
                  className="group w-full flex items-center justify-between gap-4 rounded-full px-7 py-4 font-bold uppercase tracking-widest text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-black text-white hover:bg-ymc-red">
                  <span>{saving ? 'Guardando...' : 'Guardar cambios'}</span>
                  {saving
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    : <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />}
                </button>
                {savedOk && (
                  <p className="text-center text-sm text-green-700 font-medium flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" /> Cambios guardados correctamente.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Timeline unificado */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <Headphones className="h-4 w-4 text-ymc-red" />
                Historial completo
                <span className="ml-1 text-sm font-normal text-muted-foreground">({tlEvents.length} eventos)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tlEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Sin actividad registrada.</p>
              ) : (
                <ol className="relative border-l-2 border-slate-100 pl-6 ml-2 space-y-5">
                  {tlEvents.map((ev, i) => (
                    <li key={i} className="relative">
                      <TimelineItem ev={ev} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Columna derecha: citas + ventas + estadísticas */}
        <div className="lg:col-span-2 space-y-6">

          {/* Citas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base flex items-center gap-2">
                <Calendar className="h-4 w-4 text-ymc-red" />
                Citas
                <span className="ml-1 text-sm font-normal text-muted-foreground">({appointments.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin citas programadas.</p>
              ) : (
                appointments.map((a: any) => (
                  <Link key={a.id} href={`/appointments/${a.id}/close`}
                    className="block rounded-xl border p-3 hover:shadow-sm hover:border-ymc-red/30 transition">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm text-slate-800">
                        {APPT_TYPE_LABEL[a.tipo as AppointmentType]}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs">
                        <span className={`h-2 w-2 rounded-full ${APPT_STATUS_COLOR[a.status as AppointmentStatus]}`} />
                        {APPT_STATUS_LABEL[a.status as AppointmentStatus]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(a.fecha_cita), "EEEE d 'de' MMMM 'a las' HH:mm", { locale: es })}
                    </div>
                    {a.commercial && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <User className="h-3 w-3" /> {a.commercial.name}
                      </div>
                    )}
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Ventas */}
          {sales.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Ventas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {sales.map((s: any) => (
                  <div key={s.id} className="rounded-xl border border-green-100 bg-green-50 p-3">
                    <div className="font-semibold text-sm text-green-800">{s.model_raw ?? '—'}</div>
                    <div className="text-xs text-green-700 mt-0.5">
                      {format(new Date(s.fecha_compra), "d MMM yyyy", { locale: es })}
                      {s.margen_eur && ` · ${Number(s.margen_eur).toFixed(0)} € margen`}
                      {s.commercial && ` · ${s.commercial.name}`}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Estadísticas de llamada */}
          {hasPresence && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-ymc-red" />
                  Estadísticas de llamada
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lead.bq_total_attempts != null && (
                  <StatRow label="Intentos totales" value={String(lead.bq_total_attempts)} />
                )}
                {lead.bq_no_answer_counter != null && (
                  <StatRow label="Sin respuesta" value={String(lead.bq_no_answer_counter)} />
                )}
                {lead.bq_busy_counter != null && (
                  <StatRow label="Comunicando" value={String(lead.bq_busy_counter)} />
                )}
                {lead.bq_last_call_at && (
                  <StatRow label="Última llamada"
                    value={format(new Date(lead.bq_last_call_at), "d MMM yyyy · HH:mm", { locale: es })} />
                )}
                {lead.bq_last_agent && (
                  <StatRow label="Última operadora" value={lead.bq_last_agent} />
                )}
                {lead.bq_optn_resultado && (
                  <StatRow label="Resultado" value={friendlyResult(lead.bq_optn_resultado)} />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
