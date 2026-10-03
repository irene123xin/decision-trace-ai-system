import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/services/server/supabaseServer";
import type { Database } from "@/types/database";

let adminClient: SupabaseClient<Database> | null = null;

/** Server-only singleton. Authentication persistence is disabled by its factory. */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  adminClient ??= createSupabaseServerClient();
  return adminClient;
}
