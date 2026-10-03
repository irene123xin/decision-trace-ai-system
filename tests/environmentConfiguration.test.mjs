import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const environmentSource = readFileSync(new URL("../services/server/environment.ts", import.meta.url), "utf8");
const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Supabase environment validation is server-only and lazy", () => {
  assert.match(environmentSource, /^import "server-only";/);
  assert.match(environmentSource, /export function getSupabaseServerEnvironment/);
  assert.doesNotMatch(environmentSource, /^const .*getSupabaseServerEnvironment\(\)/m);
});

test("the primary Supabase secret supports only an explicit legacy fallback", () => {
  assert.match(environmentSource, /process\.env\.SUPABASE_SECRET_KEY/);
  assert.match(environmentSource, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(environmentSource, /secretKey: primarySecret \?\? legacySecret/);
});

test("safe templates contain placeholders without credential values", () => {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "RESEARCHER_PIN",
    "RESEARCHER_COOKIE_SECRET",
  ]) assert.match(example, new RegExp(`^${name}=$`, "m"));
});

test("environment files and local package stores are ignored", () => {
  for (const rule of [".env", ".env.local", ".env*.local", ".pnpm-store"]) {
    assert.ok(gitignore.split(/\r?\n/).includes(rule));
  }
  assert.ok(gitignore.split(/\r?\n/).includes("!.env.example"));
});

test("only the required official Supabase dependencies were added", () => {
  assert.equal(typeof manifest.dependencies["@supabase/supabase-js"], "string");
  assert.equal(typeof manifest.dependencies["@supabase/ssr"], "string");
});
