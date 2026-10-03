"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlaceholder } from "@/components/ImagePlaceholder";
import { PARTICIPANT_MESSAGE_LIMIT } from "@/data/experiment";
import type { GeneratedImage, Message } from "@/types";

interface Props {
  messages: Message[];
  images: GeneratedImage[];
  isLoading: boolean;
  isGenerating: boolean;
  error: string;
  canRetry: boolean;
  userMessageCount: number;
  remainingImages: number;
  remainingRequests: number;
  onSend: (prompt: string) => void;
  onRetry: () => void;
  onGenerate: (prompt: string) => void;
}

export function ChatPanel(props: Props) {
  const [prompt, setPrompt] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [props.messages, props.images]);
  const canSend = prompt.trim() && !props.isLoading && props.userMessageCount < PARTICIPANT_MESSAGE_LIMIT;
  const canGenerate = !props.isLoading && props.remainingImages >= 2 && props.remainingRequests > 0;

  return (
    <section className="chatPanel">
      <div className="panelHeader">
        <div><p className="eyebrow">AI STUDIO</p><h2>Creative conversation</h2></div>
        <span className={`serviceStatus ${props.isLoading ? "working" : ""}`}><i />{props.isGenerating ? "Generating visuals" : props.isLoading ? "Working" : "AI assistant available"}</span>
      </div>
      <div className="chatHistory" aria-live="polite">
        {props.messages.length === 0 && (
          <div className="chatEmpty">
            <span className="aiMonogram">E</span>
            <h3>Conversation ready</h3>
            <p>Use the conversation to explore the brief.</p>
          </div>
        )}
        {props.messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="messageMeta"><span>{message.role === "participant" ? "YOU" : "ELSEWHERE AI"}</span><span>Turn {String(message.turn).padStart(2, "0")}</span></div>
            <p>{message.content}</p>
            {message.relatedImageIds?.length ? (
              <div className="messageImages">
                {message.relatedImageIds.map((id) => { const image = props.images.find((item) => item.id === id); return image ? <div className="messageImage" key={id}><ImagePlaceholder image={image} /></div> : null; })}
              </div>
            ) : null}
          </article>
        ))}
        {props.isLoading && <div className="typingIndicator"><i /><i /><i /><span>{props.isGenerating ? "Generating two visual directions" : "Developing response"}</span></div>}
        <div ref={endRef} />
      </div>
      <div className="composer">
        {props.error && <div className="inlineError" role="alert"><span>{props.error}</span>{props.canRetry && <button type="button" onClick={props.onRetry} disabled={props.isLoading}>Retry</button>}</div>}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) { e.preventDefault(); props.onSend(prompt); setPrompt(""); }
          }}
          placeholder="Describe what you want to explore or decide…"
          rows={3}
          maxLength={1000}
        />
        <p className="generateHint"><strong>To create images:</strong> describe what you want to see, then use <b>Generate visual</b> at the lower-left below instead of the text-message arrow. Each successful request creates two references in Generated Visuals.</p>
        <div className="composerActions">
          <button type="button" className="generateButton" disabled={!canGenerate} onClick={() => { props.onGenerate(prompt); if (prompt.trim()) setPrompt(""); }}>
            <span aria-hidden>◇</span> Generate visual <small>{props.remainingRequests <= 0 || props.remainingImages < 2 ? "All visual requests used" : `${props.remainingRequests} requests · ${props.remainingImages} images left`}</small>
          </button>
          <button type="button" className="sendButton" disabled={!canSend} onClick={() => { props.onSend(prompt); setPrompt(""); }} aria-label="Send message">↑</button>
        </div>
      </div>
    </section>
  );
}
