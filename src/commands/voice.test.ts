import test from "node:test";
import assert from "node:assert/strict";

import { isDesktopRolloutReadError } from "./voice.js";

test("isDesktopRolloutReadError detects the Desktop rollout schema mismatch", () => {
  assert.equal(isDesktopRolloutReadError(new Error("thread file does not start with session metadata")), true);
  assert.equal(isDesktopRolloutReadError(new Error("network unavailable")), false);
});
