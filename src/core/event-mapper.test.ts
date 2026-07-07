import test from "node:test";
import assert from "node:assert/strict";

import { mapAppServerEvent, mapThreadSnapshot } from "./event-mapper.js";

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

test("mapThreadSnapshot hydrates present events from stored turns", () => {
  const events = mapThreadSnapshot({
    thread: {
      turns: [
        {
          status: "completed",
          startedAt: 10,
          items: [
            { type: "plan", text: "- Read Slack\n- Summarize activity" },
            { type: "commandExecution", command: "npm test", status: "completed", exitCode: 0 },
            { type: "fileChange", changes: [{ path: "README.md" }] },
            { type: "agentMessage", text: "Finished the Slack summary." },
          ],
        },
      ],
    },
  });

  assert.deepEqual(events, [
    {
      type: "plan",
      explanation: null,
      steps: [
        { step: "Read Slack", status: "completed" },
        { step: "Summarize activity", status: "completed" },
      ],
    },
    { type: "command", command: "npm test", status: "passed", exitCode: 0 },
    { type: "diff", filesChanged: 1 },
    { type: "subtitle", text: "Finished the Slack summary." },
  ]);
});
