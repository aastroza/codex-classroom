import test from "node:test";
import assert from "node:assert/strict";

import type { ProfileManifest } from "../types.js";
import { defaultManifest, validateManifest } from "./manifest.js";
import { buildCleanConfig, extractInheritedPluginConfig, upsertWindowsSandboxMode } from "./profiles.js";

test("defaultManifest creates a clean classroom manifest", () => {
  const manifest = defaultManifest("intro");

  assert.equal(manifest.name, "intro");
  assert.equal(manifest.copyAuth, true);
  assert.equal(manifest.copyConfig, false);
  assert.equal(manifest.copyWindowsSandbox, false);
  assert.equal(manifest.windowsSandboxMode, "inherit");
  assert.equal(manifest.features.sessions, "empty");
  assert.equal(manifest.features.automations, "empty");
  assert.equal(manifest.features.plugins, "inherit");
  assert.equal(manifest.features.skills, "empty");
});

test("buildCleanConfig creates a portable classroom config by default", () => {
  const config = buildCleanConfig("inherit");

  assert.match(config, /sandbox_mode = "workspace-write"/);
  assert.match(config, /\[features\]/);
  assert.match(config, /skills = false/);
  assert.match(config, /plugins = true/);
  assert.match(config, /computer_use = true/);
  assert.doesNotMatch(config, /\[windows\]/);
});

test("buildCleanConfig can request Windows sandbox setup", () => {
  const config = buildCleanConfig("unelevated");

  assert.match(config, /\[windows\]\nsandbox = "unelevated"/);
});

test("buildCleanConfig can append inherited plugin config", () => {
  const config = buildCleanConfig("inherit", '[plugins."browser@openai-bundled"]\nenabled = true\n');

  assert.match(config, /\[features\]\nskills = false/);
  assert.match(config, /\[plugins\."browser@openai-bundled"\]\nenabled = true/);
});

test("extractInheritedPluginConfig keeps plugin sections and drops projects", () => {
  const source = [
    'model = "test"',
    "",
    "[features]",
    "skills = true",
    "",
    '[plugins."gmail@openai-curated"]',
    "enabled = true",
    "",
    "[marketplaces.openai-bundled]",
    'source_type = "local"',
    "",
    "[mcp_servers.node_repl.env]",
    'CODEX_HOME = "C:/Users/Alonso/.codex"',
    "",
    "[projects.'C:/private']",
    'trust_level = "trusted"',
    "",
    '[apps.connector_abc.tools."google_drive.read"]',
    "enabled = true",
  ].join("\n");

  const inherited = extractInheritedPluginConfig(source);

  assert.match(inherited, /\[plugins\."gmail@openai-curated"\]/);
  assert.match(inherited, /\[marketplaces\.openai-bundled\]/);
  assert.match(inherited, /\[mcp_servers\.node_repl\.env\]/);
  assert.match(inherited, /\[apps\.connector_abc\.tools\."google_drive.read"\]/);
  assert.doesNotMatch(inherited, /\[features\]/);
  assert.doesNotMatch(inherited, /\[projects\./);
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
  assert.equal(validated.windowsSandboxMode, "inherit");
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
