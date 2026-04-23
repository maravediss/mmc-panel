#!/usr/bin/env node
// Crea el usuario admin inicial (Manuel) en Supabase + fila en mmc_commercials
// Uso: node scripts/seed-admin.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Leer .env.local manualmente
const envPath = resolve(process.cwd(), '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx), l.slice(idx + 1)];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

const USERS = [
  {
    email: 'manuel.revert@interhanse.com',
    password: 'MMC_Admin_2026!', // cambiar al primer login
    name: 'Manuel Revert',
    display_name: 'Manuel',
    role: 'admin',
  },
];

async function run() {
  for (const u of USERS) {
    console.log(`\n→ Creando ${u.email}...`);
    // 1) Crear auth user
    let authUserId;
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { name: u.name },
    });

    if (createErr && !createErr.message?.toLowerCase().includes('already')) {
      console.error('  ✗ auth createUser falló:', createErr.message);
      continue;
    }

    if (authData?.user) {
      authUserId = authData.user.id;
      console.log(`  ✓ auth.users creado id=${authUserId}`);
    } else {
      // ya existía; buscarlo
      const { data: list } = await admin.auth.admin.listUsers();
      authUserId = list?.users?.find((x) => x.email === u.email)?.id;
      console.log(`  ✓ auth.users ya existía id=${authUserId}`);
    }

    if (!authUserId) {
      console.error(`  ✗ no se pudo obtener id de auth para ${u.email}`);
      continue;
    }

    // 2) Upsert mmc_commercials
    const { error: commErr } = await admin
      .from('mmc_commercials')
      .upsert(
        {
          auth_user_id: authUserId,
          name: u.name,
          display_name: u.display_name,
          email: u.email,
          role: u.role,
          is_active: true,
        },
        { onConflict: 'auth_user_id' }
      );

    if (commErr) {
      console.error('  ✗ mmc_commercials upsert:', commErr.message);
    } else {
      console.log(`  ✓ mmc_commercials (${u.role}) listo`);
    }
  }

  console.log('\n✅ Seed completado.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
