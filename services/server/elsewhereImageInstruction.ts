import "server-only";

import { ELSEWHERE_IMAGE_PROMPT_VERSION } from "@/data/experiment";

export { ELSEWHERE_IMAGE_PROMPT_VERSION };

export function buildElsewhereImagePrompt(promptText: string): string {
  return [
    "Participant request (preserve this as the primary creative direction):",
    promptText,
    "",
    "Fixed task context:",
    "This is early-stage brand identity exploration for Elsewhere, an independent fragrance brand inspired by ordinary places, passing moments and personal memories. The audience is adults aged 20–35.",
    "Do not imitate an identifiable existing brand or trademark. Across this logical request, provide two meaningfully distinct interpretations. Produce a visual direction rather than a finished commercial identity unless the participant explicitly requests one. Do not add explanatory text inside the image unless typography or text is explicitly requested.",
  ].join("\n");
}

export function buildVariantPrompt(effectivePrompt: string, variant: "A" | "B"): string {
  const direction = variant === "A"
    ? "Variant A: create one clear interpretation of the participant request."
    : "Variant B: create a meaningfully different interpretation through composition, visual language or material treatment while following the same participant request.";
  return `${effectivePrompt}\n\n${direction}`;
}
