import test from "node:test";
import assert from "node:assert/strict";

import { buildThreadBrief } from "./voice-context.js";

test("buildThreadBrief creates a compact timeline", () => {
  const brief = buildThreadBrief([
    {
      schemaVersion: 1,
      id: "1",
      at: "2026-07-07T00:00:00.000Z",
      source: "rollout",
      kind: "turn-complete",
      title: "Turn completed",
      summary: "Done.",
    },
  ]);

  assert.match(brief, /turn-complete/);
  assert.match(brief, /Done/);
});
