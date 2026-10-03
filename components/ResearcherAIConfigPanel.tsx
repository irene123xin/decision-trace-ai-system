"use client";

import { useEffect, useState } from "react";
import type { AITextConfigurationStatus } from "@/services/server/geminiTextService";

const pendingStatus: AITextConfigurationStatus = {
  mode: "Loading",
  provider: "Loading",
  modelId: "Loading",
  apiKeyConfigured: false,
  promptVersion: "Loading",
  imageModelId: "Loading",
  imagePromptVersion: "Loading",
};

export function ResearcherAIConfigPanel() {
  const [status, setStatus] = useState<AITextConfigurationStatus>(pendingStatus);

  useEffect(() => {
    let active = true;
    fetch("/api/researcher/ai-config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<AITextConfigurationStatus> : Promise.reject())
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatus({ ...pendingStatus, mode: "Unavailable", provider: "Unavailable", modelId: "Unavailable", promptVersion: "Unavailable" }); });
    return () => { active = false; };
  }, []);

  return (
    <section className="researchSection aiConfigPanel" aria-label="AI service configuration">
      <div className="researchSectionTitle"><div><p className="eyebrow">SERVER CONFIGURATION</p><h2>AI services</h2></div></div>
      <dl>
        <div><dt>AI text mode</dt><dd>{status.mode}</dd></div>
        <div><dt>Provider</dt><dd>{status.provider}</dd></div>
        <div><dt>Configured model ID</dt><dd>{status.modelId}</dd></div>
        <div><dt>API key configured</dt><dd>{status.apiKeyConfigured ? "Yes" : "No"}</dd></div>
        <div><dt>Prompt version</dt><dd>{status.promptVersion}</dd></div>
        <div><dt>Image model ID</dt><dd>{status.imageModelId}</dd></div>
        <div><dt>Image prompt version</dt><dd>{status.imagePromptVersion}</dd></div>
      </dl>
    </section>
  );
}
