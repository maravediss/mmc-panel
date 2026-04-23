import { createClient } from './supabase/server';
import type { Commercial } from './types';

export async function getCurrentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentCommercial(): Promise<Commercial | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('mmc_commercials')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  return data as Commercial | null;
}
