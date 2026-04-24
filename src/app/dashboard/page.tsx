import { redirect } from 'next/navigation';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import DashboardClient from '@/components/DashboardClient';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  if (commercial.role !== 'admin' && commercial.role !== 'gerente') {
    return (
      <AppShell commercial={commercial}>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Sin permisos para la analítica.
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell commercial={commercial}>
      <DashboardClient />
    </AppShell>
  );
}
