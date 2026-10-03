import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const RESEARCHER_SESSION_COOKIE = "researcher_access_session";
export const RESEARCHER_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

function configuredPins(): string[] {
  return [...new Set([
    process.env.RESEARCHER_PIN?.trim(),
    process.env.RESEARCHER_ACCESS_PIN?.trim(),
  ].filter((value): value is string => Boolean(value)))];
}

function configuredCookieSecret(): string | null {
  const secret = process.env.RESEARCHER_COOKIE_SECRET?.trim();
  return secret ? secret : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`researcher:${payload}`, "utf8").digest("base64url");
}

export function verifyResearcherPin(candidate: string): boolean {
  const candidateDigest = digest(candidate.trim());
  let matched = false;
  for (const expected of configuredPins()) matched = timingSafeEqual(candidateDigest, digest(expected)) || matched;
  return matched;
}

export function createResearcherSessionToken(now = Date.now()): string {
  const secret = configuredCookieSecret();
  if (!secret) throw new Error("Researcher cookie signing is not configured");

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + RESEARCHER_SESSION_MAX_AGE_SECONDS;
  const payload = `${issuedAt}.${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyResearcherSessionToken(token: string | undefined, now = Date.now()): boolean {
  const secret = configuredCookieSecret();
  if (!secret || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [issuedAtValue, expiresAtValue, nonce, suppliedSignature] = parts;
  const issuedAt = Number(issuedAtValue);
  const expiresAt = Number(expiresAtValue);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || !nonce) return false;
  if (issuedAt > nowSeconds + 60 || expiresAt <= nowSeconds || expiresAt - issuedAt > RESEARCHER_SESSION_MAX_AGE_SECONDS) return false;

  const payload = `${issuedAtValue}.${expiresAtValue}.${nonce}`;
  const expectedSignature = signature(payload, secret);
  const expectedDigest = digest(expectedSignature);
  const suppliedDigest = digest(suppliedSignature);
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
