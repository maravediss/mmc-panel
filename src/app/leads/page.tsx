import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Search, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ORIGIN_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_COLOR } from '@/lib/mappings';
import type { LeadOrigin, LeadStatus } from '@/lib/types';

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: { q?: string; origen?: string; status?: string };
}) {
  const commercial = await getCurrentCommercial();
  if (!commercial) return null;

  const supabase = createClient();
  const q = searchParams?.q?.trim();

  let query = supabase
    .from('mmc_leads')
    .select('id, nombre, email, telefono, modelo_raw, origen, status, fecha_entrada, bq_total_attempts')
    .order('fecha_entrada', { ascending: false })
    .limit(100);

  if (q) {
    const esc = q.replace(/[%_]/g, '\\$&');
    query = query.or(
      `nombre.ilike.%${esc}%,email.ilike.%${esc}%,telefono.ilike.%${esc}%,modelo_raw.ilike.%${esc}%`
    );
  }
  if (searchParams?.origen) query = query.eq('origen', searchParams.origen);
  if (searchParams?.status) query = query.eq('status', searchParams.status);

  const { data: leads } = await query;

  return (
    <AppShell commercial={commercial}>
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">Base de datos de leads capturados</p>
        </div>
      </header>

      {/* Buscador */}
      <form className="mb-4 flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, email, teléfono o modelo…"
            className="pl-9"
          />
        </div>
        {(q || searchParams?.origen || searchParams?.status) && (
          <Link
            href="/leads"
            className="text-sm text-muted-foreground px-3 py-2 hover:text-foreground"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {(leads ?? []).map((l: any) => (
              <Link
                key={l.id}
                href={`/leads/${l.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-ymc-redLight/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{l.nombre}</span>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {ORIGIN_LABEL[l.origen as LeadOrigin]}
                    </Badge>
                    {l.modelo_raw && (
                      <span className="text-xs text-muted-foreground">· {l.modelo_raw}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {l.telefono && <span>{l.telefono} · </span>}
                    {l.email}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="inline-flex items-center gap-1.5 text-xs">
                    <span
                      className={`h-2 w-2 rounded-full ${LEAD_STATUS_COLOR[l.status as LeadStatus]}`}
                    />
                    {LEAD_STATUS_LABEL[l.status as LeadStatus]}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(l.fecha_entrada), "d MMM yyyy", { locale: es })}
                  </div>
                  {l.bq_total_attempts > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {l.bq_total_attempts} ☎
                    </div>
                  )}
                </div>
              </Link>
            ))}
            {(leads ?? []).length === 0 && (
              <div className="px-4 py-12 text-center text-muted-foreground text-sm">
                No hay resultados.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {(leads ?? []).length === 100 && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          Mostrando los 100 más recientes. Usa el buscador para filtrar.
        </p>
      )}
    </AppShell>
  );
}
