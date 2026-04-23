'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Menu, X, Home, Calendar, Headphones, Users, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SignOutButton from './SignOutButton';
import type { Commercial } from '@/lib/types';

export default function MobileNav({ commercial }: { commercial: Commercial | null }) {
  const [open, setOpen] = useState(false);

  const role = commercial?.role;
  const isManager = role === 'admin' || role === 'gerente';
  const isOperator = role === 'operadora';
  const isCommercial = role === 'comercial';

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="md:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/40" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-5 border-b flex items-start justify-between">
              <Link href="/" onClick={() => setOpen(false)}>
                <Image
                  src="/brand/ymc-logo-horizontal.svg"
                  alt="Yamaha Málaga Center"
                  width={200}
                  height={28}
                  priority
                  className="h-7 w-auto"
                />
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-0.5 text-sm">
              <Item href="/" icon={<Home className="h-4 w-4" />} label="Inicio" onClose={() => setOpen(false)} />
              {(isCommercial || isManager) && (
                <Item
                  href="/appointments"
                  icon={<Calendar className="h-4 w-4" />}
                  label="Mis citas"
                  onClose={() => setOpen(false)}
                />
              )}
              {(isOperator || isManager) && (
                <Item
                  href="/call-center"
                  icon={<Headphones className="h-4 w-4" />}
                  label="Call center"
                  onClose={() => setOpen(false)}
                />
              )}
              {isManager && (
                <>
                  <Item
                    href="/leads"
                    icon={<Users className="h-4 w-4" />}
                    label="Leads"
                    onClose={() => setOpen(false)}
                  />
                  <Item
                    href="/dashboard"
                    icon={<BarChart3 className="h-4 w-4" />}
                    label="Analítica"
                    onClose={() => setOpen(false)}
                  />
                </>
              )}
            </nav>
            <div className="px-3 py-4 border-t space-y-2">
              {commercial && (
                <div className="px-3 py-2 text-sm">
                  <div className="font-medium truncate">
                    {commercial.display_name || commercial.name}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{commercial.role}</div>
                </div>
              )}
              <SignOutButton />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Item({
  href,
  icon,
  label,
  onClose,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex items-center gap-3 rounded-md px-3 py-2.5 text-slate-700 hover:bg-ymc-redLight hover:text-ymc-red transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
