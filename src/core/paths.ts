import os from "node:os";
import path from "node:path";

import type { PathContext, ProfilePaths } from "../types.js";

export function defaultClassroomRoot(): string {
  return path.join(os.homedir(), ".codex-classroom");
}

export function defaultRealCodexHome(): string {
  return process.env.CODEX_REAL_HOME ?? path.join(os.homedir(), ".codex");
}

export function defaultDesktopStateHome(): string {
  if (process.env.CODEX_DESKTOP_STATE_HOME) {
    return process.env.CODEX_DESKTOP_STATE_HOME;
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Codex");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Codex");
  }

  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Codex");
}

export function createPathContext(overrides: {
  classroomRoot?: string;
  realCodexHome?: string;
  desktopStateHome?: string;
}): PathContext {
  return {
    classroomRoot: path.resolve(overrides.classroomRoot ?? defaultClassroomRoot()),
    realCodexHome: path.resolve(overrides.realCodexHome ?? defaultRealCodexHome()),
    desktopStateHome: path.resolve(overrides.desktopStateHome ?? defaultDesktopStateHome()),
  };
}

export function getProfilePaths(classroomRoot: string, profileName: string): ProfilePaths {
  const safeName = normalizeProfileName(profileName);
  const profileDir = path.join(classroomRoot, "profiles", safeName);

  return {
    profileName: safeName,
    profileDir,
    codexHome: path.join(profileDir, "codex-home"),
    desktopState: path.join(profileDir, "desktop-state"),
    workspace: path.join(profileDir, "workspace"),
    manifest: path.join(profileDir, "manifest.json"),
  };
}

export function activeSessionPath(classroomRoot: string): string {
  return path.join(classroomRoot, "active-session.json");
}

export function backupDir(classroomRoot: string, backupId: string): string {
  return path.join(classroomRoot, "backups", backupId);
}

export function normalizeProfileName(profileName: string): string {
  const trimmed = profileName.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error("Profile names may only contain letters, numbers, dots, underscores, and hyphens.");
  }

  if (trimmed === "." || trimmed === ".." || trimmed.length === 0) {
    throw new Error("Profile name must not be empty or a path segment.");
  }

  return trimmed;
}

export function isSubpath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
