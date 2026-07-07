import type { CommandContext } from "../types.js";
import { pathExists } from "../core/fs.js";
import { readActiveSession, movePlans } from "../core/switcher.js";

export async function rescueCommand(context: CommandContext): Promise<void> {
  const session = await readActiveSession(context.paths.classroomRoot);
  if (!session) {
    const payload = { ok: true, activeSession: null };
    if (context.options.json) {
      context.output.json(payload);
    } else {
      context.output.info("No active classroom session found.");
    }
    return;
  }

  const plans = await Promise.all(
    movePlans(session).map(async (plan) => ({
      label: plan.label,
      target: { path: plan.target, exists: await pathExists(plan.target) },
      profile: { path: plan.profile, exists: await pathExists(plan.profile) },
      backup: { path: plan.backup, exists: await pathExists(plan.backup) },
    })),
  );

  const payload = { ok: true, activeSession: session, plans };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  context.output.info(`Active classroom profile: ${session.profile}`);
  context.output.info(`Backup id: ${session.backupId}`);
  for (const plan of plans) {
    context.output.info(`${plan.label}:`);
    context.output.info(`  target exists: ${plan.target.exists} (${plan.target.path})`);
    context.output.info(`  profile exists: ${plan.profile.exists} (${plan.profile.path})`);
    context.output.info(`  backup exists: ${plan.backup.exists} (${plan.backup.path})`);
  }
}
