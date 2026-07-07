import test from "node:test";
import assert from "node:assert/strict";

import { buildThreadBrief, normalizeHookContext, parseHookPayload } from "./voice-context.js";

test("normalizeHookContext records user prompts without raw payload assumptions", () => {
  const event = normalizeHookContext({
    eventName: "UserPromptSubmit",
    payload: {
      prompt: "Please explain the failing test.",
      cwd: "/repo",
    },
  });

  assert.equal(event.kind, "user-prompt");
  assert.equal(event.cwd, "/repo");
  assert.match(event.summary, /failing test/);
});

test("normalizeHookContext summarizes tool results and redacts secrets", () => {
  const event = normalizeHookContext({
    eventName: "PostToolUse",
    payload: {
      tool_name: "Bash",
      tool_input: {
        command: "OPENAI_API_KEY=sk-secret123456789 npm test",
      },
      tool_response: {
        exit_code: 1,
        stderr: "token=abc123 failed",
      },
    },
  });

  assert.equal(event.kind, "tool-result");
  assert.equal(event.toolName, "Bash");
  assert.equal(event.status, "failed");
  assert.doesNotMatch(event.command ?? "", /sk-secret/);
  assert.doesNotMatch(event.summary, /abc123/);
});

test("parseHookPayload tolerates non-json input", () => {
  assert.deepEqual(parseHookPayload("plain output"), { text: "plain output" });
});

test("buildThreadBrief creates a compact timeline", () => {
  const brief = buildThreadBrief([
    {
      schemaVersion: 1,
      id: "1",
      at: "2026-07-07T00:00:00.000Z",
      source: "hook",
      kind: "turn-complete",
      title: "Turn completed",
      summary: "Done.",
    },
  ]);

  assert.match(brief, /turn-complete/);
  assert.match(brief, /Done/);
});
