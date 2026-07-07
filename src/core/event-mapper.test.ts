import test from "node:test";
import assert from "node:assert/strict";

import { mapAppServerEvent } from "./event-mapper.js";

const now = new Date("2026-07-07T12:00:00.000Z");

test("mapAppServerEvent creates cue and present event for active plan step", () => {
  const mapped = mapAppServerEvent({
    method: "turn/plan/updated",
    params: {
      explanation: "Working",
      plan: [
        { step: "Read the docs", status: "completed" },
        { step: "Run tests", status: "in_progress" },
      ],
    },
  }, now);

  assert.equal(mapped?.cue?.kind, "started");
  assert.equal(mapped?.cue?.text, "I am now working on: Run tests");
  assert.deepEqual(mapped?.present, {
    type: "plan",
    explanation: "Working",
    steps: [
      { step: "Read the docs", status: "completed" },
      { step: "Run tests", status: "in_progress" },
    ],
  });
});

test("mapAppServerEvent maps failed command completion", () => {
  const mapped = mapAppServerEvent({
    method: "item/completed",
    params: {
      item: {
        type: "commandExecution",
        command: "npm test",
        exitCode: 1,
      },
    },
  }, now);

  assert.equal(mapped?.cue?.kind, "blocked");
  assert.equal(mapped?.context?.status, "failed");
  assert.deepEqual(mapped?.present, {
    type: "command",
    command: "npm test",
    status: "failed",
    exitCode: 1,
  });
});

test("mapAppServerEvent summarizes turn diff", () => {
  const mapped = mapAppServerEvent({
    method: "turn/diff/updated",
    params: {
      diff: "diff --git a/a.ts b/a.ts\n+one\n-two\n+++ b/a.ts\n--- a/a.ts\n",
    },
  }, now);

  assert.deepEqual(mapped?.present, {
    type: "diff",
    filesChanged: 1,
    additions: 1,
    deletions: 1,
  });
});
