import { redirect } from 'next/navigation';
import { User } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PerfilForm from './PerfilForm';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const me = await getCurrentCommercial();
  if (!me) redirect('/login');
  if (me.role === 'operadora') redirect('/operator');

  const supabase = createClient();
  const { data: full } = await supabase
    .from('mmc_commercials')
    .select('id, name, display_name, email, role, alert_email, is_active')
    .eq('id', me.id)
    .maybeSingle();

  const fullCommercial = (full as any) || me;

  return (
    <AppShell commercial={me}>
      <header className="mb-5">
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <User className="h-6 w-6 text-ymc-red" /> Mi perfil
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configura tus datos y preferencias de notificación.
        </p>
      </header>

      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos personales</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Field label="Nombre">{fullCommercial.display_name || fullCommercial.name}</Field>
            <Field label="Rol">{fullCommercial.role}</Field>
            <Field label="Email de acceso">{fullCommercial.email || '—'}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notificaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <PerfilForm
              commercialId={me.id}
              alertEmail={fullCommercial.alert_email || fullCommercial.email || ''}
              accessEmail={fullCommercial.email || ''}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 border-b last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2 font-medium">{children}</span>
    </div>
  );
}
