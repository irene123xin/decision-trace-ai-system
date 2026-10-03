export async function lockResearcherAccess(): Promise<void> {
  try {
    await fetch("/api/researcher-access", {
      method: "DELETE",
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
    });
  } catch {
    // Participant routing clear the researcher cookie at the server boundary
  }
}
