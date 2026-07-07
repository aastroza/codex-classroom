import fs from "node:fs/promises";
import path from "node:path";

import type { ActiveSession, MovePlan, ProfilePaths } from "../types.js";
import { CliError } from "./errors.js";
import { ensureDir, movePath, pathExists, readJsonFile, writeJsonFile } from "./fs.js";
import { activeSessionPath, backupDir, isSubpath } from "./paths.js";

export function createBackupId(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${suffix}`;
}

export function createActiveSession(options: {
  profile: string;
  classroomRoot: string;
  realCodexHome: string;
  desktopStateHome: string;
  profilePaths: ProfilePaths;
  backupId: string;
}): ActiveSession {
  const backupRoot = backupDir(options.classroomRoot, options.backupId);

  return {
    schemaVersion: 1,
    profile: options.profile,
    backupId: options.backupId,
    startedAt: new Date().toISOString(),
    classroomRoot: options.classroomRoot,
    paths: {
      realCodexHome: options.realCodexHome,
      desktopStateHome: options.desktopStateHome,
      profileCodexHome: options.profilePaths.codexHome,
      profileDesktopState: options.profilePaths.desktopState,
      workspace: options.profilePaths.workspace,
      backupCodexHome: path.join(backupRoot, "codex-home"),
      backupDesktopState: path.join(backupRoot, "desktop-state"),
    },
  };
}

export async function readActiveSession(classroomRoot: string): Promise<ActiveSession | null> {
  const target = activeSessionPath(classroomRoot);
  if (!(await pathExists(target))) {
    return null;
  }

  return readJsonFile<ActiveSession>(target);
}

export async function writeActiveSession(session: ActiveSession, dryRun: boolean): Promise<void> {
  await writeJsonFile(activeSessionPath(session.classroomRoot), session, dryRun);
}

export async function clearActiveSession(classroomRoot: string, dryRun: boolean): Promise<void> {
  if (!dryRun) {
    await fs.rm(activeSessionPath(classroomRoot), { force: true });
  }
}

export function movePlans(session: ActiveSession): MovePlan[] {
  return [
    {
      label: "codex-home",
      target: session.paths.realCodexHome,
      profile: session.paths.profileCodexHome,
      backup: session.paths.backupCodexHome,
    },
    {
      label: "desktop-state",
      target: session.paths.desktopStateHome,
      profile: session.paths.profileDesktopState,
      backup: session.paths.backupDesktopState,
    },
  ];
}

export async function validateSwitcherTargets(session: ActiveSession): Promise<void> {
  const root = path.resolve(session.classroomRoot);
  const managedPaths = [
    session.paths.profileCodexHome,
    session.paths.profileDesktopState,
    session.paths.workspace,
    session.paths.backupCodexHome,
    session.paths.backupDesktopState,
  ];

  for (const managedPath of managedPaths) {
    if (!isSubpath(root, managedPath)) {
      throw new CliError(`Managed path is outside classroom root: ${managedPath}`);
    }
  }

  if (isSubpath(root, session.paths.realCodexHome) || isSubpath(root, session.paths.desktopStateHome)) {
    throw new CliError("Real Codex paths must not be inside the classroom root.");
  }
}

export async function enterClassroom(session: ActiveSession, dryRun: boolean): Promise<Record<string, string[]>> {
  await validateSwitcherTargets(session);
  await ensureDir(backupDir(session.classroomRoot, session.backupId), dryRun);
  await ensureDir(session.paths.profileCodexHome, dryRun);
  await ensureDir(session.paths.profileDesktopState, dryRun);
  await writeActiveSession(session, dryRun);

  const actions: Record<string, string[]> = {};

  for (const plan of movePlans(session)) {
    actions[plan.label] = [];
    actions[plan.label].push(`target->backup:${await movePath(plan.target, plan.backup, dryRun)}`);
    actions[plan.label].push(`profile->target:${await movePath(plan.profile, plan.target, dryRun)}`);
  }

  return actions;
}

export async function restoreClassroom(session: ActiveSession, dryRun: boolean): Promise<Record<string, string[]>> {
  await validateSwitcherTargets(session);
  const actions: Record<string, string[]> = {};

  for (const plan of movePlans(session).reverse()) {
    actions[plan.label] = [];
    actions[plan.label].push(`target->profile:${await movePath(plan.target, plan.profile, dryRun)}`);
    actions[plan.label].push(`backup->target:${await movePath(plan.backup, plan.target, dryRun)}`);
  }

  await clearActiveSession(session.classroomRoot, dryRun);
  return actions;
}
