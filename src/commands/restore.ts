import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { findCodexProcesses } from "../core/processes.js";
import { readActiveSession, restoreClassroom } from "../core/switcher.js";

export async function restoreCommand(context: CommandContext, args: string[]): Promise<void> {
  if (args.length > 0) {
    throw new CliError("restore does not accept positional arguments.");
  }

  const session = await readActiveSession(context.paths.classroomRoot);
  if (!session) {
    if (context.options.json) {
      context.output.json({ ok: true, restored: false, reason: "no-active-session" });
      return;
    }
    context.output.info("No active classroom session found.");
    return;
  }

  const processes = await findCodexProcesses();
  if (processes.length > 0 && !context.options.force) {
    throw new CliError(
      `Codex-related processes are running: ${processes.slice(0, 6).join("; ")}. Close them before restoring. --force only bypasses this check; it cannot unlock files that Windows is using.`,
    );
  }

  const actions = await restoreClassroom(session, context.options.dryRun);
  const payload = {
    ok: true,
    restored: !context.options.dryRun,
    profile: session.profile,
    backupId: session.backupId,
    actions,
    dryRun: context.options.dryRun,
  };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  context.output.info(
    context.options.dryRun
      ? `Would restore Codex state from classroom profile "${session.profile}"`
      : `Restored Codex state from classroom profile "${session.profile}"`,
  );
}
