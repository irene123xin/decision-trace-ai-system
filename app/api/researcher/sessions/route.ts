import { NextRequest, NextResponse } from "next/server";
import { listStudySessions } from "@/services/server/sessionRepository";
import { isResearcherRequestAuthorised } from "@/services/server/researcherRequestAuth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isResearcherRequestAuthorised(request)) return NextResponse.json({ error: "RESEARCHER_ACCESS_REQUIRED" }, { status: 401 });
  const rows = await listStudySessions();
  return NextResponse.json({ sessions: rows.map((row) => ({ session: row.session_data, revision: row.revision, updatedAt: row.updated_at })) }, { headers: { "Cache-Control": "no-store" } });
}
