import path from "node:path";

import type { ProfileManifest, ProfilePaths } from "../types.js";
import { copyFileIfMissing, ensureDir, pathExists, readJsonFile, writeJsonFile } from "./fs.js";
import { defaultManifest, validateManifest } from "./manifest.js";

export async function ensureProfile(options: {
  paths: ProfilePaths;
  realCodexHome: string;
  copyAuth: boolean;
  copyConfig: boolean;
  dryRun: boolean;
}): Promise<{
  manifest: ProfileManifest;
  copied: Record<string, "copied" | "exists" | "missing" | "skipped">;
}> {
  const manifest = defaultManifest(options.paths.profileName);
  manifest.copyAuth = options.copyAuth;
  manifest.copyConfig = options.copyConfig;

  await ensureDir(options.paths.codexHome, options.dryRun);
  await ensureDir(options.paths.desktopState, options.dryRun);
  await ensureDir(options.paths.workspace, options.dryRun);

  if (!(await pathExists(options.paths.manifest))) {
    await writeJsonFile(options.paths.manifest, manifest, options.dryRun);
  }

  const copied: Record<string, "copied" | "exists" | "missing" | "skipped"> = {};

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
    : "skipped";

  return { manifest, copied };
}

export async function loadProfileManifest(paths: ProfilePaths): Promise<ProfileManifest | null> {
  if (!(await pathExists(paths.manifest))) {
    return null;
  }

  return validateManifest(await readJsonFile<ProfileManifest>(paths.manifest));
}
