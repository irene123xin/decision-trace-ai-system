import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { completedAssistantContent, isCompletedAssistantMessage } from "../services/textResponsePolicy.ts";
import { ChatAttemptFailure, createAttemptAbortContext, runBoundedChatAttempts } from "../services/chatAttemptPolicy.ts";
import { getConversationAllowanceCount } from "../services/conversationAllowance.ts";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("only STOP responses are accepted as complete live assistant text", () => {
  assert.equal(completedAssistantContent("Complete response", "STOP"), "Complete response");
  for (const reason of ["MAX_TOKENS", "SAFETY", "RECITATION", "UNKNOWN", undefined]) assert.equal(completedAssistantContent("Partial response", reason), null);
});

test("historical and completed messages remain usable while known incomplete messages are excluded", () => {
  assert.equal(isCompletedAssistantMessage({ role: "assistant" }), true);
  assert.equal(isCompletedAssistantMessage({ role: "assistant", finishReason: "STOP" }), true);
  assert.equal(isCompletedAssistantMessage({ role: "assistant", finishReason: "MAX_TOKENS" }), false);
});

test("conversation retry stores a fresh completed response and never concatenates partial text", () => {
  const workspace = source("components/ParticipantWorkspace.tsx");
  assert.match(workspace, /content: response\.content/);
  assert.doesNotMatch(workspace, /assistant\.content\s*\+|content:\s*.*partial|concat\(.*response\.content/);
  assert.match(workspace, /finishReason: response\.finishReason/);
});

test("normal text service records finish reason and rejects non-STOP output", () => {
  const service = source("services/server/geminiTextService.ts");
  assert.match(service, /response\.candidates\?\.\[0\]\?\.finishReason/);
  assert.match(service, /completedAssistantContent\(rawText, finishReason\)/);
  assert.match(service, /MAX_OUTPUT_TOKENS = 1_024/);
  assert.match(service, /THINKING_BUDGET_TOKENS = 128/);
  assert.match(service, /thinkingConfig: \{ thinkingBudget: THINKING_BUDGET_TOKENS \}/);
});

test("each provider attempt uses a fresh AbortController", () => {
  const first = createAttemptAbortContext(60_000);
  const second = createAttemptAbortContext(60_000);
  first.controller.abort();
  assert.notEqual(first.controller, second.controller);
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, false);
  first.clear(); second.clear();
});

test("a timed-out first attempt does not instantly abort the second attempt", async () => {
  const signals = [];
  const result = await runBoundedChatAttempts(async (attempt) => {
    const context = createAttemptAbortContext(60_000);
    signals.push(context.controller.signal);
    try {
      if (attempt === 1) { context.controller.abort(); throw new ChatAttemptFailure("timeout", "provider_timeout", { timeout: true }); }
      assert.equal(context.controller.signal.aborted, false);
      return { value: "OK", finishReason: "STOP", candidateCount: 1 };
    } finally { context.clear(); }
  }, { wait: async () => {}, jitter: () => 0 });
  assert.equal(result.result.value, "OK");
  assert.equal(signals.length, 2);
});

for (const [label, category, status] of [["429", "rate_limit", 429], ["503", "provider_unavailable", 503]]) {
  test(`temporary ${label} retries once then succeeds`, async () => {
    let calls = 0;
    const result = await runBoundedChatAttempts(async () => {
      calls += 1;
      if (calls === 1) throw new ChatAttemptFailure(category, "provider_http", { providerStatusCode: status });
      return { value: "complete", finishReason: "STOP", candidateCount: 1 };
    }, { wait: async () => {}, jitter: () => 0 });
    assert.equal(calls, 2);
    assert.equal(result.attempts.length, 2);
  });
}

for (const [label, category, status] of [["403", "permission_denied", 403], ["404", "model_not_found", 404]]) {
  test(`permanent ${label} does not retry`, async () => {
    let calls = 0;
    await assert.rejects(runBoundedChatAttempts(async () => {
      calls += 1;
      throw new ChatAttemptFailure(category, "provider_http", { providerStatusCode: status });
    }, { wait: async () => {}, jitter: () => 0 }));
    assert.equal(calls, 1);
  });
}

test("empty STOP retries once", async () => {
  let calls = 0;
  const result = await runBoundedChatAttempts(async () => {
    calls += 1;
    if (calls === 1) throw new ChatAttemptFailure("empty_response", "response_policy", { finishReason: "STOP", candidateCount: 1 });
    return { value: "complete", finishReason: "STOP", candidateCount: 1 };
  }, { wait: async () => {}, jitter: () => 0 });
  assert.equal(calls, 2);
  assert.equal(result.result.value, "complete");
});

test("MAX_TOKENS is not retried or committed as complete", async () => {
  let calls = 0;
  await assert.rejects(runBoundedChatAttempts(async () => {
    calls += 1;
    throw new ChatAttemptFailure("max_tokens", "response_policy", { finishReason: "MAX_TOKENS", candidateCount: 1 });
  }, { wait: async () => {}, jitter: () => 0 }));
  assert.equal(calls, 1);
  assert.equal(completedAssistantContent("partial", "MAX_TOKENS"), null);
});

test("failed responses do not consume the conversation allowance and legacy messages remain countable", () => {
  const base = { messages: [{ id: "M1", role: "participant" }, { id: "M2", role: "participant" }, { id: "M3", role: "participant" }], aiTextRequests: [
    { requestId: "R1", participantMessageId: "M1", status: "failed" },
    { requestId: "R2", participantMessageId: "M2", status: "succeeded" },
  ] };
  assert.equal(getConversationAllowanceCount(base), 2);
});

test("participant request locking prevents overlapping Retry calls and only success appends assistant text", () => {
  const workspace = source("components/ParticipantWorkspace.tsx");
  assert.match(workspace, /if \(requestPending\.current \|\| !retryRequestId \|\| Date\.now\(\) < retryCooldownUntil\) return/);
  assert.match(workspace, /requestPending\.current = true/);
  assert.match(workspace, /messages: \[\.\.\.base\.messages, assistant\]/);
  assert.doesNotMatch(workspace, /messages: \[\.\.\.base\.messages,.*caught|partial/i);
});

test("server policy limits normal chat to one internal retry and records safe diagnostics", () => {
  const service = source("services/server/geminiTextService.ts");
  assert.match(service, /runBoundedChatAttempts/);
  assert.match(service, /createAttemptAbortContext\(REQUEST_TIMEOUT_MS\)/);
  assert.match(service, /candidateCount/);
  assert.match(service, /inputTokenCount/);
  assert.match(service, /outputTokenCount/);
  assert.doesNotMatch(service, /console\.(?:info|error)\([^\n]*(?:apiKey|systemInstruction|contents)/);
});
