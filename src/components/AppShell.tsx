import Link from 'next/link';
import { Calendar, Home, Users, BarChart3 } from 'lucide-react';
import type { Commercial } from '@/lib/types';
import SignOutButton from './SignOutButton';

export default async function AppShell({
  commercial,
  children,
}: {
  commercial: Commercial | null;
  children: React.ReactNode;
}) {
  const isManager = commercial?.role === 'admin' || commercial?.role === 'gerente';

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-white">
        <div className="px-6 py-5 border-b">
          <h1 className="text-lg font-semibold tracking-tight">MMC Panel</h1>
          <p className="text-xs text-muted-foreground">Yamaha Málaga Center</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 text-sm">
          <NavLink href="/" icon={<Home className="h-4 w-4" />} label="Inicio" />
          <NavLink href="/appointments" icon={<Calendar className="h-4 w-4" />} label="Mis citas" />
          {isManager && (
            <>
              <NavLink href="/leads" icon={<Users className="h-4 w-4" />} label="Leads" />
              <NavLink
                href="/dashboard"
                icon={<BarChart3 className="h-4 w-4" />}
                label="Dashboard"
              />
            </>
          )}
        </nav>
        <div className="px-3 py-4 border-t">
          {commercial && (
            <div className="px-3 py-2 text-sm mb-2">
              <div className="font-medium">{commercial.display_name || commercial.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{commercial.role}</div>
            </div>
          )}
          <SignOutButton />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-semibold">MMC Panel</h1>
          <SignOutButton compact />
        </div>
        <div className="p-4 md:p-8 max-w-6xl mx-auto">{children}</div>
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
      className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
