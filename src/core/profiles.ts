import path from "node:path";
import fs from "node:fs/promises";

import type { ProfileManifest, ProfilePaths, SetupStatus } from "../types.js";
import { copyDirIfMissing, copyFileIfMissing, ensureDir, pathExists, readJsonFile, writeJsonFile } from "./fs.js";
import { defaultManifest, validateManifest } from "./manifest.js";

export async function ensureProfile(options: {
  paths: ProfilePaths;
  realCodexHome: string;
  copyAuth: boolean;
  copyConfig: boolean;
  copyWindowsSandbox: boolean;
  windowsSandboxMode: "elevated" | "unelevated" | "inherit";
  dryRun: boolean;
}): Promise<{
  manifest: ProfileManifest;
  copied: Record<string, SetupStatus>;
}> {
  const manifest = defaultManifest(options.paths.profileName);
  manifest.copyAuth = options.copyAuth;
  manifest.copyConfig = options.copyConfig;
  manifest.copyWindowsSandbox = options.copyWindowsSandbox;
  manifest.windowsSandboxMode = options.windowsSandboxMode;

  await ensureDir(options.paths.codexHome, options.dryRun);
  await ensureDir(options.paths.desktopState, options.dryRun);
  await ensureDir(options.paths.workspace, options.dryRun);

  if (!(await pathExists(options.paths.manifest))) {
    await writeJsonFile(options.paths.manifest, manifest, options.dryRun);
  }

  const copied: Record<string, SetupStatus> = {};

  copied["auth.json"] = options.copyAuth
    ? await copyFileIfMissing(
        path.join(options.realCodexHome, "auth.json"),
        path.join(options.paths.codexHome, "auth.json"),
        options.dryRun,
      )
    : "skipped";

  copied["config.toml"] = options.copyConfig
    ? await copyFileIfMissing(
        path.join(options.realCodexHome, "config.toml"),
        path.join(options.paths.codexHome, "config.toml"),
        options.dryRun,
      )
    : await writeCleanConfig(
        path.join(options.realCodexHome, "config.toml"),
        path.join(options.paths.codexHome, "config.toml"),
        options.windowsSandboxMode,
        options.dryRun,
      );

  if (!options.copyConfig) {
    Object.assign(copied, await copyPluginSupportAssets(options.realCodexHome, options.paths.codexHome, options.dryRun));
  }

  if (options.copyWindowsSandbox) {
    Object.assign(copied, await copyWindowsSandboxAssets(options.realCodexHome, options.paths.codexHome, options.dryRun));
  } else {
    copied["windows-sandbox"] = "skipped";
  }

  if (options.copyConfig && options.windowsSandboxMode !== "inherit") {
    copied["config.toml windows sandbox"] = await setWindowsSandboxMode(
      path.join(options.paths.codexHome, "config.toml"),
      options.windowsSandboxMode,
      options.dryRun,
    );
  }

  return { manifest, copied };
}

export async function loadProfileManifest(paths: ProfilePaths): Promise<ProfileManifest | null> {
  if (!(await pathExists(paths.manifest))) {
    return null;
  }

  return validateManifest(await readJsonFile<ProfileManifest>(paths.manifest));
}

async function setWindowsSandboxMode(
  configPath: string,
  mode: "elevated" | "unelevated",
  dryRun: boolean,
): Promise<SetupStatus> {
  if (!(await pathExists(configPath))) {
    return "missing";
  }

  if (dryRun) {
    return "updated";
  }

  const source = await fs.readFile(configPath, "utf8");
  const next = upsertWindowsSandboxMode(source, mode);
  await fs.writeFile(configPath, next, "utf8");
  return next === source ? "exists" : "updated";
}

async function writeCleanConfig(
  sourceConfigPath: string,
  configPath: string,
  windowsSandboxMode: "elevated" | "unelevated" | "inherit",
  dryRun: boolean,
): Promise<SetupStatus> {
  const inheritedPluginConfig = (await pathExists(sourceConfigPath))
    ? extractInheritedPluginConfig(await fs.readFile(sourceConfigPath, "utf8"))
    : "";
  const next = buildCleanConfig(windowsSandboxMode, inheritedPluginConfig);
  if (await pathExists(configPath)) {
    const current = await fs.readFile(configPath, "utf8");
    if (current === next) {
      return "exists";
    }

    if (!dryRun) {
      await fs.writeFile(configPath, next, "utf8");
    }

    return "updated";
  }

  if (dryRun) {
    return "created";
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, next, "utf8");
  return "created";
}

export function buildCleanConfig(
  windowsSandboxMode: "elevated" | "unelevated" | "inherit",
  inheritedPluginConfig = "",
): string {
  const lines = [
    'model = "gpt-5.5"',
    'model_reasoning_effort = "high"',
    'sandbox_mode = "workspace-write"',
    'approval_policy = "on-request"',
    "",
    "[features]",
    "skills = false",
    "plugins = true",
    "apps = true",
    "browser_use = true",
    "browser_use_external = true",
    "in_app_browser = true",
    "computer_use = true",
    "unified_exec = true",
    "apply_patch_freeform = true",
  ];

  if (windowsSandboxMode !== "inherit") {
    lines.push("", "[windows]", `sandbox = "${windowsSandboxMode}"`);
  }

  const inherited = inheritedPluginConfig.trim();
  if (inherited.length > 0) {
    lines.push("", inherited);
  }

  return `${lines.join("\n")}\n`;
}

export function extractInheritedPluginConfig(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const sections: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const heading = line.trim();
    const isHeading = /^\[[^\]]+\]$/.test(heading);

    if (isHeading) {
      current = shouldInheritPluginSection(heading) ? [line] : null;
      if (current) {
        sections.push(current.join("\n"));
      }
      continue;
    }

    if (current) {
      current.push(line);
      sections[sections.length - 1] = current.join("\n");
    }
  }

  return sections.map((section) => section.trimEnd()).join("\n\n");
}

function shouldInheritPluginSection(heading: string): boolean {
  return (
    heading.startsWith("[plugins.") ||
    heading.startsWith("[marketplaces.") ||
    heading.startsWith("[mcp_servers.") ||
    heading.startsWith("[apps.")
  );
}

export function upsertWindowsSandboxMode(source: string, mode: "elevated" | "unelevated"): string {
  const value = mode;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const windowsIndex = lines.findIndex((line) => line.trim() === "[windows]");

  if (windowsIndex === -1) {
    return `${source.trimEnd()}\n\n[windows]\nsandbox = "${value}"\n`;
  }

  let insertAt = lines.length;
  for (let index = windowsIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      insertAt = index;
      break;
    }

    if (/^\s*sandbox\s*=/.test(lines[index])) {
      lines[index] = `sandbox = "${value}"`;
      return `${lines.join("\n").replace(/\n*$/, "")}\n`;
    }
  }

  lines.splice(insertAt, 0, `sandbox = "${value}"`);
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

async function copyWindowsSandboxAssets(
  realCodexHome: string,
  profileCodexHome: string,
  dryRun: boolean,
): Promise<Record<string, SetupStatus>> {
  if (process.platform !== "win32") {
    return { "windows-sandbox": "skipped" };
  }

  const copied: Record<string, SetupStatus> = {};

  copied[".sandbox-bin"] = await copyDirIfMissing(
    path.join(realCodexHome, ".sandbox-bin"),
    path.join(profileCodexHome, ".sandbox-bin"),
    dryRun,
  );
  copied[".sandbox-secrets"] = await copyDirIfMissing(
    path.join(realCodexHome, ".sandbox-secrets"),
    path.join(profileCodexHome, ".sandbox-secrets"),
    dryRun,
  );

  await ensureDir(path.join(profileCodexHome, ".sandbox"), dryRun);
  for (const fileName of ["setup_marker.json", "deny_read_acl_state.json"]) {
    copied[`.sandbox/${fileName}`] = await copyFileIfMissing(
      path.join(realCodexHome, ".sandbox", fileName),
      path.join(profileCodexHome, ".sandbox", fileName),
      dryRun,
    );
  }

  return copied;
}

async function copyPluginSupportAssets(
  realCodexHome: string,
  profileCodexHome: string,
  dryRun: boolean,
): Promise<Record<string, SetupStatus>> {
  const copied: Record<string, SetupStatus> = {};

  for (const directoryName of ["plugins", "browser", "computer-use", "node_repl", "vendor_imports"]) {
    copied[directoryName] = await copyDirIfMissing(
      path.join(realCodexHome, directoryName),
      path.join(profileCodexHome, directoryName),
      dryRun,
    );
  }

  for (const fileName of ["chrome-native-hosts-v2.json", "chrome-native-hosts.json"]) {
    copied[fileName] = await copyFileIfMissing(
      path.join(realCodexHome, fileName),
      path.join(profileCodexHome, fileName),
      dryRun,
    );
  }

  return copied;
}
