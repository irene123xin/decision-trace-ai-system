import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBoardProgress } from "../services/boardUtils.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const workspace = source("components/ParticipantWorkspace.tsx");
const css = source("app/globals.css");
const board = source("components/WorkingBoard.tsx");

test("Workspace no longer renders the Board at a glance preview or field list", () => {
  assert.doesNotMatch(workspace, /Board at a glance|BoardOverview|overviewPalette|overviewConcept|overviewTraits/);
  assert.doesNotMatch(css, /boardOverview|overviewPalette|overviewConcept|overviewTraits/);
});

test("Working Board still renders every required and supporting section", () => {
  for (const id of ["concept", "keywords", "personality", "audience", "palette", "typography", "logo", "visuals", "tone", "principles", "rationale"]) {
    assert.match(board, new RegExp(`id="${id}"`));
  }
  assert.match(workspace, /<WorkingBoard[^>]*full/);
});

test("final rationale and image explanation fields expose the corrected participant guidance", () => {
  assert.match(board, /MIN_FINAL_RATIONALE_CHARACTERS/);
  assert.match(board, /characters · minimum \{MIN_FINAL_RATIONALE_CHARACTERS\}/);
  assert.match(css, /\.imageDirectionNote textarea \{[^}]*background: rgba\(7,10,15,\.72\);[^}]*color: var\(--text-primary\);[^}]*caret-color: var\(--accent\)/);
  assert.match(css, /\.imageDirectionNote textarea::placeholder/);
  assert.match(css, /\.imageDirectionNote textarea:focus/);
  assert.match(css, /\.imageDirectionNote textarea:disabled/);
});

test("both conditions share one two-column shell and Condition B alone adds Decision Trace", () => {
  assert.match(workspace, /<div className="workspaceFrame">\{mainView\}<aside className="workspaceRail">/);
  assert.match(workspace, /view === "studio" \? <main className="workspaceConversation">\{chatPanel\}<\/main>/);
  assert.match(workspace, /<WorkspaceStatus board=\{session\.board\}/);
  assert.match(workspace, /session\.condition === "B" && <DecisionTrace/);
  assert.doesNotMatch(workspace, /condition === "A"[^\n]*DecisionTrace|Trace hidden|tracePlaceholder/);
  assert.match(css, /\.workspaceFrame \{[^}]*grid-template-columns: minmax\(0, 7fr\) minmax\(315px, 3fr\)/);
});

test("composer stays in the conversation column and messages keep a readable maximum width", () => {
  assert.match(workspace, /<main className="workspaceConversation">\{chatPanel\}<\/main>/);
  assert.match(css, /\.workspaceConversation \.message \{ max-width: 760px; \}/);
  assert.match(css, /\.workspaceMain \{ min-width: 0/);
});

test("legacy studio grid and empty middle-column containers are absent", () => {
  assert.doesNotMatch(workspace, /studioGrid|BoardOverview|boardSpacer|middleColumn/);
  assert.doesNotMatch(css, /\.studioGrid|boardSpacer|middleColumn/);
});

test("Task Progress remains derived from current Board completion state", () => {
  const empty = { confirmedSections: [], concept: "", keywords: [], personalityTraits: [], audienceDescription: "", audienceNeed: "", audienceResponse: "", primaryColour: "", secondaryColour1: "", secondaryColour2: "", accentColour: "", selectedLogoImageId: null, selectedVisualImageIds: [], rationale: "", primaryTypeStyle: "", secondaryTypeStyle: "", typographyMood: [], toneTraits: [], sampleLine: "", visualDos: [], visualDonts: [] };
  assert.deepEqual(getBoardProgress(empty).requiredComplete, 0);
  assert.match(workspace, /progress\.requiredComplete\} \/ 8/);
  assert.match(workspace, /progress\.supportingComplete\} \/ 3/);
});

test("Final Review and historical-session compatibility paths remain present", () => {
  assert.match(workspace, /<FinalReviewSummary session=\{session\}/);
  assert.match(source("services/storageAdapter.ts"), /aiTextRequests: session\.aiTextRequests \?\? \[\]/);
});

test("desktop shell prevents horizontal overflow and right rail scrolls with the page", () => {
  assert.match(css, /\.workspaceFrame \{[^}]*min-width: 0/);
  assert.match(css, /\.workspaceRail \{ min-width: 0/);
  assert.match(css, /\.workspaceRail > \.tracePanel \{ position: static; max-height: none; overflow: visible/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.workspaceFrame \{ display: block; \}/);
});
