import { redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import OperatorWorkspace from './OperatorWorkspace';

export default async function OperatorPage() {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');
  if (!['operadora', 'admin', 'gerente'].includes(commercial.role)) redirect('/');

  const supabase = createClient();
  const adminSupabase = createAdminClient();

  const [modelsRes, comercialesRes] = await Promise.all([
    supabase
      .from('mmc_models')
      .select('id, name, family')
      .eq('is_active', true)
      .neq('name', 'Otro no especificado')
      .order('family')
      .order('name'),
    adminSupabase
      .from('mmc_commercials')
      .select('id, name, role')
      .in('role', ['comercial', 'gerente'])
      .eq('is_active', true)
      .order('name'),
  ]);

  return (
    <AppShell commercial={commercial}>
      <OperatorWorkspace
        commercial={commercial}
        models={modelsRes.data ?? []}
        comerciales={comercialesRes.data ?? []}
      />
    </AppShell>
  );
}
