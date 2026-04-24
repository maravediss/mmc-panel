'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import Link from 'next/link';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  Search, Phone, Mail, Bike, ArrowLeft, ChevronRight,
  Edit2, CheckCircle2, ExternalLink,
  MapPin, Hash, Smartphone, User, Loader2, AlertCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { NoInterestReason } from '@/lib/types';
import { citaResultToApptType } from '@/lib/call-mappings';

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'search' | 'lead' | 'cita' | 'no_interesado' | 'confirm' | 'done';
type CitaTipo = 'prueba_moto' | 'concesionario' | 'taller';

type Lead = {
  id: string; nombre: string; email: string | null; telefono: string | null;
  telefono2: string | null; direccion: string | null; codigo_postal: string | null;
  modelo_raw: string | null; modelo_id: string | null; formulario: string | null;
  mensajes_preferencias: string | null; seleccionar_peticion: string | null;
  fecha_entrada: string; status: string;
  bq_total_attempts: number | null; bq_last_call_at: string | null; bq_last_agent: string | null;
  provincia: string | null; tipo_interes: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const CITA_TIPOS: { value: CitaTipo; label: string; emoji: string; desc: string }[] = [
  { value: 'prueba_moto',    label: 'Prueba de moto',         emoji: '🏍️', desc: 'El cliente quiere probar una moto' },
  { value: 'concesionario',  label: 'Visita al concesionario', emoji: '🏪', desc: 'Visita sin prueba, para ver modelos' },
  { value: 'taller',         label: 'Cita de taller',          emoji: '🔧', desc: 'Reparación o mantenimiento' },
];

const NO_INT_REASONS: { value: NoInterestReason; label: string; emoji: string }[] = [
  { value: 'ya_comprada_otro_sitio', label: 'Ya la ha comprado en otro sitio',              emoji: '🛒' },
  { value: 'precio_alto',            label: 'Precio alto',                                   emoji: '💰' },
  { value: 'vive_lejos',             label: 'Vive lejos / no quiere desplazarse',            emoji: '📍' },
  { value: 'otra_provincia',         label: 'Es de otra provincia',                          emoji: '🗺️' },
  { value: 'solo_informacion',       label: 'Solo quería información o comparar precios',    emoji: 'ℹ️' },
  { value: 'ya_no_quiere',           label: 'Ya no quiere la moto',                          emoji: '🚫' },
];

const MORNING = ['09:00', '10:00', '11:00', '12:00', '13:00'];
const AFTERNOON = ['16:00', '17:00', '18:00', '19:00'];

const DONE_CITA = [
  (name: string) => `¡Enhorabuena! ${name} vendrá a conocer la moto de sus sueños gracias a ti.`,
  () => '¡Cita anotada! Así es como se trabaja. ¡Sigue así!',
  () => '¡Ahí está! Cada cita es un paso hacia el cierre. Eres la clave de este proceso.',
];
const DONE_NO = [
  () => 'No todas terminan en cita, y eso es completamente normal. Lo has gestionado perfectamente. ¡A por la siguiente!',
  () => 'Un "no" hoy puede ser un "sí" mañana. Lo importante es haber hecho el contacto con profesionalismo.',
  () => 'Tranquila, forma parte del proceso. Ya viene la siguiente oportunidad. ¡Tú puedes!',
];

const PROVINCIAS = [
  'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila', 'Badajoz', 'Barcelona',
  'Burgos', 'Cáceres', 'Cádiz', 'Cantabria', 'Castellón', 'Ciudad Real', 'Córdoba',
  'Cuenca', 'Girona', 'Granada', 'Guadalajara', 'Guipúzcoa', 'Huelva', 'Huesca',
  'Illes Balears', 'Jaén', 'La Coruña', 'La Rioja', 'Las Palmas', 'León', 'Lleida',
  'Lugo', 'Madrid', 'Málaga', 'Murcia', 'Navarra', 'Ourense', 'Palencia', 'Pontevedra',
  'Salamanca', 'Santa Cruz de Tenerife', 'Segovia', 'Sevilla', 'Soria', 'Tarragona',
  'Teruel', 'Toledo', 'Valencia', 'Valladolid', 'Vizcaya', 'Zamora', 'Zaragoza',
];

function getWorkingDays(n = 14): Date[] {
  const days: Date[] = [];
  let d = addDays(new Date(), 1);
  while (days.length < n) {
    if (d.getDay() !== 0) days.push(new Date(d));
    d = addDays(d, 1);
  }
  return days;
}

function formatFechaEntrada(raw: string): string {
  const d = new Date(raw);
  const h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  const hasTime = h !== 0 || m !== 0 || s !== 0;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  if (!hasTime) return `${dd}/${mm}/${yyyy}`;
  const HH = String(h).padStart(2, '0');
  const MM = String(m).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}

function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/[\s\-\+\(\)]/g, '').replace(/[^0-9]/g, '');
  return digits.length >= 6 && raw.replace(/[^0-9]/g, '').length >= 6;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepBack({ onClick, label = 'Volver' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-bold mb-4">{children}</h2>;
}

// Model combobox with predictive search
function ModelCombobox({
  models,
  value,
  onChange,
}: {
  models: { id: string; name: string; family: string }[];
  value: string;
  onChange: (id: string, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedModel = models.find(m => m.id === value);

  useEffect(() => {
    if (selectedModel) setQuery(selectedModel.name);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = query.trim()
    ? models.filter(m => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12)
    : models.slice(0, 12);

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
            <button
              key={m.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(m.id, m.name); setQuery(m.name); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${value === m.id ? 'bg-ymc-redLight text-ymc-red font-medium' : ''}`}
            >
              <span>{m.name}</span>
              <span className="text-xs text-muted-foreground capitalize">{m.family}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OperatorWorkspace({
  commercial,
  models,
  comerciales,
}: {
  commercial: { id: string; name: string; display_name: string | null; role: string };
  models: { id: string; name: string; family: string }[];
  comerciales: { id: string; name: string; role: string }[];
}) {
  const supabase = createClient();
  const [pending, startTransition] = useTransition();

  // Navigation
  const [step, setStep] = useState<Step>('search');

  // Search
  const [tel, setTel] = useState('');
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [invalidPhone, setInvalidPhone] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null);
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [firstCallAt, setFirstCallAt] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Editable lead fields
  const [fNombre, setFNombre] = useState('');
  const [fTel, setFTel] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fTel2, setFTel2] = useState('');
  const [fDireccion, setFDireccion] = useState('');
  const [fCodPostal, setFCodPostal] = useState('');
  const [fProvincia, setFProvincia] = useState('Málaga');
  const [fTipoInteres, setFTipoInteres] = useState('Quiere moto nueva');
  const [fLeadModeloId, setFLeadModeloId] = useState('');
  const [fLeadModeloName, setFLeadModeloName] = useState('');

  // Cita
  const [citaTipo, setCitaTipo] = useState<CitaTipo | null>(null);
  const [citaModeloId, setCitaModeloId] = useState('');
  const [citaDate, setCitaDate] = useState<Date | null>(null);
  const [citaTime, setCitaTime] = useState('');
  const [citaComercialId, setCitaComercialId] = useState('');

  // No interesado
  const [motivo, setMotivo] = useState<NoInterestReason | ''>('');
  const [notas, setNotas] = useState('');

  // Done
  const [doneMsg, setDoneMsg] = useState('');
  const [doneIsCita, setDoneIsCita] = useState(false);

  // Load lead fields when found
  useEffect(() => {
    if (!lead) return;
    setFNombre(lead.nombre ?? '');
    setFTel(lead.telefono ?? '');
    setFEmail(lead.email ?? '');
    setFTel2(lead.telefono2 ?? '');
    setFDireccion(lead.direccion ?? '');
    setFCodPostal(lead.codigo_postal ?? '');
    setFProvincia(lead.provincia ?? 'Málaga');
    setFTipoInteres(lead.tipo_interes ?? 'Quiere moto nueva');
    const initialModel = models.find(m => m.id === lead.modelo_id);
    setFLeadModeloId(lead.modelo_id ?? '');
    setFLeadModeloName(initialModel?.name ?? lead.modelo_raw ?? '');
  }, [lead]);

  // Load call history when lead changes
  useEffect(() => {
    if (!lead) { setCallHistory([]); setFirstCallAt(null); return; }
    setLoadingHistory(true);
    createClient()
      .from('mmc_calls')
      .select('id, call_at, agent_name, qcode_description, qcode_type, talk_time_s')
      .eq('lead_id', lead.id)
      .order('call_at', { ascending: false })
      .limit(3)
      .then(async ({ data }) => {
        setCallHistory(data ?? []);
        // Fetch the first call (oldest)
        if (data && data.length > 0) {
          const { data: oldest } = await createClient()
            .from('mmc_calls')
            .select('call_at')
            .eq('lead_id', lead.id)
            .order('call_at', { ascending: true })
            .limit(1);
          setFirstCallAt(oldest?.[0]?.call_at ?? null);
        }
        setLoadingHistory(false);
      });
  }, [lead]);

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    const raw = tel.trim();
    if (!raw) return;

    if (!isValidPhone(raw)) {
      setInvalidPhone(true);
      setNotFound(false);
      return;
    }

    setInvalidPhone(false);
    setSearching(true);
    setNotFound(false);
    setLead(null);
    const normalized = raw.replace(/\D/g, '').slice(-9);
    const { data } = await supabase
      .from('mmc_leads')
      .select('id,nombre,email,telefono,telefono2,direccion,codigo_postal,modelo_raw,modelo_id,formulario,mensajes_preferencias,seleccionar_peticion,fecha_entrada,status,bq_total_attempts,bq_last_call_at,bq_last_agent,provincia,tipo_interes')
      .or(`telefono_normalized.eq.${normalized},telefono.ilike.%${raw}%`)
      .order('fecha_entrada', { ascending: false })
      .limit(1);
    setSearching(false);
    if (data && data.length > 0) {
      setLead(data[0] as Lead);
      setStep('lead');
    } else {
      setNotFound(true);
    }
  }

  function resetAll() {
    setStep('search');
    setTel('');
    setLead(null);
    setNotFound(false);
    setInvalidPhone(false);
    setCallHistory([]);
    setFirstCallAt(null);
    setCitaTipo(null);
    setCitaModeloId('');
    setCitaDate(null);
    setCitaTime('');
    setCitaComercialId('');
    setMotivo('');
    setNotas('');
    setDoneMsg('');
  }

  async function handleConfirm() {
    if (!lead) return;
    startTransition(async () => {
      // 1. Update lead fields
      const updates: Record<string, string | null> = {
        nombre: fNombre || lead.nombre,
        telefono: fTel || lead.telefono,
        email: fEmail || null,
        telefono2: fTel2 || null,
        direccion: fDireccion || null,
        codigo_postal: fCodPostal || null,
        provincia: fProvincia || 'Málaga',
        tipo_interes: fTipoInteres || null,
        modelo_id: fLeadModeloId || null,
      };
      await supabase.from('mmc_leads').update(updates).eq('id', lead.id);

      // 2. Operator report
      const callResult = motivo
        ? 'no_interesado'
        : citaTipo === 'prueba_moto'
        ? 'cita_prueba_moto'
        : citaTipo === 'concesionario'
        ? 'cita_concesionario'
        : 'cita_taller';

      const reportPayload: Record<string, unknown> = {
        lead_id: lead.id,
        operator_id: commercial.id,
        telefono_buscado: tel,
        call_result: callResult,
        observaciones: notas || null,
        ...(motivo ? { no_interest_reason: motivo } : {}),
        ...(citaDate ? { cita_fecha: new Date(`${format(citaDate, 'yyyy-MM-dd')}T${citaTime}:00`).toISOString() } : {}),
        ...(citaComercialId ? { cita_comercial_id: citaComercialId } : {}),
      };
      const { error: rErr } = await supabase.from('mmc_operator_reports').insert(reportPayload);
      if (rErr) { toast.error('Error guardando reporte', { description: rErr.message }); return; }

      // 3. If cita → Bookings API
      if (!motivo && citaTipo && citaDate && citaTime && citaComercialId) {
        const tipo = citaResultToApptType(callResult as any);
        if (tipo) {
          const fechaIso = `${format(citaDate, 'yyyy-MM-dd')}T${citaTime}:00`;
          const res = await fetch('/api/bookings/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: lead.id, tipo, fecha_iso: fechaIso, commercial_id: citaComercialId, notas: notas || null }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'unknown' }));
            toast.error('Cita en panel pero falló Bookings', { description: err.error });
            await supabase.from('mmc_appointments').insert({ lead_id: lead.id, commercial_id: citaComercialId, tipo, fecha_cita: `${fechaIso}`, status: 'pending', sync_source: 'panel_fallback' });
          }
          await supabase.from('mmc_leads').update({ status: 'appointment' }).eq('id', lead.id);
        }
      } else if (motivo) {
        await supabase.from('mmc_leads').update({ status: 'lost', lost_reason: motivo }).eq('id', lead.id);
      }

      // 4. Done screen
      const isCita = !motivo;
      setDoneIsCita(isCita);
      if (isCita) {
        const msgs = DONE_CITA;
        setDoneMsg(msgs[Math.floor(Math.random() * msgs.length)](fNombre || lead.nombre));
      } else {
        const msgs = DONE_NO;
        setDoneMsg(msgs[Math.floor(Math.random() * msgs.length)]());
      }
      setStep('done');
    });
  }

  const citaModeloName = models.find(m => m.id === citaModeloId)?.name ?? '';
  const citaComercialName = comerciales.find(c => c.id === citaComercialId)?.name ?? '';
  const workingDays = getWorkingDays();

  // ── STEP: search ────────────────────────────────────────────────────────────
  if (step === 'search' || step === 'done') {
    const hora = new Date().getHours();
    const saludo = hora < 14 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
        {/* Done reinforcement message */}
        {step === 'done' && doneMsg && (
          <div className={`w-full max-w-lg mb-8 rounded-xl border p-5 text-center ${doneIsCita ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="text-3xl mb-2">{doneIsCita ? '🎉' : '💪'}</div>
            <p className={`font-medium text-base ${doneIsCita ? 'text-green-800' : 'text-blue-800'}`}>{doneMsg}</p>
          </div>
        )}

        <div className="w-full max-w-lg text-center mb-8">
          <h1 className="font-display text-3xl font-bold mb-1">{saludo}, {commercial.display_name || commercial.name}</h1>
          <p className="text-muted-foreground">Introduce el teléfono del cliente que tienes en línea</p>
        </div>

        <form onSubmit={doSearch} className="w-full max-w-lg space-y-3">
          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              value={tel}
              onChange={e => { setTel(e.target.value); setNotFound(false); setInvalidPhone(false); }}
              placeholder="600 123 456"
              className="h-16 text-2xl font-mono pl-12 pr-4 rounded-xl border-2 focus:border-ymc-red"
              autoFocus
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={!tel.trim() || searching}
            className="w-full h-14 bg-ymc-red hover:bg-ymc-redDark text-white text-lg rounded-xl"
          >
            {searching ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Search className="h-5 w-5 mr-2" />}
            Identificar cliente
          </Button>
        </form>

        {invalidPhone && (
          <div className="w-full max-w-lg mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-800 flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Formato de teléfono no válido. Introduce solo el número del cliente.
          </div>
        )}

        {notFound && !invalidPhone && (
          <div className="w-full max-w-lg mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
            No encontramos ningún cliente con ese teléfono. Puede ser un lead nuevo o un número con formato distinto.
          </div>
        )}
      </div>
    );
  }

  // ── STEP: lead ──────────────────────────────────────────────────────────────
  if (step === 'lead' && lead) {
    const prevQcode = callHistory[0]?.qcode_description;
    const totalAttempts = lead.bq_total_attempts ?? callHistory.length;

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <StepBack onClick={resetAll} label="Buscar otro cliente" />

        {/* Lead card */}
        <div className="rounded-2xl border-2 border-ymc-red/30 bg-white shadow-sm overflow-hidden">
          {/* Header */}
          <div className="bg-ymc-red px-6 py-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-white/80" />
                <span className="text-white/70 text-sm">Cliente identificado</span>
              </div>
              <h2 className="font-display text-2xl font-bold text-white mt-0.5">{lead.nombre}</h2>
            </div>
            <Link href={`/leads/${lead.id}`} target="_blank" className="text-white/60 hover:text-white inline-flex items-center gap-1 text-xs">
              Ficha completa <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {/* Editable fields */}
          <div className="p-6 space-y-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Datos de contacto — editables</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field icon={<User className="h-4 w-4" />} label="Nombre" value={fNombre} onChange={setFNombre} />
              <Field icon={<Phone className="h-4 w-4" />} label="Teléfono" value={fTel} onChange={setFTel} type="tel" />
              <Field icon={<Mail className="h-4 w-4" />} label="Email" value={fEmail} onChange={setFEmail} type="email" />
              <Field icon={<Smartphone className="h-4 w-4" />} label="Teléfono 2 (opcional)" value={fTel2} onChange={setFTel2} type="tel" />
              <Field icon={<MapPin className="h-4 w-4" />} label="Dirección (opcional)" value={fDireccion} onChange={setFDireccion} className="sm:col-span-2" />
              <Field icon={<Hash className="h-4 w-4" />} label="Código postal (opcional)" value={fCodPostal} onChange={setFCodPostal} />
              {/* Provincia */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="text-ymc-red"><MapPin className="h-4 w-4 inline" /></span>Provincia
                </Label>
                <select
                  value={fProvincia}
                  onChange={e => setFProvincia(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:border-ymc-red focus:outline-none"
                >
                  {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            {/* Interés del cliente */}
            <div className="rounded-xl bg-slate-50 p-4 space-y-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Interés del cliente</p>
              {/* Tipo de interés */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Interés</Label>
                <Input
                  value={fTipoInteres}
                  onChange={e => setFTipoInteres(e.target.value)}
                  placeholder="Quiere moto nueva"
                  className="h-9 text-sm bg-white"
                />
              </div>
              {/* Modelo */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Bike className="h-3 w-3 text-ymc-red" />
                  Modelo de interés
                  {lead.modelo_raw && !lead.modelo_id && (
                    <span className="text-xs text-muted-foreground ml-1">(sheet: "{lead.modelo_raw}")</span>
                  )}
                </Label>
                <ModelCombobox
                  models={models}
                  value={fLeadModeloId}
                  onChange={(id, name) => { setFLeadModeloId(id); setFLeadModeloName(name); }}
                />
              </div>
              {lead.seleccionar_peticion && (
                <div className="text-sm text-muted-foreground">Petición: {lead.seleccionar_peticion}</div>
              )}
              {lead.mensajes_preferencias && (
                <div className="text-sm text-muted-foreground italic">"{lead.mensajes_preferencias}"</div>
              )}
            </div>

            {/* Historial */}
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Historial de llamadas</p>
              {loadingHistory ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <div className="space-y-2">
                  {/* Entry + first call dates */}
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">Entrada lead:</strong>{' '}
                      {formatFechaEntrada(lead.fecha_entrada)}
                    </span>
                    {firstCallAt && (
                      <span>
                        <strong className="text-foreground">1ª llamada:</strong>{' '}
                        {format(new Date(firstCallAt), "d MMM yyyy", { locale: es })}
                      </span>
                    )}
                  </div>

                  {callHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Primera vez que se le llama.</p>
                  ) : (
                    <>
                      <div className="text-sm">
                        <strong>{totalAttempts}</strong>
                        <span className="text-muted-foreground"> {totalAttempts === 1 ? 'intento' : 'intentos'} en total</span>
                        {lead.bq_last_call_at && (
                          <span className="text-muted-foreground">
                            {' · '}Último:{' '}
                            {format(new Date(lead.bq_last_call_at), "d MMM 'a las' HH:mm", { locale: es })}
                            {lead.bq_last_agent && ` con ${lead.bq_last_agent}`}
                          </span>
                        )}
                      </div>
                      {prevQcode && (
                        <div className="text-xs px-2 py-1 rounded-md bg-white border inline-block">
                          Último resultado: <strong>{prevQcode}</strong>
                        </div>
                      )}
                      {callHistory.map(c => (
                        <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{format(new Date(c.call_at), "d MMM · HH:mm", { locale: es })} — {c.agent_name || '—'}</span>
                          {c.talk_time_s > 0
                            ? <span className="text-green-700 font-medium">{Math.round(c.talk_time_s / 60)}min</span>
                            : <span className="text-slate-400">Sin respuesta</span>}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setStep('cita')}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-green-200 bg-green-50 hover:bg-green-100 hover:border-green-400 p-6 transition-all"
          >
            <span className="text-4xl">🗓️</span>
            <div className="text-center">
              <div className="font-display font-bold text-lg text-green-800">Quiere cita</div>
              <div className="text-sm text-green-700 mt-0.5">Programar una visita al concesionario</div>
            </div>
            <ChevronRight className="h-5 w-5 text-green-600 group-hover:translate-x-1 transition-transform" />
          </button>

          <button
            onClick={() => setStep('no_interesado')}
            className="group flex flex-col items-center gap-3 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 p-6 transition-all"
          >
            <span className="text-4xl">❌</span>
            <div className="text-center">
              <div className="font-display font-bold text-lg text-amber-800">No interesado</div>
              <div className="text-sm text-amber-700 mt-0.5">Registrar motivo de rechazo</div>
            </div>
            <ChevronRight className="h-5 w-5 text-amber-600 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    );
  }

  // ── STEP: cita ──────────────────────────────────────────────────────────────
  if (step === 'cita') {
    const canContinue = !!citaTipo && !!citaDate && !!citaTime && !!citaComercialId;

    return (
      <div className="max-w-2xl mx-auto space-y-8">
        <StepBack onClick={() => setStep('lead')} />

        {/* Tipo de cita */}
        <div>
          <SectionTitle>¿Qué tipo de cita?</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CITA_TIPOS.map(t => (
              <button
                key={t.value}
                onClick={() => { setCitaTipo(t.value); if (t.value !== 'prueba_moto') setCitaModeloId(''); }}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-5 transition-all ${
                  citaTipo === t.value
                    ? 'border-ymc-red bg-ymc-redLight shadow-sm'
                    : 'border-slate-200 bg-white hover:border-ymc-red/40'
                }`}
              >
                <span className="text-3xl">{t.emoji}</span>
                <span className={`font-semibold text-sm text-center ${citaTipo === t.value ? 'text-ymc-red' : ''}`}>{t.label}</span>
                <span className="text-xs text-muted-foreground text-center leading-tight">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Modelo (solo prueba moto) */}
        {citaTipo === 'prueba_moto' && (
          <div>
            <SectionTitle>¿Qué modelo quiere probar?</SectionTitle>
            <select
              value={citaModeloId}
              onChange={e => setCitaModeloId(e.target.value)}
              className="w-full border-2 rounded-xl px-4 py-3 text-base bg-white focus:border-ymc-red focus:outline-none"
            >
              <option value="">— Selecciona un modelo —</option>
              {['scooter', 'naked', 'deportiva', 'trail', 'offroad', 'bicicleta'].map(fam => {
                const famModels = models.filter(m => m.family === fam);
                if (!famModels.length) return null;
                return (
                  <optgroup key={fam} label={fam.charAt(0).toUpperCase() + fam.slice(1)}>
                    {famModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </div>
        )}

        {/* Fecha */}
        {citaTipo && (
          <div>
            <SectionTitle>¿Qué día?</SectionTitle>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
              {workingDays.map(d => {
                const iso = format(d, 'yyyy-MM-dd');
                const sel = citaDate && format(citaDate, 'yyyy-MM-dd') === iso;
                return (
                  <button
                    key={iso}
                    onClick={() => setCitaDate(d)}
                    className={`shrink-0 flex flex-col items-center rounded-xl border-2 px-3 py-2 min-w-[60px] transition-all ${
                      sel ? 'border-ymc-red bg-ymc-red text-white' : 'border-slate-200 bg-white hover:border-ymc-red/50'
                    }`}
                  >
                    <span className={`text-xs font-medium ${sel ? 'text-white/80' : 'text-muted-foreground'}`}>
                      {format(d, 'EEE', { locale: es }).slice(0, 3)}
                    </span>
                    <span className="font-bold text-base">{format(d, 'd')}</span>
                    <span className={`text-[10px] ${sel ? 'text-white/70' : 'text-muted-foreground'}`}>
                      {format(d, 'MMM', { locale: es })}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Hora */}
        {citaDate && (
          <div>
            <SectionTitle>¿A qué hora?</SectionTitle>
            <div className="space-y-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Mañana</p>
                <div className="flex flex-wrap gap-2">
                  {MORNING.map(t => (
                    <button key={t} onClick={() => setCitaTime(t)}
                      className={`rounded-lg border-2 px-4 py-2 text-sm font-mono font-medium transition-all ${citaTime === t ? 'border-ymc-red bg-ymc-red text-white' : 'border-slate-200 bg-white hover:border-ymc-red/50'}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Tarde</p>
                <div className="flex flex-wrap gap-2">
                  {AFTERNOON.map(t => (
                    <button key={t} onClick={() => setCitaTime(t)}
                      className={`rounded-lg border-2 px-4 py-2 text-sm font-mono font-medium transition-all ${citaTime === t ? 'border-ymc-red bg-ymc-red text-white' : 'border-slate-200 bg-white hover:border-ymc-red/50'}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Comercial */}
        {citaTime && (
          <div>
            <SectionTitle>¿Con qué comercial?</SectionTitle>
            <div className="flex flex-wrap gap-3">
              {comerciales.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCitaComercialId(c.id)}
                  className={`rounded-xl border-2 px-5 py-3 transition-all ${citaComercialId === c.id ? 'border-ymc-red bg-ymc-red text-white font-semibold' : 'border-slate-200 bg-white hover:border-ymc-red/50'}`}
                >
                  {c.name} {c.role === 'gerente' && <span className="text-xs opacity-70">(gerente)</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button
          onClick={() => setStep('confirm')}
          disabled={!canContinue}
          size="lg"
          className="w-full h-14 bg-ymc-red hover:bg-ymc-redDark text-white text-base rounded-xl"
        >
          Revisar y confirmar <ChevronRight className="h-5 w-5 ml-1" />
        </Button>
      </div>
    );
  }

  // ── STEP: no_interesado ─────────────────────────────────────────────────────
  if (step === 'no_interesado') {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <StepBack onClick={() => setStep('lead')} />
        <SectionTitle>¿Por qué motivo no está interesado?</SectionTitle>

        <div className="space-y-2">
          {NO_INT_REASONS.map(r => (
            <button
              key={r.value}
              onClick={() => setMotivo(r.value as NoInterestReason)}
              className={`w-full flex items-center gap-4 rounded-xl border-2 px-5 py-4 text-left transition-all ${
                motivo === r.value
                  ? 'border-amber-500 bg-amber-50 font-semibold'
                  : 'border-slate-200 bg-white hover:border-amber-300'
              }`}
            >
              <span className="text-2xl">{r.emoji}</span>
              <span className="text-base">{r.label}</span>
              {motivo === r.value && <CheckCircle2 className="h-5 w-5 text-amber-600 ml-auto" />}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notas" className="text-sm font-medium text-muted-foreground">Observaciones (opcional)</Label>
          <Textarea
            id="notas"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Añade cualquier detalle relevante de la conversación..."
            rows={3}
            className="rounded-xl"
          />
        </div>

        <Button
          onClick={() => setStep('confirm')}
          disabled={!motivo}
          size="lg"
          className="w-full h-14 bg-amber-500 hover:bg-amber-600 text-white text-base rounded-xl"
        >
          Revisar y confirmar <ChevronRight className="h-5 w-5 ml-1" />
        </Button>
      </div>
    );
  }

  // ── STEP: confirm ──────────────────────────────────────────────────────────
  if (step === 'confirm' && lead) {
    const isCita = !motivo;
    const reasonLabel = NO_INT_REASONS.find(r => r.value === motivo)?.label ?? motivo;

    return (
      <div className="max-w-xl mx-auto space-y-4">
        <StepBack onClick={() => setStep(isCita ? 'cita' : 'no_interesado')} />

        <div className="rounded-2xl border-2 border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="bg-slate-800 px-6 py-4">
            <h2 className="font-display text-xl font-bold text-white">Resumen de la gestión</h2>
            <p className="text-slate-400 text-sm mt-0.5">Revisa los datos antes de confirmar</p>
          </div>

          {/* Datos del cliente */}
          <ConfirmSection title="Datos del cliente" onEdit={() => setStep('lead')}>
            <ConfirmRow icon="👤" label="Nombre" value={fNombre || lead.nombre} />
            <ConfirmRow icon="📞" label="Teléfono" value={fTel || lead.telefono || '—'} />
            {fEmail && <ConfirmRow icon="✉️" label="Email" value={fEmail} />}
            {fTel2 && <ConfirmRow icon="📱" label="Teléfono 2" value={fTel2} />}
            {fDireccion && <ConfirmRow icon="📍" label="Dirección" value={fDireccion} />}
            {fCodPostal && <ConfirmRow icon="#" label="Código postal" value={fCodPostal} />}
            <ConfirmRow icon="🗺️" label="Provincia" value={fProvincia} />
            {fTipoInteres && <ConfirmRow icon="💡" label="Interés" value={fTipoInteres} />}
            {fLeadModeloName && <ConfirmRow icon="🏍️" label="Modelo de interés" value={fLeadModeloName} />}
          </ConfirmSection>

          {/* Resultado */}
          <ConfirmSection
            title={isCita ? 'Cita programada' : 'Motivo de no interés'}
            onEdit={() => setStep(isCita ? 'cita' : 'no_interesado')}
            accent={isCita ? 'green' : 'amber'}
          >
            {isCita ? (
              <>
                <ConfirmRow icon="📋" label="Tipo" value={CITA_TIPOS.find(t => t.value === citaTipo)?.label ?? ''} />
                {citaTipo === 'prueba_moto' && citaModeloName && (
                  <ConfirmRow icon="🏍️" label="Modelo a probar" value={citaModeloName} />
                )}
                <ConfirmRow icon="📅" label="Fecha" value={citaDate ? format(citaDate, "EEEE d 'de' MMMM", { locale: es }) : ''} />
                <ConfirmRow icon="🕐" label="Hora" value={citaTime} />
                <ConfirmRow icon="👤" label="Comercial" value={citaComercialName} />
              </>
            ) : (
              <>
                <ConfirmRow icon="❌" label="Motivo" value={reasonLabel} />
                {notas && <ConfirmRow icon="📝" label="Observaciones" value={notas} />}
              </>
            )}
          </ConfirmSection>

          {notas && isCita && (
            <div className="px-6 pb-4">
              <p className="text-xs text-muted-foreground">Notas: {notas}</p>
            </div>
          )}
        </div>

        <Button
          onClick={handleConfirm}
          disabled={pending}
          size="lg"
          className={`w-full h-16 text-white text-base font-bold rounded-xl ${isCita ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-500 hover:bg-amber-600'}`}
        >
          {pending ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
          Confirmar datos y finalizar
        </Button>
      </div>
    );
  }

  return null;
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function Field({
  icon, label, value, onChange, type = 'text', className = '',
}: {
  icon: React.ReactNode; label: string; value: string;
  onChange: (v: string) => void; type?: string; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        <span className="text-ymc-red">{icon}</span>{label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 text-sm"
      />
    </div>
  );
}

function ConfirmSection({
  title, children, onEdit, accent,
}: {
  title: string; children: React.ReactNode; onEdit: () => void; accent?: 'green' | 'amber';
}) {
  const bg = accent === 'green' ? 'bg-green-50' : accent === 'amber' ? 'bg-amber-50' : 'bg-slate-50';
  return (
    <div className={`px-6 py-4 border-t ${bg}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{title}</p>
        <button onClick={onEdit} className="inline-flex items-center gap-1 text-xs text-ymc-red hover:underline">
          <Edit2 className="h-3 w-3" /> Editar
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ConfirmRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-5 text-center shrink-0">{icon}</span>
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
