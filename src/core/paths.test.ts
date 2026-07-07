import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { getProfilePaths, isSubpath, normalizeProfileName } from "./paths.js";

test("normalizeProfileName accepts simple profile names", () => {
  assert.equal(normalizeProfileName("intro"), "intro");
  assert.equal(normalizeProfileName("codex-101"), "codex-101");
  assert.equal(normalizeProfileName("advanced.v1"), "advanced.v1");
});

test("normalizeProfileName rejects path-like names", () => {
  assert.throws(() => normalizeProfileName("../real-home"));
  assert.throws(() => normalizeProfileName(""));
  assert.throws(() => normalizeProfileName("nested/profile"));
});

test("getProfilePaths stays under classroom root", () => {
  const root = path.resolve("/tmp/codex-classroom");
  const paths = getProfilePaths(root, "intro");

  assert.equal(paths.profileName, "intro");
  assert.ok(isSubpath(root, paths.profileDir));
  assert.ok(isSubpath(root, paths.codexHome));
  assert.ok(isSubpath(root, paths.workspace));
  assert.ok(isSubpath(root, paths.manifest));
});

test("isSubpath rejects sibling directories", () => {
  const root = path.resolve("/tmp/codex-classroom");
  assert.equal(isSubpath(root, path.resolve("/tmp/codex-classroom-other")), false);
  assert.equal(isSubpath(root, path.resolve("/tmp/codex-classroom/profiles/intro")), true);
});
