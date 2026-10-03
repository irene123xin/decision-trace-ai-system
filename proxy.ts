import { NextRequest, NextResponse } from "next/server";
import {
  RESEARCHER_SESSION_COOKIE,
  verifyResearcherSessionToken,
} from "@/services/server/researcherAuth";

function clearResearcherAccess(response: NextResponse) {
  response.cookies.set(RESEARCHER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authorised = verifyResearcherSessionToken(request.cookies.get(RESEARCHER_SESSION_COOKIE)?.value);

  if (pathname === "/") return NextResponse.next();

  if (pathname.startsWith("/session/")) {
    return clearResearcherAccess(NextResponse.next());
  }

  if (pathname === "/researcher" || pathname === "/researcher/setup") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (authorised) return NextResponse.next();

  if (pathname.startsWith("/api/researcher/")) {
    return NextResponse.json({ error: "RESEARCHER_ACCESS_REQUIRED" }, { status: 401 });
  }

  const destination = new URL("/", request.url);
  destination.searchParams.set("researcherAccess", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/", "/researcher/:path*", "/api/researcher/:path*", "/session/:path*"],
};
