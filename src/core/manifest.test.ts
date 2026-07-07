import test from "node:test";
import assert from "node:assert/strict";

import { defaultManifest, validateManifest } from "./manifest.js";
import { buildCleanConfig, upsertWindowsSandboxMode } from "./profiles.js";

test("defaultManifest creates a clean classroom manifest", () => {
  const manifest = defaultManifest("intro");

  assert.equal(manifest.name, "intro");
  assert.equal(manifest.copyAuth, true);
  assert.equal(manifest.copyConfig, false);
  assert.equal(manifest.copyWindowsSandbox, false);
  assert.equal(manifest.windowsSandboxMode, process.platform === "win32" ? "unelevated" : "inherit");
  assert.equal(manifest.features.sessions, "empty");
  assert.equal(manifest.features.automations, "empty");
});

test("buildCleanConfig creates a portable classroom config by default", () => {
  const config = buildCleanConfig("inherit");

  assert.match(config, /sandbox_mode = "workspace-write"/);
  assert.match(config, /\[features\]/);
  assert.doesNotMatch(config, /\[windows\]/);
});

test("buildCleanConfig can request Windows sandbox setup", () => {
  const config = buildCleanConfig("unelevated");

  assert.match(config, /\[windows\]\nsandbox = "unelevated"/);
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

test("validateManifest accepts older manifests without sandbox fields", () => {
  const manifest = defaultManifest("intro");
  const legacy = {
    name: manifest.name,
    description: manifest.description,
    copyAuth: manifest.copyAuth,
    copyConfig: true,
    features: manifest.features,
  } as ProfileManifest;

  const validated = validateManifest(legacy);

  assert.equal(validated.copyWindowsSandbox, false);
  assert.equal(validated.windowsSandboxMode, process.platform === "win32" ? "unelevated" : "inherit");
});

test("upsertWindowsSandboxMode updates existing windows sandbox setting", () => {
  const source = "model = \"test\"\n\n[windows]\nsandbox = \"elevated\"\n\n[features]\nskills = true\n";
  const next = upsertWindowsSandboxMode(source, "unelevated");

  assert.match(next, /\[windows\]\nsandbox = "unelevated"/);
  assert.match(next, /\[features\]/);
});

test("upsertWindowsSandboxMode appends windows section when missing", () => {
  const next = upsertWindowsSandboxMode("model = \"test\"\n", "elevated");

  assert.match(next, /\[windows\]\nsandbox = "elevated"/);
});
