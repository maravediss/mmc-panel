import Link from 'next/link';
import Image from 'next/image';
import { Calendar, Home, Users, BarChart3, Headphones, BarChart2, User } from 'lucide-react';
import type { Commercial } from '@/lib/types';
import SignOutButton from './SignOutButton';
import MobileNav from './MobileNav';

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

  // Operadoras: layout minimalista sin sidebar
  if (isOperator) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <header className="sticky top-0 z-30 bg-white border-b px-6 py-3 flex items-center justify-between">
          <Link href="/operator">
            <Image
              src="/brand/ymc-logo-horizontal.svg"
              alt="Yamaha Málaga Center"
              width={180}
              height={26}
              priority
              className="h-6 w-auto"
            />
          </Link>
          <div className="flex items-center gap-4">
            {commercial && (
              <span className="text-sm text-muted-foreground hidden sm:block">
                {commercial.display_name || commercial.name}
              </span>
            )}
            <SignOutButton compact />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">{children}</main>
      </div>
    );
  }

  // Comercial: home efectiva = /comercial; sidebar con 4 pestañas + acceso al perfil en footer
  // Manager (admin/gerente): mismo sidebar + Call center + acceso a Inicio general
  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar desktop */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-r bg-white">
        <div className="px-5 py-5 border-b">
          <Link href={isCommercial ? '/comercial' : '/'} className="block">
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
          {/* Manager ve "Inicio" como home global */}
          {isManager && (
            <NavLink href="/" icon={<Home className="h-4 w-4" />} label="Inicio" />
          )}

          {/* Comercial y manager ven el panel del comercial */}
          {(isCommercial || isManager) && (
            <>
              <NavLink
                href="/comercial"
                icon={<BarChart2 className="h-4 w-4" />}
                label="Mi panel"
              />
              <NavLink
                href="/comercial/citas"
                icon={<Calendar className="h-4 w-4" />}
                label="Mis citas"
              />
              <NavLink
                href="/leads"
                icon={<Users className="h-4 w-4" />}
                label="Todos los leads"
              />
              <NavLink
                href="/comercial/analitica"
                icon={<BarChart3 className="h-4 w-4" />}
                label="Analítica"
              />
            </>
          )}

          {isManager && (
            <>
              <div className="mt-3 mb-1 px-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                Gestión
              </div>
              <NavLink
                href="/call-center"
                icon={<Headphones className="h-4 w-4" />}
                label="Call center"
              />
              <NavLink
                href="/dashboard"
                icon={<BarChart3 className="h-4 w-4" />}
                label="Analítica avanzada"
              />
            </>
          )}
        </nav>
        <div className="px-3 py-4 border-t space-y-2">
          {commercial && (
            <Link
              href="/comercial/perfil"
              className="block px-3 py-2 text-sm rounded-md hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {commercial.display_name || commercial.name}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {commercial.role} · Mi perfil
                  </div>
                </div>
              </div>
            </Link>
          )}
          <SignOutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-white border-b px-4 py-3 flex items-center justify-between gap-3">
          <MobileNav commercial={commercial} />
          <Link href={isCommercial ? '/comercial' : '/'} className="flex-1">
            <Image
              src="/brand/ymc-logo-horizontal.svg"
              alt="YMC"
              width={160}
              height={22}
              priority
              className="h-6 w-auto"
            />
          </Link>
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
