import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const experiment = read("data/experiment.ts");
const guide = read("components/TaskGuideContent.tsx");
const chat = read("components/ChatPanel.tsx");
const workspace = read("components/ParticipantWorkspace.tsx");
const chatRoute = read("app/api/chat/route.ts");
const traceRoute = read("app/api/decision-trace/route.ts");

test("participant text allowance is centrally defined as 40 and enforced by server routes", () => {
  assert.match(experiment, /PARTICIPANT_MESSAGE_LIMIT = 40/);
  assert.match(chatRoute, /getConversationAllowanceCount\(authorised\.session\) >= PARTICIPANT_MESSAGE_LIMIT/);
  assert.match(chatRoute, /MAX_MESSAGES = PARTICIPANT_MESSAGE_LIMIT \* 2 \+ 1/);
  assert.match(chatRoute, /MAX_TOTAL_CHARACTERS = 220_000/);
  assert.match(chatRoute, /MAX_REQUEST_BYTES = 250_000/);
  assert.match(traceRoute, /getConversationAllowanceCount\(authorised\.session\) > PARTICIPANT_MESSAGE_LIMIT/);
  assert.match(workspace, /userMessageCount >= PARTICIPANT_MESSAGE_LIMIT/);
  assert.match(workspace, /getConversationAllowanceCount\(base\) >= PARTICIPANT_MESSAGE_LIMIT/);
  assert.match(chat, /userMessageCount < PARTICIPANT_MESSAGE_LIMIT/);
});

test("participant guidance explains the task, flexible workflow and finite AI allowance", () => {
  for (const heading of ["YOUR TASK", "SUGGESTED FLOW", "USING AI", "GENERATING IMAGES", "BEFORE YOU BEGIN"]) assert.match(guide, new RegExp(heading));
  assert.match(guide, /one coherent direction for Elsewhere/i);
  assert.match(guide, /not a finished commercial identity/i);
  assert.match(guide, /Pre-AI Starting Point/);
  assert.match(guide, /Complete the questionnaire/);
  assert.match(guide, /do not need to finish each one before opening another/i);
  assert.match(guide, /up to \{PARTICIPANT_MESSAGE_LIMIT\} text messages/);
  assert.match(guide, /maximum, not a target/);
});

test("image guidance points to the lower-left Generate control without changing image quotas", () => {
  assert.match(guide, /lower-left of the input area/);
  assert.match(guide, /instead of sending a normal text-only message/);
  assert.match(guide, /Each successful request creates two images/);
  assert.match(guide, /five successful requests and ten images in total/);
  assert.match(guide, /not added to the Working Board automatically/);
  assert.match(chat, /To create images:/);
  assert.match(chat, /lower-left below/);
  assert.match(chat, /Generate visual/);
  assert.match(experiment, /DEFAULT_IMAGE_REQUEST_LIMIT = 5/);
  assert.match(experiment, /DEFAULT_IMAGE_TOTAL_LIMIT = 10/);
  assert.match(experiment, /DEFAULT_IMAGES_PER_REQUEST = 2/);
});

test("participant instructions preserve blinding and the soft 45-minute guide", () => {
  assert.doesNotMatch(guide, /Condition A|Condition B|Human-initiated|research hypothesis/);
  assert.match(guide, /timer is a guide/);
  assert.match(guide, /does not close, delete or submit your work/);
});
