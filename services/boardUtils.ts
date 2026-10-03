import type { BoardSectionId, FinalDirectionBoard } from "@/types";

export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
export const isValidHex = (value: string) => /^#[0-9A-F]{6}$/i.test(value);
export const MIN_IMAGE_DIRECTION_NOTE_CHARACTERS = 15;
export const MIN_FINAL_RATIONALE_CHARACTERS = 150;
export const countNonWhitespaceCharacters = (text: string) => text.replace(/\s/g, "").length;

export const boardSectionLabels: Record<BoardSectionId, string> = {
  concept: "Brand concept",
  keywords: "Brand keywords",
  personality: "Brand personality",
  audience: "Audience interpretation",
  palette: "Colour palette",
  typography: "Typography direction",
  logo: "Logo / symbol direction",
  visuals: "Visual style references",
  tone: "Tone of voice",
  principles: "Visual do’s and don’ts",
  rationale: "Final rationale",
};

export const requiredBoardSections: BoardSectionId[] = ["concept", "keywords", "personality", "audience", "palette", "logo", "visuals", "rationale"];
export const supportingBoardSections: BoardSectionId[] = ["typography", "tone", "principles"];
export const boardSectionOrder: BoardSectionId[] = [...requiredBoardSections, ...supportingBoardSections];

export function getBoardReadiness(board: FinalDirectionBoard): Record<BoardSectionId, boolean> {
  const colours = [board.primaryColour, board.secondaryColour1, board.secondaryColour2, board.accentColour];
  return {
    concept: countWords(board.concept) >= 30 && countWords(board.concept) <= 60,
    keywords: board.keywords.length === 6 && board.keywords.every((value) => value.trim()),
    personality: board.personalityTraits.length === 4,
    audience: Boolean(board.audienceDescription.trim() && board.audienceCoreNeed.trim() && board.audienceEmotionalResponse.trim())
      && countWords(board.audienceDescription) <= 20 && countWords(board.audienceCoreNeed) <= 15 && countWords(board.audienceEmotionalResponse) <= 15,
    palette: colours.every(isValidHex) && countWords(board.paletteRationale) <= 30,
    typography: Boolean(board.primaryTypeStyle && board.secondaryTypeStyle && board.typographyMood.length),
    logo: Boolean(board.selectedLogoImageId)
      && countNonWhitespaceCharacters(board.logoDirectionNote.trim()) >= MIN_IMAGE_DIRECTION_NOTE_CHARACTERS
      && countWords(board.logoDirectionNote) <= 40,
    visuals: board.selectedVisualImageIds.length >= 1
      && board.selectedVisualImageIds.length <= 3
      && board.selectedVisualImageIds.every((id) => countNonWhitespaceCharacters((board.visualReferenceNotes[id] ?? "").trim()) >= MIN_IMAGE_DIRECTION_NOTE_CHARACTERS),
    tone: board.toneTraits.length === 3 && Boolean(board.sampleLine.trim()) && countWords(board.sampleLine) <= 20,
    principles: board.visualDos.length === 3 && board.visualDonts.length === 3
      && board.visualDos.every((value) => value.trim() && countWords(value) <= 8)
      && board.visualDonts.every((value) => value.trim() && countWords(value) <= 8),
    rationale: countNonWhitespaceCharacters(board.rationale.trim()) >= MIN_FINAL_RATIONALE_CHARACTERS
      && countWords(board.rationale) <= 80,
  };
}

export function reconcileImageSectionConfirmations(board: FinalDirectionBoard): FinalDirectionBoard {
  const readiness = getBoardReadiness(board);
  const confirmedSections = board.confirmedSections.filter((section) => {
    if (section === "logo") return readiness.logo;
    if (section === "visuals") return readiness.visuals;
    return true;
  });
  return confirmedSections.length === board.confirmedSections.length ? board : { ...board, confirmedSections };
}

export function updateBoardField<K extends keyof FinalDirectionBoard>(
  board: FinalDirectionBoard,
  key: K,
  value: FinalDirectionBoard[K],
): FinalDirectionBoard {
  return reconcileImageSectionConfirmations({ ...board, [key]: value });
}

export function getBoardCompletion(board: FinalDirectionBoard): Record<BoardSectionId, boolean> {
  const readiness = getBoardReadiness(board);
  return Object.fromEntries(
    boardSectionOrder.map((section) => [section, readiness[section] && board.confirmedSections.includes(section)]),
  ) as Record<BoardSectionId, boolean>;
}

export function getBoardErrors(board: FinalDirectionBoard): string[] {
  const completion = getBoardCompletion(board);
  const errors: string[] = [];
  if (!completion.concept) errors.push("Brand concept — still needed at 30–60 words.");
  if (!completion.keywords) errors.push("Brand keywords — six final keywords are still needed.");
  if (!completion.personality) errors.push("Brand personality — select exactly four traits.");
  if (!completion.audience) errors.push("Audience interpretation — complete the three concise fields within their limits.");
  if (!completion.palette) errors.push("Colour palette — four valid HEX colours are still needed.");
  if (!completion.logo) errors.push("Logo / symbol direction — add one image, a direction note of at least 15 characters, and mark the section complete.");
  if (!completion.visuals) errors.push("Visual references — add one to three images, a direction note of at least 15 characters for each selected image, and mark the section complete.");
  if (!completion.rationale) errors.push(`Final rationale — add at least ${MIN_FINAL_RATIONALE_CHARACTERS} characters and use no more than 80 words.`);
  return errors;
}

export function getBoardProgress(board: FinalDirectionBoard) {
  const completion = getBoardCompletion(board);
  return {
    completion,
    requiredComplete: requiredBoardSections.filter((section) => completion[section]).length,
    supportingComplete: supportingBoardSections.filter((section) => completion[section]).length,
    allComplete: boardSectionOrder.filter((section) => completion[section]).length,
  };
}
