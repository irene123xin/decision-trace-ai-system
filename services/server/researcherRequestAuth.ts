import "server-only";

import type { NextRequest } from "next/server";
import { RESEARCHER_SESSION_COOKIE, verifyResearcherSessionToken } from "@/services/server/researcherAuth";

export function isResearcherRequestAuthorised(request: NextRequest): boolean {
  return verifyResearcherSessionToken(request.cookies.get(RESEARCHER_SESSION_COOKIE)?.value);
}
