import { redirect } from 'next/navigation';
import { getCurrentCommercial } from '@/lib/session';
import AppShell from '@/components/AppShell';
import LeadsPageClient from './LeadsPageClient';

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const commercial = await getCurrentCommercial();
  if (!commercial) redirect('/login');

  return (
    <AppShell commercial={commercial}>
      <LeadsPageClient />
    </AppShell>
  );
}
