import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!url || !anonKey) {
  // Fails loudly in dev rather than silently no-op'ing every query.
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — copy .env.local.example to .env.local"
  );
}

// Anon-key client only. Every write this client can make is gated by the
// RLS policies in supabase/schema.sql — it never sees the service-role key,
// which lives only in the worker's environment.
export const supabase = createClient(url, anonKey);
