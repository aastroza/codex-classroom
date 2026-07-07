import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { ensureProfile } from "../core/profiles.js";
import { getProfilePaths } from "../core/paths.js";

export async function initCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  const copyAuth = context.options.copyAuth ?? true;
  const copyConfig = context.options.copyConfig ?? true;

  if (args.length > 1) {
    throw new CliError("init accepts at most one profile name.");
  }

  const result = await ensureProfile({
    paths,
    realCodexHome: context.paths.realCodexHome,
    copyAuth,
    copyConfig,
    dryRun: context.options.dryRun,
  });

  const payload = {
    ok: true,
    profile: paths.profileName,
    classroomRoot: context.paths.classroomRoot,
    codexHome: paths.codexHome,
    desktopState: paths.desktopState,
    workspace: paths.workspace,
    manifest: result.manifest,
    copied: result.copied,
    dryRun: context.options.dryRun,
  };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  context.output.info(`Initialized profile "${paths.profileName}"`);
  context.output.info(`CODEX_HOME: ${paths.codexHome}`);
  context.output.info(`Desktop state: ${paths.desktopState}`);
  context.output.info(`Workspace:  ${paths.workspace}`);
  for (const [file, status] of Object.entries(result.copied)) {
    context.output.info(`${file}: ${status}`);
  }
}
