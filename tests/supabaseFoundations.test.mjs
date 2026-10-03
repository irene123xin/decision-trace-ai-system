import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const migration = read("supabase/migrations/20260804120000_phase1_remote_storage_foundations.sql");
const environment = read("services/server/environment.ts");
const serverClient = read("services/server/supabaseServer.ts");
const adminClient = read("services/server/supabaseAdmin.ts");
const sessionRepository = read("services/server/sessionRepository.ts");
const diagnostic = read("scripts/checkSupabaseConnection.mjs");

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry) ? [path] : [];
  });
}

test("environment validation and diagnostics never interpolate credential values", () => {
  assert.doesNotMatch(environment, /secretKey[^\n]*throw|console\.(?:log|error)[^\n]*(?:secretKey|publishableKey|url)/i);
  assert.doesNotMatch(diagnostic, /console\.(?:log|error)\([^\n]*(?:primarySecret|legacySecret|NEXT_PUBLIC_SUPABASE_URL)/);
  assert.match(diagnostic, /configuration_missing/);
});

test("the privileged Supabase clients are explicitly server-only and stateless", () => {
  assert.match(serverClient, /^import "server-only";/);
  assert.match(adminClient, /^import "server-only";/);
  assert.match(serverClient, /persistSession: false/);
  assert.match(serverClient, /autoRefreshToken: false/);
  assert.match(serverClient, /getSupabaseServerEnvironment/);
});

test("the session repository creates the required database payload", () => {
  for (const field of [
    "public_session_id",
    "participant_code",
    "participant_access_token_hash",
    "trace_enabled",
    "study_status",
    "session_status",
    "session_data",
  ]) assert.match(sessionRepository, new RegExp(`${field}:`));
});

test("optimistic updates require and increment the expected revision", () => {
  assert.match(sessionRepository, /expectedRevision: number/);
  assert.match(sessionRepository, /revision: expectedRevision \+ 1/);
  assert.match(sessionRepository, /\.eq\("revision", expectedRevision\)/);
});

test("a stale revision returns a deterministic conflict instead of overwriting", () => {
  assert.match(sessionRepository, /status: "conflict", expectedRevision/);
  assert.doesNotMatch(sessionRepository, /upsert\(/);
});

test("participant-facing source does not import privileged Supabase modules", () => {
  const participantRoots = ["app/session", "components"].map((path) => fileURLToPath(new URL(path, root)));
  const prohibited = /services\/server\/(?:supabaseAdmin|supabaseServer|sessionRepository|imageRepository|calibrationRepository)/;
  for (const directory of participantRoots) {
    for (const file of sourceFiles(directory)) assert.doesNotMatch(readFileSync(file, "utf8"), prohibited, file);
  }
});

test("the migration enables RLS on every study table without permissive policies", () => {
  for (const table of ["study_sessions", "generated_images", "calibration_workspaces"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.doesNotMatch(migration, /create\s+policy/i);
  assert.doesNotMatch(migration, /to\s+(?:anon|public)/i);
});

test("the generated-images bucket is private and has no object policy", () => {
  assert.match(migration, /'generated-images'[\s\S]*?false/i);
  assert.match(migration, /public\s*=\s*false/i);
  assert.doesNotMatch(migration, /create\s+policy[\s\S]*?storage\.objects/i);
});
