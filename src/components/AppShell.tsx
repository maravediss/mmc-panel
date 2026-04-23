import Link from 'next/link';
import Image from 'next/image';
import {
  Calendar,
  Home,
  Users,
  BarChart3,
  Headphones,
  Bike,
} from 'lucide-react';
import type { Commercial } from '@/lib/types';
import SignOutButton from './SignOutButton';

export default async function AppShell({
  commercial,
  children,
}: {
  commercial: Commercial | null;
  children: React.ReactNode;
}) {
  const role = commercial?.role;
  const isManager = role === 'admin' || role === 'gerente';
  const isOperator = role === 'operadora';
  const isCommercial = role === 'comercial';

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-r bg-white">
        <div className="px-5 py-5 border-b">
          <Link href="/" className="block">
            <Image
              src="/brand/ymc-logo-horizontal.svg"
              alt="Yamaha Málaga Center"
              width={200}
              height={28}
              priority
              className="h-7 w-auto"
            />
          </Link>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">
            Panel de gestión
          </p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 text-sm">
          <NavLink href="/" icon={<Home className="h-4 w-4" />} label="Inicio" />
          {(isCommercial || isManager) && (
            <NavLink
              href="/appointments"
              icon={<Calendar className="h-4 w-4" />}
              label="Mis citas"
            />
          )}
          {(isOperator || isManager) && (
            <NavLink
              href="/call-center"
              icon={<Headphones className="h-4 w-4" />}
              label="Call center"
            />
          )}
          {isManager && (
            <>
              <NavLink href="/leads" icon={<Users className="h-4 w-4" />} label="Leads" />
              <NavLink
                href="/dashboard"
                icon={<BarChart3 className="h-4 w-4" />}
                label="Analítica"
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

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
          <Image
            src="/brand/ymc-logo-horizontal.svg"
            alt="YMC"
            width={160}
            height={22}
            priority
            className="h-6 w-auto"
          />
          <SignOutButton compact />
        </div>
        <div className="p-4 md:p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 hover:bg-ymc-redLight hover:text-ymc-red transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
