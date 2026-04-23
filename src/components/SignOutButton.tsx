'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export default function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const supabase = createClient();

  function onClick() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    });
  }

  if (compact) {
    return (
      <Button variant="ghost" size="icon" onClick={onClick} disabled={pending}>
        <LogOut className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={pending}
      className="w-full justify-start"
    >
      <LogOut className="h-4 w-4 mr-2" />
      Cerrar sesión
    </Button>
  );
}
