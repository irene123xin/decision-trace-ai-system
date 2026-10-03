import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerEnvironment } from "@/services/server/environment";
import type { Database } from "@/types/database";

/**
 * Creates a stateless privileged client for protected server code. Never import
 * this module from a Client Component or expose the returned client to a browser.
 */
export function createSupabaseServerClient(): SupabaseClient<Database> {
  const environment = getSupabaseServerEnvironment();
  return createClient<Database>(environment.url, environment.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { "X-Client-Info": "decision-trace-server" } },
  });
}
