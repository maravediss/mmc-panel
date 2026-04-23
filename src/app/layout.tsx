import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import './globals.css';

const ubuntu = localFont({
  src: [
    { path: '../../public/fonts/Ubuntu/Ubuntu-Light.ttf', weight: '300', style: 'normal' },
    { path: '../../public/fonts/Ubuntu/Ubuntu-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Ubuntu/Ubuntu-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../../public/fonts/Ubuntu/Ubuntu-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
});

const play = localFont({
  src: [
    { path: '../../public/fonts/Play/Play-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Play/Play-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MMC Panel — Yamaha Málaga Center',
  description: 'Panel de gestión comercial Yamaha Málaga Center',
  icons: {
    icon: '/brand/favicon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={cn(ubuntu.variable, play.variable)}>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
