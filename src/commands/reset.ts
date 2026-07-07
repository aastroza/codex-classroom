import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { pathExists, removeInsideRoot } from "../core/fs.js";
import { getProfilePaths } from "../core/paths.js";

export async function resetCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const paths = getProfilePaths(context.paths.classroomRoot, profileName);

  if (args.length > 1) {
    throw new CliError("reset accepts at most one profile name.");
  }

  if (!(await pathExists(paths.profileDir))) {
    if (context.options.json) {
      context.output.json({ ok: true, profile: paths.profileName, removed: false, reason: "missing" });
      return;
    }
    context.output.info(`Profile "${paths.profileName}" does not exist.`);
    return;
  }

  if (!context.options.dryRun && !context.options.yes) {
    if (context.options.noInput) {
      throw new CliError("reset requires --yes when --no-input is set.");
    }

    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(`Remove classroom profile "${paths.profileName}"? Type the profile name to confirm: `);
    rl.close();
    if (answer !== paths.profileName) {
      throw new CliError("Reset cancelled.", 0);
    }
  }

  await removeInsideRoot(context.paths.classroomRoot, paths.profileDir, context.options.dryRun);

  if (context.options.json) {
    context.output.json({
      ok: true,
      profile: paths.profileName,
      removed: !context.options.dryRun,
      dryRun: context.options.dryRun,
    });
    return;
  }

  context.output.info(
    context.options.dryRun
      ? `Would remove profile "${paths.profileName}"`
      : `Removed profile "${paths.profileName}"`,
  );
}
