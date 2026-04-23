import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import OperatorWorkspace from './OperatorWorkspace';

export default async function OperatorPage({
  searchParams,
}: {
  searchParams?: { tel?: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');
  if (!['operadora', 'admin', 'gerente'].includes(commercial.role)) redirect('/');

  const supabase = createClient();
  const tel = searchParams?.tel?.trim() ?? '';

  // KPIs: reports of this operator today and this week
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const [todayRes, weekRes, prevWeekRes] = await Promise.all([
    supabase
      .from('mmc_operator_reports')
      .select('call_result, created_at')
      .eq('operator_id', commercial.id)
      .gte('created_at', todayStart.toISOString()),
    supabase
      .from('mmc_operator_reports')
      .select('call_result, created_at')
      .eq('operator_id', commercial.id)
      .gte('created_at', weekStart.toISOString()),
    supabase
      .from('mmc_operator_reports')
      .select('call_result, created_at')
      .eq('operator_id', commercial.id)
      .gte('created_at', prevWeekStart.toISOString())
      .lt('created_at', weekStart.toISOString()),
  ]);

  // Lead lookup by phone
  let candidates: any[] = [];
  let initialLead: any = null;

  if (tel) {
    const normalized = tel.replace(/\D/g, '').slice(-9);
    const { data } = await supabase
      .from('mmc_leads')
      .select(
        'id, nombre, email, telefono, modelo_raw, origen, formulario, mensajes_preferencias, fecha_entrada, status, bq_total_attempts, bq_last_agent, bq_last_qcode, bq_last_call_at'
      )
      .or(`telefono_normalized.eq.${normalized},telefono.ilike.%${tel}%`)
      .order('fecha_entrada', { ascending: false })
      .limit(5);
    candidates = data ?? [];
    initialLead = candidates[0] ?? null;
  }

  // Commercials for appointment assignment (comercial + gerente)
  const { data: comerciales } = await supabase
    .from('mmc_commercials')
    .select('id, name, role')
    .in('role', ['comercial', 'gerente'])
    .eq('is_active', true)
    .order('name');

  return (
    <AppShell commercial={commercial}>
      <OperatorWorkspace
        commercial={commercial}
        todayReports={todayRes.data ?? []}
        weekReports={weekRes.data ?? []}
        prevWeekReports={prevWeekRes.data ?? []}
        initialQuery={tel}
        initialLead={initialLead}
        candidates={candidates}
        comerciales={comerciales ?? []}
      />
    </AppShell>
  );
}
