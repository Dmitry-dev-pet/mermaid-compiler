import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type HostedSupabaseConfig = {
  url: string;
  anonKey: string;
};

const DEFAULT_SUPABASE_URL = 'https://wpefygslnzayhkgsvkju.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PKddSaNILSZ36WEQWLA9aQ_o492crt8';

const resolveHostedSupabaseConfig = (): HostedSupabaseConfig => {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL).trim();
  const anonKey = (
    import.meta.env.VITE_SUPABASE_ANON_KEY ??
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  ).trim();
  return { url, anonKey };
};

let hostedClient: SupabaseClient | null | undefined;

export const getHostedSupabaseClient = (): SupabaseClient | null => {
  if (hostedClient !== undefined) return hostedClient;

  const { url, anonKey } = resolveHostedSupabaseConfig();
  hostedClient =
    url && anonKey
      ? createClient(url, anonKey, {
          auth: {
            persistSession: true,
            detectSessionInUrl: true,
          },
        })
      : null;

  return hostedClient;
};

