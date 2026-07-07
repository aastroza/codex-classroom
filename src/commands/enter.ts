import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { ensureProfile } from "../core/profiles.js";
import { findCodexProcesses } from "../core/processes.js";
import { getProfilePaths } from "../core/paths.js";
import { createActiveSession, createBackupId, enterClassroom, readActiveSession } from "../core/switcher.js";
import { runCodexApp } from "../core/codex.js";

export async function enterCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  if (args.length > 1) {
    throw new CliError("enter accepts at most one profile name.");
  }

  const existingSession = await readActiveSession(context.paths.classroomRoot);
  if (existingSession) {
    throw new CliError(`A classroom session is already active for profile "${existingSession.profile}". Run restore first.`);
  }

  const processes = await findCodexProcesses();
  if (processes.length > 0 && !context.options.force) {
    throw new CliError(
      `Codex-related processes are running: ${processes.slice(0, 6).join("; ")}. Close Codex Desktop, Codex app-server, VS Code/OpenAI extension, and browser extension helpers before entering classroom mode.`,
    );
  }

  if (!context.options.dryRun && !context.options.yes) {
    if (context.options.noInput) {
      throw new CliError("enter requires --yes when --no-input is set.");
    }
    await confirmEnter(profileName);
  }

  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  await ensureProfile({
    paths,
    realCodexHome: context.paths.realCodexHome,
    copyAuth: context.options.copyAuth ?? true,
    copyConfig: context.options.copyConfig ?? false,
    copyWindowsSandbox: context.options.copyWindowsSandbox ?? false,
    windowsSandboxMode: context.options.windowsSandboxMode ?? (process.platform === "win32" ? "unelevated" : "inherit"),
    dryRun: context.options.dryRun,
  });

  const session = createActiveSession({
    profile: paths.profileName,
    classroomRoot: context.paths.classroomRoot,
    realCodexHome: context.paths.realCodexHome,
    desktopStateHome: context.paths.desktopStateHome,
    profilePaths: paths,
    backupId: createBackupId(),
  });

  const actions = await enterClassroom(session, context.options.dryRun);
  const payload = {
    ok: true,
    profile: paths.profileName,
    activeSession: session,
    actions,
    dryRun: context.options.dryRun,
  };

  if (context.options.json) {
    context.output.json(payload);
  } else {
    context.output.info(`Entered classroom profile "${paths.profileName}"`);
    context.output.info(`Backup id: ${session.backupId}`);
    context.output.info(`Workspace: ${paths.workspace}`);
  }

  if (!context.options.dryRun && !context.options.noLaunch) {
    const exitCode = await runCodexApp({
      codexHome: context.paths.realCodexHome,
      workspace: paths.workspace,
      dryRun: false,
      extraArgs: context.options.passthrough,
    });
    process.exitCode = exitCode;
  }
}

async function confirmEnter(profileName: string): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `This will temporarily swap your local Codex state for classroom profile "${profileName}". Type the profile name to continue: `,
  );
  rl.close();

  if (answer !== profileName) {
    throw new CliError("Enter cancelled.", 0);
  }
}
