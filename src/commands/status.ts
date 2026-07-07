import path from "node:path";

import type { CommandContext } from "../types.js";
import { pathExists } from "../core/fs.js";
import { getProfilePaths } from "../core/paths.js";

export async function statusCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  const checks = {
    classroomRoot: await pathExists(context.paths.classroomRoot),
    profileDir: await pathExists(paths.profileDir),
    codexHome: await pathExists(paths.codexHome),
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
    checks,
  };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  context.output.info(`Profile: ${paths.profileName}`);
  context.output.info(`Classroom root: ${context.paths.classroomRoot}`);
  context.output.info(`CODEX_HOME: ${paths.codexHome}`);
  context.output.info(`Workspace: ${paths.workspace}`);
  for (const [name, value] of Object.entries(checks)) {
    context.output.info(`${name}: ${value ? "ok" : "missing"}`);
  }
}
