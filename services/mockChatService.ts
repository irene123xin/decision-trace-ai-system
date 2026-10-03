import type { GeneratedImage, ImageKind } from "@/types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getMockChatResponse(prompt: string): Promise<string> {
  await delay(650);
  const text = prompt.toLowerCase();

  if (text.includes("concept")) {
    return "Two possible concept approaches: one can treat fragrance as a trace of an ordinary place encountered in passing; another can explore how scent makes a familiar moment feel unexpectedly vivid. They offer different starting points for a personal and sensory direction.";
  }
  if (text.includes("keyword")) {
    return "One possible keyword set is Tactile, Specific, Immediate, Atmospheric, Open and Observational. As an alternative, you could shift toward Intimate, Fragmented, Familiar, Curious, Material and Unfixed.";
  }
  if (text.includes("personality") || text.includes("trait")) {
    return "One personality option is Grounded, Expressive, Contemporary and Human. A more restrained alternative could be Clear, Experimental, Structured and Approachable. These are starting points rather than final selections.";
  }
  if (text.includes("audience") || text.includes("core need")) {
    return "You could interpret the audience as young adults who approach fragrance through sensory curiosity and personal association. A possible core need is a fragrance experience that feels relevant to everyday life; the desired response might be curiosity and personal connection.";
  }
  if (text.includes("colour") || text.includes("palette")) {
    return "One material-led option is Fired Umber #6A4E42, Paper Fibre #D8C7B2, Chalk #EEE9DF and Cobalt Note #315C78. A distinctly different route could use cooler mineral colours or a sharper high-contrast palette.";
  }
  if (text.includes("logo") || text.includes("symbol")) {
    return "Consider an abstract threshold made from two offset planes, or a compact symbol based on an implied passage within the letter E. A third route could use a more literal object or gesture if that better supports your concept.";
  }
  if (text.includes("typograph") || text.includes("type style") || text.includes("font")) {
    return "One option is a direct Grotesk Sans with a restrained Monospaced secondary layer; another is a Serif paired with a more expressive Display direction. Compare which better supports the concept you are developing.";
  }
  if (text.includes("tone") || text.includes("voice") || text.includes("speak")) {
    return "A Clear, Thoughtful and Direct tone could describe sensory details without prescribing emotion. One sample line is: “A room remembered by its light.” A more conversational direction could use shorter observations from everyday places.";
  }
  if (text.includes("do") || text.includes("principle") || text.includes("avoid")) {
    return "Possible principles: frame ordinary details precisely, use deliberate material contrast, and keep image choices consistent with the concept. The corresponding don’ts should describe choices that would weaken the particular direction you select.";
  }
  if (text.includes("image") || text.includes("visual") || text.includes("mood")) {
    return "Try an editorial direction built from close-cropped environmental details, paper fibres, worn surfaces and directional daylight. A contrasting option could use staged objects, typographic captions and controlled colour fields.";
  }
  if (text.includes("refine") || text.includes("change") || text.includes("warmer")) {
    return "A possible refinement is to make the direction more immediate by replacing nostalgic cues with present-tense observations, sharper crops and specific material details. You could keep warmth through texture rather than through romantic language.";
  }
  return "For Elsewhere, I can help explore a specific part of the brief, compare distinct directions, or respond to a constraint you introduce. Tell me what you would like to examine.";
}
