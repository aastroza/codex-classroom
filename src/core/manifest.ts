import type { ProfileManifest } from "../types.js";

export function defaultManifest(profileName: string): ProfileManifest {
  return {
    name: profileName,
    description: "Clean Codex classroom profile",
    copyAuth: true,
    copyConfig: false,
    copyWindowsSandbox: false,
    windowsSandboxMode: process.platform === "win32" ? "unelevated" : "inherit",
    features: {
      sessions: "empty",
      automations: "empty",
      plugins: "minimal",
      skills: "minimal",
    },
  };
}

export function validateManifest(value: ProfileManifest): ProfileManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Manifest must be an object.");
  }

  const manifest = {
    ...value,
    copyWindowsSandbox: value.copyWindowsSandbox ?? false,
    windowsSandboxMode: value.windowsSandboxMode ?? (process.platform === "win32" ? "unelevated" : "inherit"),
  };

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error("Manifest must include a non-empty name.");
  }

  if (
    typeof manifest.copyAuth !== "boolean" ||
    typeof manifest.copyConfig !== "boolean" ||
    typeof manifest.copyWindowsSandbox !== "boolean" ||
    !["elevated", "unelevated", "inherit"].includes(manifest.windowsSandboxMode)
  ) {
    throw new Error("Manifest copyAuth, copyConfig, copyWindowsSandbox, and windowsSandboxMode are invalid.");
  }

  const features = manifest.features;
  if (!features || features.sessions !== "empty" || features.automations !== "empty") {
    throw new Error("Manifest sessions and automations must currently be set to empty.");
  }

  if (!["empty", "minimal", "inherit"].includes(features.plugins)) {
    throw new Error("Manifest plugins must be empty, minimal, or inherit.");
  }

  if (!["empty", "minimal", "inherit"].includes(features.skills)) {
    throw new Error("Manifest skills must be empty, minimal, or inherit.");
  }

  return manifest;
}
