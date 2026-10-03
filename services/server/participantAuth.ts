import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PARTICIPANT_SESSION_COOKIE = "participant_session";
export const PARTICIPANT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function cookieSecret(): string {
  const value = process.env.RESEARCHER_COOKIE_SECRET?.trim();
  if (!value) throw new Error("Participant session signing is not configured.");
  return value;
}

export function createParticipantAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashParticipantAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function verifyParticipantAccessToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashParticipantAccessToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createParticipantSessionCookie(publicSessionId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ s: publicSessionId, e: Math.floor(now / 1000) + PARTICIPANT_SESSION_MAX_AGE_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", cookieSecret()).update(`participant:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyParticipantSessionCookie(value: string | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expectedSignature = createHmac("sha256", cookieSecret()).update(`participant:${payload}`).digest("base64url");
  const actual = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s?: unknown; e?: unknown };
    if (typeof parsed.s !== "string" || typeof parsed.e !== "number" || parsed.e <= Math.floor(now / 1000)) return null;
    return parsed.s;
  } catch {
    return null;
  }
}
