import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { runCodexApp } from "../core/codex.js";
import { getProfilePaths } from "../core/paths.js";
import { ensureProfile } from "../core/profiles.js";

export async function startCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const extraArgs = context.options.passthrough;

  if (args.length > 1) {
    throw new CliError("start accepts at most one profile name before --.");
  }

  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  await ensureProfile({
    paths,
    realCodexHome: context.paths.realCodexHome,
    copyAuth: context.options.copyAuth ?? true,
    copyConfig: context.options.copyConfig ?? false,
    copyWindowsSandbox: context.options.copyWindowsSandbox ?? false,
    windowsSandboxMode: context.options.windowsSandboxMode ?? "inherit",
    dryRun: context.options.dryRun,
  });

  if (context.options.json) {
    context.output.json({
      ok: true,
      profile: paths.profileName,
      codexHome: paths.codexHome,
      workspace: paths.workspace,
      command: ["codex", "app", paths.workspace, ...extraArgs],
      dryRun: context.options.dryRun,
    });
    if (context.options.dryRun) {
      return;
    }
  } else {
    context.output.warn("start is a legacy launcher and does not isolate Codex Desktop sidebar state. Use enter/restore for classroom mode.");
    context.output.info(`Launching Codex classroom profile "${paths.profileName}"`);
    context.output.info(`CODEX_HOME: ${paths.codexHome}`);
  }

  const exitCode = await runCodexApp({
    codexHome: paths.codexHome,
    workspace: paths.workspace,
    dryRun: context.options.dryRun,
    extraArgs,
  });

  process.exitCode = exitCode;
}
