import type { Session } from "@/types";

export function SubmissionConfirmation({ session }: { session: Session }) {
  const completed = session.postTaskQuestionnaires?.studyCompletedAt ? new Date(session.postTaskQuestionnaires.studyCompletedAt) : session.submittedAt ? new Date(session.submittedAt) : new Date();
  return <main className="submissionConfirmation"><div className="entryBrand"><span>E</span><p>AI-assisted creative workspace</p></div><section><p className="eyebrow">ELSEWHERE · EARLY BRAND IDENTITY TASK</p><span className="confirmationMark" aria-hidden>✓</span><h1>Study completed</h1><p>Thank you for taking part.</p><p>Your design session has been completed. You may now close this window.</p><dl><div><dt>Participant code</dt><dd>{session.participantId}</dd></div><div><dt>Completion time</dt><dd>{completed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd></div><div><dt>Session status</dt><dd>Complete</dd></div></dl></section></main>;
}
