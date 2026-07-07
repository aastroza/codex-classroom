import path from "node:path";

import type { CommandContext } from "../types.js";
import { pathExists } from "../core/fs.js";
import { activeSessionPath, getProfilePaths } from "../core/paths.js";
import { readActiveSession } from "../core/switcher.js";

export async function statusCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  const checks = {
    classroomRoot: await pathExists(context.paths.classroomRoot),
    profileDir: await pathExists(paths.profileDir),
    codexHome: await pathExists(paths.codexHome),
    desktopState: await pathExists(paths.desktopState),
    workspace: await pathExists(paths.workspace),
    manifest: await pathExists(paths.manifest),
    auth: await pathExists(path.join(paths.codexHome, "auth.json")),
    config: await pathExists(path.join(paths.codexHome, "config.toml")),
  };

  const payload = {
    ok: true,
    profile: paths.profileName,
    paths,
    realCodexHome: context.paths.realCodexHome,
    desktopStateHome: context.paths.desktopStateHome,
    activeSessionPath: activeSessionPath(context.paths.classroomRoot),
    activeSession: await readActiveSession(context.paths.classroomRoot),
    checks,
  };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  context.output.info(`Profile: ${paths.profileName}`);
  context.output.info(`Classroom root: ${context.paths.classroomRoot}`);
  context.output.info(`Real Codex home: ${context.paths.realCodexHome}`);
  context.output.info(`Desktop state home: ${context.paths.desktopStateHome}`);
  context.output.info(`CODEX_HOME: ${paths.codexHome}`);
  context.output.info(`Classroom desktop state: ${paths.desktopState}`);
  context.output.info(`Workspace: ${paths.workspace}`);
  for (const [name, value] of Object.entries(checks)) {
    context.output.info(`${name}: ${value ? "ok" : "missing"}`);
  }
}
