import { notFound, redirect } from 'next/navigation';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import LeadDetailClient from './LeadDetailClient';

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  const supabase = createClient();
  const admin    = createAdminClient();

  const { data: lead } = await supabase
    .from('mmc_leads')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!lead) notFound();

  const [modelsRes, modeloRes, margenRes, callsRes, apptsRes, salesRes, reportsRes, inboundsRes] =
    await Promise.all([
      supabase
        .from('mmc_models')
        .select('id, name, family')
        .eq('is_active', true)
        .neq('name', 'Otro no especificado')
        .order('name'),

      lead.modelo_id
        ? supabase.from('mmc_models').select('id, name, family, cc').eq('id', lead.modelo_id).maybeSingle()
        : Promise.resolve({ data: null }),

      lead.modelo_id
        ? supabase.from('mmc_model_margins').select('margin_eur').eq('model_id', lead.modelo_id)
            .order('year', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),

      supabase
        .from('mmc_calls')
        .select('*')
        .eq('lead_id', params.id)
        .order('call_at', { ascending: false }),

      supabase
        .from('mmc_appointments')
        .select('*, commercial:mmc_commercials(name)')
        .eq('lead_id', params.id)
        .order('fecha_cita', { ascending: false }),

      supabase
        .from('mmc_sales')
        .select('*, commercial:mmc_commercials(name)')
        .eq('lead_id', params.id)
        .order('fecha_compra', { ascending: false }),

      supabase
        .from('mmc_operator_reports')
        .select('*, operator:mmc_commercials!mmc_operator_reports_operator_id_fkey(name)')
        .eq('lead_id', params.id)
        .order('created_at', { ascending: false }),

      // Inbounds — admin client to bypass RLS, ordered ASC to know which was first
      admin
        .from('mmc_lead_inbounds')
        .select('id, fecha_entrada, origen, formulario')
        .eq('lead_id', params.id)
        .order('fecha_entrada', { ascending: true }),
    ]);

  const margenEstimado = margenRes.data ? Number((margenRes.data as any).margin_eur) : null;

  return (
    <AppShell commercial={commercial}>
      <LeadDetailClient
        lead={lead as any}
        modelo={(modeloRes.data as any) ?? null}
        margenEstimado={margenEstimado}
        calls={callsRes.data ?? []}
        appointments={apptsRes.data ?? []}
        sales={salesRes.data ?? []}
        reports={reportsRes.data ?? []}
        models={modelsRes.data ?? []}
        inbounds={inboundsRes.data ?? []}
      />
    </AppShell>
  );
}
