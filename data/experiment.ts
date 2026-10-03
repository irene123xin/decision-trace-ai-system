export const DEFAULT_TASK_DURATION_MINUTES = 45;
export const PARTICIPANT_MESSAGE_LIMIT = 40;
export const DEFAULT_IMAGE_REQUEST_LIMIT = 5;
export const DEFAULT_IMAGE_TOTAL_LIMIT = 10;
export const DEFAULT_IMAGES_PER_REQUEST = 2;
export const ELSEWHERE_IMAGE_PROMPT_VERSION = "elsewhere-image-v1";

export const ELSEWHERE_EXPERIMENT_METADATA = {
  brandBriefId: "elsewhere-fragrance-v2",
  taskGuideVersion: "elsewhere-guide-v2",
  textPromptVersion: "elsewhere-text-v2",
  imagePromptVersion: ELSEWHERE_IMAGE_PROMPT_VERSION,
  configuredImageRequestLimit: DEFAULT_IMAGE_REQUEST_LIMIT,
  configuredImageTotalLimit: DEFAULT_IMAGE_TOTAL_LIMIT,
  configuredImagesPerRequest: DEFAULT_IMAGES_PER_REQUEST,
} as const;

export const ELSEWHERE_BRIEF = {
  brandName: "Elsewhere",
  category: "Independent fragrance brand",
  title: "Elsewhere — Early Brand Identity",
  task: "Develop one coherent early-stage brand identity direction for Elsewhere, an independent fragrance brand.",
  context: "Elsewhere creates fragrances inspired by ordinary places, passing moments and personal memories.",
  positioning: "Rather than presenting fragrance primarily through luxury, gender or social status, the brand focuses on fragrance as a personal and sensory experience.",
  audience: "Young adults aged 20–35 who are interested in fragrance as part of everyday personal experience.",
  output: "Develop one coherent early brand identity direction using the AI-assisted workspace. Complete the required areas of the Working Board and review the direction as a whole before submission.",
  fixedNameNote: "The brand name is provided and does not need to be changed.",
} as const;
