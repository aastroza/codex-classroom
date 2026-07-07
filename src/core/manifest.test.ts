import test from "node:test";
import assert from "node:assert/strict";

import { defaultManifest, validateManifest } from "./manifest.js";

test("defaultManifest creates a clean classroom manifest", () => {
  const manifest = defaultManifest("intro");

  assert.equal(manifest.name, "intro");
  assert.equal(manifest.copyAuth, true);
  assert.equal(manifest.copyConfig, true);
  assert.equal(manifest.features.sessions, "empty");
  assert.equal(manifest.features.automations, "empty");
});

test("validateManifest rejects unsupported feature values", () => {
  const manifest = defaultManifest("intro");
  manifest.features.plugins = "inherit";
  assert.equal(validateManifest(manifest).features.plugins, "inherit");

  assert.throws(() =>
    validateManifest({
      ...manifest,
      features: {
        ...manifest.features,
        plugins: "custom" as "minimal",
      },
    }),
  );
});
