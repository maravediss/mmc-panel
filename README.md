# MMC Panel — Yamaha Málaga Center

Panel de gestión comercial interna para Yamaha Málaga Center (Interhanse).

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS + shadcn/ui
- Supabase (Auth + Postgres + RLS) self-hosted en `supabase.interhansia.com`
- Deploy: Coolify en VPS Hetzner, dominio `mmc.interhansia.com`

## Desarrollo local

```bash
cp .env.local.example .env.local   # rellenar valores
npm install
npm run dev
```

## Scripts de infra

```bash
node scripts/seed-admin.mjs   # Crear usuario admin
node scripts/etl-sheet.mjs    # Importar Sheet → Supabase (desde 2026-01-01)
```

Ver [`db/schema.sql`](db/schema.sql) para el modelo de datos.
