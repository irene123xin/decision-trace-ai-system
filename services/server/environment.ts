import "server-only";

import type { StudyStatus } from "@/types";

export interface SupabaseServerEnvironment {
  url: string;
  publishableKey: string;
  secretKey: string;
  secretKeySource: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
}

function required(name: string, value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) throw new Error(`Missing required environment variable: ${name}.`);
  return configured;
}

function validUrl(name: string, value: string | undefined): string {
  const configured = required(name, value);
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("unsupported protocol");
  } catch {
    throw new Error(`Environment variable ${name} must contain a valid HTTPS URL.`);
  }
  return configured;
}

/**
 * Read only when a server-side Supabase operation is requested. Keeping
 * validation lazy allows the existing local prototype and unrelated tests to
 * run before the remote-storage migration is enabled.
 */
export function getSupabaseServerEnvironment(): SupabaseServerEnvironment {
  const primarySecret = process.env.SUPABASE_SECRET_KEY?.trim();
  const legacySecret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!primarySecret && !legacySecret) {
    throw new Error("Missing required environment variable: SUPABASE_SECRET_KEY (SUPABASE_SERVICE_ROLE_KEY is supported only as a legacy fallback).");
  }
  return {
    url: validUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    secretKey: primarySecret ?? legacySecret!,
    secretKeySource: primarySecret ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY",
  };
}

/** Public session creation always derives its phase on the server. */
export function getStudyPhase(): Exclude<StudyStatus, "excluded"> {
  const value = process.env.STUDY_PHASE?.trim();
  return value === "pilot" || value === "formal" || value === "development_test" ? value : "development_test";
}
