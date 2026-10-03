import { NextResponse } from "next/server";
import { getAITextConfigurationStatus } from "@/services/server/geminiTextService";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(getAITextConfigurationStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
