import type { FinalDirectionBoard, GeneratedImage, Session, SessionSetupData } from "@/types";
import { ELSEWHERE_EXPERIMENT_METADATA } from "@/data/experiment";
import { createPreAiStartingPoint } from "@/services/preAiStartingPoint";
import { createPostTaskQuestionnaires } from "@/services/postTaskQuestionnaires";

export const emptyBoard: FinalDirectionBoard = {
  concept: "",
  keywords: ["", "", "", "", "", ""],
  personalityTraits: [],
  audienceDescription: "",
  audienceCoreNeed: "",
  audienceEmotionalResponse: "",
  primaryColour: "",
  secondaryColour1: "",
  secondaryColour2: "",
  accentColour: "",
  paletteRationale: "",
  primaryTypeStyle: "",
  secondaryTypeStyle: "",
  typographyMood: [],
  typographyRationale: "",
  logoDirectionNote: "",
  selectedVisualImageIds: [],
  visualReferenceNotes: {},
  toneTraits: [],
  sampleLine: "",
  visualDos: ["", "", ""],
  visualDonts: ["", "", ""],
  rationale: "",
  confirmedSections: [],
};

export function createEmptyBoard(): FinalDirectionBoard {
  return {
    ...emptyBoard,
    keywords: [...emptyBoard.keywords],
    personalityTraits: [],
    typographyMood: [],
    selectedVisualImageIds: [],
    visualReferenceNotes: {},
    toneTraits: [],
    visualDos: [...emptyBoard.visualDos],
    visualDonts: [...emptyBoard.visualDonts],
    confirmedSections: [],
  };
}

export function normaliseBoard(value?: Partial<FinalDirectionBoard> & { selectedVisualImageId?: string }): FinalDirectionBoard {
  const clean = createEmptyBoard();
  if (!value) return clean;
  const legacyVisuals = value.selectedVisualImageIds ?? (value.selectedVisualImageId ? [value.selectedVisualImageId] : []);
  return {
    ...clean,
    ...value,
    keywords: value.keywords?.length ? [...value.keywords] : clean.keywords,
    personalityTraits: [...(value.personalityTraits ?? [])],
    typographyMood: [...(value.typographyMood ?? [])],
    selectedVisualImageIds: [...legacyVisuals],
    visualReferenceNotes: { ...(value.visualReferenceNotes ?? {}) },
    toneTraits: [...(value.toneTraits ?? [])],
    visualDos: value.visualDos?.length ? [...value.visualDos] : clean.visualDos,
    visualDonts: value.visualDonts?.length ? [...value.visualDonts] : clean.visualDonts,
    confirmedSections: [...(value.confirmedSections ?? [])],
  };
}

export function createSession(setup: SessionSetupData): Session {
  const createdAt = new Date().toISOString();
  return {
    id: `SESSION-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    ...setup,
    ...ELSEWHERE_EXPERIMENT_METADATA,
    configuredDurationMinutes: setup.taskDurationMinutes,
    startedAt: createdAt,
    status: "ready",
    studyStatus: "development_test",
    humanCoding: [],
    preAiStartingPoint: createPreAiStartingPoint(),
    postTaskQuestionnaires: createPostTaskQuestionnaires(setup.condition),
    messages: [],
    images: [],
    decisions: [],
    aiPropositions: [],
    traceClassifications: [],
    boardEvents: [],
    researchEvents: [],
    aiTextRequests: [],
    imageRequests: [],
    board: createEmptyBoard(),
    imageRequestCount: 0,
    attemptNumber: 1,
  };
}

function demoImages(now: string): GeneratedImage[] {
  return [
    { id: "IMG01", kind: "logo", prompt: "Abstract threshold symbol built from two offset planes", createdAt: now, relatedTurn: 3, palette: ["#534B45", "#D7C8B6", "#B56F52"], label: "Threshold form 1" },
    { id: "IMG02", kind: "logo", prompt: "Typographic E symbol shaped by an implied passage", createdAt: now, relatedTurn: 3, palette: ["#343A42", "#E1D8CA", "#A58B73"], label: "Passage mark 2" },
    { id: "IMG03", kind: "visual", prompt: "Editorial study of old paper, rain-dark pavement and angled daylight", createdAt: now, relatedTurn: 4, palette: ["#5A5550", "#C9BCA9", "#C77E5E"], label: "Environmental memory 3" },
    { id: "IMG04", kind: "visual", prompt: "Tactile material fragments and close-cropped domestic surfaces", createdAt: now, relatedTurn: 4, palette: ["#43484A", "#DED4C5", "#8D8178"], label: "Material memory 4" },
  ];
}

export function createDemoSession(): Session {
  const now = new Date().toISOString();
  const session = createSession({
    participantId: "P01",
    researcherId: "R01",
    condition: "B",
    sessionDate: now.slice(0, 10),
    taskDurationMinutes: 45,
  });
  session.status = "active";
  session.participantStartedAt = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  session.startedAt = session.participantStartedAt;
  session.preAiStartingPoint = {
    status: "submitted",
    initialInterpretation: "Elsewhere treats fragrance as a way to hold ordinary places and passing memories in a contemporary identity.",
    keywords: ["Sensory", "Everyday", "Memory"],
    visualQuestion: "How might an identity suggest a remembered place without illustrating it literally?",
    startedAt: session.participantStartedAt,
    submittedAt: new Date(new Date(session.participantStartedAt).getTime() + 3 * 60 * 1000).toISOString(),
    durationMs: 3 * 60 * 1000,
  };
  session.imageRequestCount = 2;
  session.images = demoImages(now);
  session.imageRequests = [1, 2].map((requestNumber) => ({
    requestId: `demo-image-0${requestNumber}`,
    sessionId: session.id,
    participantId: session.participantId,
    createdAt: now,
    completedAt: now,
    promptText: requestNumber === 1 ? "Generate two abstract symbol directions based on thresholds and passages." : "Create visual references using material fragments, old paper and rain-dark pavement.",
    effectivePrompt: "Historical simulated Elsewhere image prompt.",
    provider: "Mock",
    model: "mock-elsewhere-image-v1",
    promptVersion: "elsewhere-image-v1",
    requestedImageCount: 2,
    returnedImageCount: 2,
    status: "succeeded" as const,
    imageIds: requestNumber === 1 ? ["IMG01", "IMG02"] : ["IMG03", "IMG04"],
    latencyMs: 900,
  }));
  session.images = session.images.map((image, index) => ({
    ...image,
    requestId: index < 2 ? "demo-image-01" : "demo-image-02",
    sessionId: session.id,
    imageIndex: (index % 2) + 1,
    mimeType: "image/svg+xml",
    displayedAt: now,
    usageTargets: image.id === "IMG01" ? ["logoSymbolDirection"] : ["IMG03", "IMG04"].includes(image.id) ? ["visualStyleReferences"] : [],
    usageEvents: [],
  }));
  session.messages = [
    { id: "M01", role: "participant", content: "Suggest two distinct concept approaches based on ordinary places and personal memories.", turn: 1, createdAt: now },
    { id: "M02", role: "assistant", content: "One option could frame fragrance as a trace of a place; another could focus on the way familiar moments become unexpectedly vivid. They offer distinct ways to explore personal sensory experience.", turn: 1, createdAt: now, provider: "Mock", modelId: "mock-elsewhere-text-v2", promptVersion: "elsewhere-text-v2", integrationMode: "mock", requestId: "demo-text-01" },
    { id: "M03", role: "participant", content: "Develop the place-trace idea, but make it less nostalgic and more immediate.", turn: 2, createdAt: now },
    { id: "M04", role: "assistant", content: "The revised direction could treat scent as evidence of a place encountered now: material, specific and open to personal interpretation rather than sentimental recollection.", turn: 2, createdAt: now, provider: "Mock", modelId: "mock-elsewhere-text-v2", promptVersion: "elsewhere-text-v2", integrationMode: "mock", requestId: "demo-text-02" },
    { id: "M05", role: "participant", content: "Generate two abstract symbol directions based on thresholds and passages.", turn: 3, createdAt: now },
    { id: "M06", role: "assistant", content: "Two early symbol studies use offset planes and implied passages to explore thresholds and movement.", turn: 3, createdAt: now, relatedImageIds: ["IMG01", "IMG02"] },
    { id: "M07", role: "participant", content: "Create visual references using material fragments, old paper and rain-dark pavement.", turn: 4, createdAt: now },
    { id: "M08", role: "assistant", content: "Two visual studies explore environmental memory through tactile fragments, close crops and observational editorial framing.", turn: 4, createdAt: now, relatedImageIds: ["IMG03", "IMG04"] },
  ];
  session.board = {
    ...createEmptyBoard(),
    concept: "Elsewhere treats fragrance as a sensory trace of ordinary places encountered in passing. Material details, environmental fragments and precise language invite personal associations without prescribing a story, creating an accessible identity that feels immediate, distinctive and quietly evocative rather than nostalgic or luxurious.",
    keywords: ["Tactile", "Specific", "Immediate", "Atmospheric", "Open", "Observational"],
    personalityTraits: ["Grounded", "Expressive", "Contemporary", "Human"],
    audienceDescription: "Young adults who approach fragrance through sensory curiosity and personal association.",
    audienceCoreNeed: "A distinctive experience without luxury or gender codes.",
    audienceEmotionalResponse: "Curious, present and personally connected.",
    primaryColour: "#534B45",
    secondaryColour1: "#D7C8B6",
    secondaryColour2: "#E8E2D8",
    accentColour: "#B56F52",
    paletteRationale: "Material neutrals support sensory detail while a fired-clay accent adds presence without luxury cues.",
    primaryTypeStyle: "Grotesk Sans",
    secondaryTypeStyle: "Monospaced",
    typographyMood: ["Editorial", "Precise"],
    typographyRationale: "A direct grotesk and restrained monospaced layer make environmental observations feel collected and immediate.",
    selectedLogoImageId: "IMG01",
    logoDirectionNote: "Offset planes suggest moving between a present place and an associated memory without literal fragrance imagery.",
    selectedVisualImageIds: ["IMG03", "IMG04"],
    visualReferenceNotes: { IMG03: "Environmental detail framed as a present observation.", IMG04: "Tactile fragments without literal perfume imagery." },
    toneTraits: ["Clear", "Thoughtful", "Direct"],
    sampleLine: "A room remembered by its light.",
    visualDos: ["Frame ordinary details precisely", "Use tactile material contrast", "Keep imagery observational"],
    visualDonts: ["Signal conventional perfume luxury", "Use literal flower symbols", "Default to mystical atmosphere"],
    rationale: "The observational concept, direct tone and precise typography position fragrance as a personal sensory record. Material neutrals and fired-clay colour support tactile references, while the threshold symbol and close-cropped environmental imagery connect place, memory and immediate experience without relying on luxury perfume conventions.",
    confirmedSections: ["concept", "keywords", "personality", "audience", "palette", "logo", "visuals", "rationale", "typography", "tone", "principles"],
  };
  const label = { action: "Modify" as const, source: "Mixed" as const, object: "Brand concept" as const, summary: "Changed part of a proposed brand concept direction." };
  session.decisions = [{ id: "D01", timestampSeconds: 462, relatedTurn: 2, confidence: "High", modelGeneratedLabel: "Modify · Mixed · Brand concept", reviewStatus: "Unreviewed", ...label, originalModelLabel: { ...label }, finalReviewedLabel: { ...label } }];
  session.boardEvents = [{ id: "BE01", createdAt: now, timestampSeconds: 470, object: "Brand personality", action: "Human-initiated", summary: "Selected four final brand personality traits." }];
  session.researchEvents = [
    { id: "RE01", type: "briefing_opened", createdAt: session.participantStartedAt, timestampSeconds: 0, summary: "Participant opened the pre-task briefing.", actor: "participant" },
    { id: "RE02", type: "briefing_confirmed", createdAt: session.participantStartedAt, timestampSeconds: 0, summary: "Participant confirmed the briefing statements.", actor: "participant" },
    { id: "RE03", type: "task_started", createdAt: session.participantStartedAt, timestampSeconds: 0, summary: "Participant started the timed task.", actor: "participant" },
    { id: "RE04", type: "pre_ai_started", createdAt: session.participantStartedAt, timestampSeconds: 0, summary: "Participant opened the Starting Point stage.", actor: "participant" },
    { id: "RE05", type: "pre_ai_draft_updated", createdAt: session.preAiStartingPoint.submittedAt!, timestampSeconds: 180, summary: "Participant saved updates to the Starting Point draft.", actor: "participant" },
    { id: "RE06", type: "pre_ai_submitted", createdAt: session.preAiStartingPoint.submittedAt!, timestampSeconds: 180, summary: "Participant submitted the Starting Point record.", actor: "participant" },
  ];
  session.aiTextRequests = [1, 2].map((turn) => ({
    requestId: `demo-text-0${turn}`,
    participantMessageId: turn === 1 ? "M01" : "M03",
    turn,
    startedAt: now,
    serverStartedAt: now,
    completedAt: now,
    status: "succeeded",
    provider: "Mock",
    modelId: "mock-elsewhere-text-v2",
    promptVersion: "elsewhere-text-v2",
    integrationMode: "mock",
    latencyMs: 650,
  }));
  return session;
}

export function restartSession(session: Session): { previousAttempt: Session; nextAttempt: Session } {
  const restartedAt = new Date().toISOString();
  const timestampSeconds = session.participantStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(session.participantStartedAt).getTime()) / 1000)) : 0;
  const previousAttempt: Session = {
    ...session,
    status: "restarted",
    endedAt: restartedAt,
    endReason: "researcher_restart",
    researchEvents: [...session.researchEvents, {
      id: `RE${String(session.researchEvents.length + 1).padStart(2, "0")}`,
      type: "researcher_restart",
      createdAt: restartedAt,
      timestampSeconds,
      summary: "Researcher ended this attempt and created a linked restart attempt.",
      actor: "researcher",
    }],
  };
  const nextAttempt: Session = {
    ...createSession({
      participantId: session.participantId,
      researcherId: session.researcherId,
      condition: session.condition,
      sessionDate: session.sessionDate,
      taskDurationMinutes: session.taskDurationMinutes,
    }),
    attemptNumber: (session.attemptNumber ?? 1) + 1,
    previousAttemptId: session.id,
    startedAt: restartedAt,
    researchEvents: [{ id: "RE01", type: "researcher_restart", createdAt: restartedAt, timestampSeconds: 0, summary: `Created as attempt ${(session.attemptNumber ?? 1) + 1} after a researcher restart.`, actor: "researcher" }],
  };
  return { previousAttempt, nextAttempt };
}
