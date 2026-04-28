'use client';

import { LogOut } from 'lucide-react';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function NotMeLink({ name }: { name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const supabase = createClient();

  function handleClick() {
    startTransition(async () => {
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-ymc-red transition-colors disabled:opacity-50"
      title="Cerrar sesión y entrar con otra cuenta"
    >
      ¿No eres <span className="font-medium">{name}</span>?
      <LogOut className="h-3.5 w-3.5" />
    </button>
  );
}
