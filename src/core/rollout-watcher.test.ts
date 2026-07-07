import test from "node:test";
import assert from "node:assert/strict";

import { createRolloutParserState, mapRolloutRecord } from "./rollout-watcher.js";

test("mapRolloutRecord maps Desktop plan updates", () => {
  const mapped = mapRolloutRecord({
    timestamp: "2026-07-07T12:00:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      name: "update_plan",
      arguments: JSON.stringify({
        plan: [
          { step: "Read the thread", status: "completed" },
          { step: "Run the demo", status: "in_progress" },
        ],
      }),
    },
  });

  assert.deepEqual(mapped?.present, {
    type: "plan",
    explanation: null,
    steps: [
      { step: "Read the thread", status: "completed" },
      { step: "Run the demo", status: "in_progress" },
    ],
  });
});

test("mapRolloutRecord maps command calls and outputs", () => {
  const state = createRolloutParserState();
  const started = mapRolloutRecord({
    timestamp: "2026-07-07T12:00:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: "call_1",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "npm test" }),
    },
  }, state);
  const completed = mapRolloutRecord({
    timestamp: "2026-07-07T12:00:01.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_1",
      output: "Process exited with code 0",
    },
  }, state);

  assert.deepEqual(started?.present, { type: "command", command: "npm test", status: "running" });
  assert.deepEqual(completed?.present, { type: "command", command: "npm test", status: "passed", exitCode: 0 });
});

test("mapRolloutRecord maps Codex commentary into subtitles", () => {
  const mapped = mapRolloutRecord({
    timestamp: "2026-07-07T12:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "agent_message",
      message: "I am checking the failing test before editing the code.",
    },
  });

  assert.deepEqual(mapped?.present, {
    type: "subtitle",
    text: "I am checking the failing test before editing the code.",
  });
  assert.equal(mapped?.context?.source, "rollout");
});
