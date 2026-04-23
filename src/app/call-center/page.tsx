import { redirect } from 'next/navigation';
import { Headphones } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import CallCenterSearch from './CallCenterSearch';

export default async function CallCenterPage({
  searchParams,
}: {
  searchParams?: { tel?: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  const isOperator =
    commercial.role === 'operadora' || commercial.role === 'admin' || commercial.role === 'gerente';
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

  // Opciones para el form (comerciales del concesionario)
  const { data: comerciales } = await supabase
    .from('mmc_commercials')
    .select('id, name, role')
    .eq('is_active', true)
    .in('role', ['comercial', 'gerente'])
    .order('name');

  // Búsqueda inicial por ?tel
  let initialLead: any = null;
  let candidates: any[] = [];
  const q = searchParams?.tel?.trim();
  if (q) {
    const digits = q.replace(/[^0-9]/g, '');
    const last9 = digits.slice(-9);
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
      initialLead = candidates[0] ?? null;
    }
  }

  return (
    <AppShell commercial={commercial}>
      <header className="mb-6">
        <div className="inline-flex items-center gap-2">
          <Headphones className="h-6 w-6 text-ymc-red" />
          <h1 className="font-display text-2xl font-bold">Call Center</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Introduce el teléfono que te acaba de saltar en Presence para localizar al lead y reportar
          el resultado de la llamada.
        </p>
      </header>

      <CallCenterSearch
        initialQuery={q || ''}
        initialLead={initialLead}
        candidates={candidates}
        operatorId={commercial.id}
        comerciales={comerciales || []}
      />
    </AppShell>
  );
}
