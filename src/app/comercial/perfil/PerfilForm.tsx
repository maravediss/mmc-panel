'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function PerfilForm({
  commercialId,
  alertEmail,
  accessEmail,
}: {
  commercialId: string;
  alertEmail: string;
  accessEmail: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(alertEmail);

  function save() {
    start(async () => {
      const value = email.trim() || null;
      const { error } = await supabase
        .from('mmc_commercials')
        .update({ alert_email: value })
        .eq('id', commercialId);
      if (error) {
        toast.error('Error guardando', { description: error.message });
        return;
      }
      toast.success('Email de alertas actualizado');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="alert_email" className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" /> Email para alertas
        </Label>
        <Input
          id="alert_email"
          type="email"
          placeholder={accessEmail || 'tu@malagamotocenter.com'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
        />
        <p className="text-xs text-muted-foreground">
          A esta dirección llegarán los avisos de citas próximas, recordatorios para cerrar
          citas pasadas y el resumen de mañana. Si lo dejas vacío, usaremos tu email de
          acceso ({accessEmail || '—'}).
        </p>
      </div>

      <div className="rounded-md border bg-slate-50 p-3 text-xs text-muted-foreground">
        Las notificaciones por email se activarán en una próxima fase.
        WhatsApp llegará al final.
      </div>

      <Button
        onClick={save}
        disabled={pending || email === alertEmail}
        className="bg-ymc-red hover:bg-ymc-redDark"
      >
        {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Guardar cambios
      </Button>
    </div>
  );
}
