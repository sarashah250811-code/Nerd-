import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** Decode a JWT payload without verifying (only used to refuse a service-role key). */
function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role ?? null;
  } catch {
    return null; // new-style "sb_publishable_…" keys are not JWTs
  }
}

export type ConfigProblem = 'missing' | 'invalid-url' | 'service-role' | null;

function detectProblem(): ConfigProblem {
  if (!url || !key) return 'missing';
  if (!/^https?:\/\//i.test(url)) return 'invalid-url';
  if (jwtRole(key) === 'service_role' || key.startsWith('sb_secret_')) return 'service-role';
  return null;
}

export const configProblem: ConfigProblem = detectProblem();
export const supabaseConfigured = configProblem === null;

/**
 * The single browser-side Supabase client. It only ever holds the public anon
 * key; all authorisation is enforced by Row Level Security in the database.
 */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;
