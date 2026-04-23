import { redirect } from 'next/navigation';
import { Headphones, Phone, PhoneOff, PhoneIncoming } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import CallCenterSearch from './CallCenterSearch';
import LeadsListClient from './LeadsListClient';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function CallCenterPage({
  searchParams,
}: {
  searchParams?: {
    tel?: string;
    q?: string;
    origen?: string;
    formulario?: string;
    modelo?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    contactada?: string;
    page?: string;
  };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  const isOperator =
    commercial.role === 'operadora' ||
    commercial.role === 'admin' ||
    commercial.role === 'gerente';
  if (!isOperator) {
    return (
      <AppShell commercial={commercial}>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tienes permisos para acceder al Call Center.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const supabase = createClient();
  const page = Math.max(1, parseInt(searchParams?.page || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  const [{ count: leadsNew24h }, { count: called24h }, { count: pending }] = await Promise.all([
    supabase.from('mmc_leads').select('*', { count: 'exact', head: true }).gte('fecha_entrada', last24h),
    supabase.from('mmc_calls').select('*', { count: 'exact', head: true }).gte('call_at', last24h),
    supabase
      .from('mmc_leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new')
      .is('bq_last_call_at', null),
  ]);

  // Comerciales para desplegable cita
  const { data: comerciales } = await supabase
    .from('mmc_commercials')
    .select('id, name, role')
    .eq('is_active', true)
    .in('role', ['comercial', 'gerente'])
    .order('name');

  // Buscador teléfono (Presence)
  let selectedLead: any = null;
  let candidates: any[] = [];
  const qTel = searchParams?.tel?.trim();
  if (qTel) {
    const last9 = qTel.replace(/[^0-9]/g, '').slice(-9);
    if (last9) {
      const { data } = await supabase
        .from('mmc_leads')
        .select(
          'id, nombre, email, telefono, modelo_raw, origen, formulario, mensajes_preferencias, fecha_entrada, status, bq_total_attempts, bq_last_agent, bq_last_qcode, bq_last_call_at'
        )
        .eq('telefono_normalized', last9)
        .order('fecha_entrada', { ascending: false })
        .limit(10);
      candidates = data ?? [];
      selectedLead = candidates[0] ?? null;
    }
  }

  // Filtros para la tabla
  const q = searchParams?.q?.trim();
  let listQuery = supabase
    .from('mmc_leads')
    .select(
      'id, nombre, email, telefono, modelo_raw, origen, formulario, status, fecha_entrada, bq_total_attempts, bq_last_call_at',
      { count: 'exact' }
    );

  if (q) {
    const esc = q.replace(/[%_]/g, '\\$&');
    listQuery = listQuery.or(
      `nombre.ilike.%${esc}%,email.ilike.%${esc}%,telefono.ilike.%${esc}%,modelo_raw.ilike.%${esc}%,formulario.ilike.%${esc}%`
    );
  }
  if (searchParams?.origen) listQuery = listQuery.eq('origen', searchParams.origen);
  if (searchParams?.formulario)
    listQuery = listQuery.ilike('formulario', `%${searchParams.formulario}%`);
  if (searchParams?.modelo)
    listQuery = listQuery.ilike('modelo_raw', `%${searchParams.modelo}%`);
  if (searchParams?.status) listQuery = listQuery.eq('status', searchParams.status);
  if (searchParams?.dateFrom)
    listQuery = listQuery.gte('fecha_entrada', `${searchParams.dateFrom}T00:00:00Z`);
  if (searchParams?.dateTo)
    listQuery = listQuery.lte('fecha_entrada', `${searchParams.dateTo}T23:59:59Z`);
  if (searchParams?.contactada === 'yes')
    listQuery = listQuery.not('bq_last_call_at', 'is', null);
  if (searchParams?.contactada === 'no')
    listQuery = listQuery.is('bq_last_call_at', null);

  listQuery = listQuery
    .order('fecha_entrada', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data: leads, count: totalLeads } = await listQuery;

  // Origenes disponibles para filtro
  const origens = ['META', 'SEO', 'SEM', 'SEO_SEM', 'INSTAGRAM', 'WALK_IN', 'PRESENCE', 'OTHER'];
  const statuses = ['new', 'contacted', 'appointment', 'attended', 'sold', 'lost', 'bad_contact'];

  return (
    <AppShell commercial={commercial}>
      <header className="mb-5">
        <div className="inline-flex items-center gap-2">
          <Headphones className="h-6 w-6 text-ymc-red" />
          <h1 className="font-display text-2xl font-bold">Call Center</h1>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 md:gap-4 mb-6">
        <KPI icon={<PhoneIncoming className="h-4 w-4" />} label="Leads 24h" value={leadsNew24h ?? 0} />
        <KPI icon={<Phone className="h-4 w-4" />} label="Llamadas 24h" value={called24h ?? 0} />
        <KPI
          icon={<PhoneOff className="h-4 w-4" />}
          label="Por llamar"
          value={pending ?? 0}
          color="amber"
        />
      </div>

      {/* Buscador por teléfono (Presence flow) */}
      <CallCenterSearch
        initialQuery={qTel || ''}
        initialLead={selectedLead}
        candidates={candidates}
        operatorId={commercial.id}
        comerciales={comerciales || []}
      />

      {/* Listado + filtros */}
      <div className="mt-8">
        <LeadsListClient
          leads={leads || []}
          total={totalLeads || 0}
          page={page}
          pageSize={PAGE_SIZE}
          origens={origens}
          statuses={statuses}
          initialFilters={{
            q: searchParams?.q || '',
            origen: searchParams?.origen || '',
            formulario: searchParams?.formulario || '',
            modelo: searchParams?.modelo || '',
            status: searchParams?.status || '',
            dateFrom: searchParams?.dateFrom || '',
            dateTo: searchParams?.dateTo || '',
            contactada: searchParams?.contactada || '',
          }}
        />
      </div>
    </AppShell>
  );
}

function KPI({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: 'amber';
}) {
  const colorCls = color === 'amber' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-lg border bg-white p-3 md:p-4">
      <div className="inline-flex items-center gap-1.5 text-[11px] md:text-xs text-muted-foreground uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 font-display text-xl md:text-2xl font-bold ${colorCls}`}>
        {value.toLocaleString('es-ES')}
      </div>
    </div>
  );
}
