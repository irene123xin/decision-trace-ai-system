import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createResearcherSessionToken,
  RESEARCHER_SESSION_COOKIE,
  RESEARCHER_SESSION_MAX_AGE_SECONDS,
  verifyResearcherPin,
} from "@/services/server/researcherAuth";

export const runtime = "nodejs";

const failedAttempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function requestKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function POST(request: Request) {
  const key = requestKey(request);
  const now = Date.now();
  const existing = failedAttempts.get(key);
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const pin = value && typeof value === "object" && "pin" in value ? (value as { pin?: unknown }).pin : undefined;
  const validPin = typeof pin === "string" && pin.length <= 256 && verifyResearcherPin(pin);
  if (validPin) failedAttempts.delete(key);
  if (!validPin && existing && existing.resetAt > now && existing.count >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({ ok: false }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  }
  if (!validPin) {
    const current = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + WINDOW_MS };
    failedAttempts.set(key, { ...current, count: current.count + 1 });
    return NextResponse.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const cookieStore = await cookies();
  cookieStore.set(RESEARCHER_SESSION_COOKIE, createResearcherSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RESEARCHER_SESSION_MAX_AGE_SECONDS,
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.set(RESEARCHER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
