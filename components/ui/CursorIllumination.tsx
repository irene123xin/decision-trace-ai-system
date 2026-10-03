"use client";

import { useEffect, useRef } from "react";

const intensitySelectors: Array<[string, number]> = [
  [".homeMinimal", 1],
  [".briefingPage", 0.56],
  [".preAiPage", 0.52],
  [".conversationFocus, .workspaceConversation", 0.34],
  [".visualLibrary", 0.2],
  [".directionCanvas", 0.28],
  [".tracePanel", 0.34],
  [".finalReviewBoard", 0.24],
  [".postTaskQuestionnaire", 0.32],
  [".researchRecordsPage, .researcherView", 0.12],
];

export function CursorIllumination() {
  const light = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches || !light.current) return;

    const node = light.current;
    let targetX = window.innerWidth * 0.5;
    let targetY = window.innerHeight * 0.35;
    let currentX = targetX;
    let currentY = targetY;
    let frame = 0;

    const setIntensity = () => {
      const match = intensitySelectors.find(([selector]) => document.querySelector(selector));
      node.style.setProperty("--cursor-intensity", String(match?.[1] ?? 0.2));
    };
    const move = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      node.dataset.visible = "true";
      setIntensity();
    };
    const leave = () => { node.dataset.visible = "false"; };
    const animate = () => {
      currentX += (targetX - currentX) * 0.14;
      currentY += (targetY - currentY) * 0.14;
      node.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      frame = window.requestAnimationFrame(animate);
    };

    setIntensity();
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="cursorIllumination" ref={light} aria-hidden="true" />;
}
