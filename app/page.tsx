import { cookies } from "next/headers";
import { ResearcherSetupApp } from "@/components/ResearcherSetupApp";
import { isResumableParticipantStatus } from "@/services/participantSessionRecovery";
import { PARTICIPANT_SESSION_COOKIE, verifyParticipantSessionCookie } from "@/services/server/participantAuth";
import { RESEARCHER_SESSION_COOKIE, verifyResearcherSessionToken } from "@/services/server/researcherAuth";
import { findStudySessionByPublicId } from "@/services/server/sessionRepository";

interface Props {
  searchParams: Promise<{ researcherAccess?: string }>;
}

function safeAccessTarget(value: string | undefined): string | undefined {
  return value?.startsWith("/researcher/") && !value.startsWith("//") ? value : undefined;
}

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const researcherAuthenticated = verifyResearcherSessionToken(cookieStore.get(RESEARCHER_SESSION_COOKIE)?.value);
  let resumableParticipantSessionId: string | undefined;
  const ownedParticipantSessionId = verifyParticipantSessionCookie(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value);
  if (ownedParticipantSessionId) {
    try {
      const row = await findStudySessionByPublicId(ownedParticipantSessionId);
      if (row && isResumableParticipantStatus(row.session_status)) resumableParticipantSessionId = row.public_session_id;
    } catch {
      // A temporary central-storage failure must not expose session information
      // or prevent the normal public entry page from loading.
    }
  }
  return <ResearcherSetupApp
    initialAccessTarget={safeAccessTarget(params.researcherAccess)}
    researcherAuthenticated={researcherAuthenticated}
    resumableParticipantSessionId={resumableParticipantSessionId}
  />;
}
