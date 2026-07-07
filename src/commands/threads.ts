import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { pathExists } from "../core/fs.js";
import { exportThreadArchive, importThreadArchive } from "../core/thread-portability.js";

const CODEX_THREADS_SKILL_NAME = "codex-threads";

export async function threadsCommand(context: CommandContext, args: string[]): Promise<void> {
  const action = args[0] ?? "help";

  if (action === "help" || action === "--help" || action === "-h") {
    printThreadsHelp(context);
    return;
  }

  if (action === "export") {
    await exportThread(context, args.slice(1));
    return;
  }

  if (action === "import") {
    await importThread(context, args.slice(1));
    return;
  }

  if (action === "install-skill") {
    await installThreadsSkill(context);
    return;
  }

  throw new CliError(`Unknown threads command: ${action}`);
}

async function exportThread(context: CommandContext, args: string[]): Promise<void> {
  const selector = args[0] ?? "latest";
  if (args.length > 1) {
    throw new CliError("threads export accepts at most one selector: a thread id or latest.");
  }

  const result = await exportThreadArchive({
    codexHome: context.paths.realCodexHome,
    selector,
    out: context.options.out,
    dryRun: context.options.dryRun,
  });

  if (context.options.json) {
    context.output.json({ ok: true, ...result, dryRun: context.options.dryRun });
    return;
  }

  context.output.info(context.options.dryRun ? "Would export Codex thread archive" : "Exported Codex thread archive");
  context.output.info(`Thread: ${result.title} (${result.threadId})`);
  context.output.info(`Archive: ${result.archivePath}`);
  context.output.info(`Size: ${result.archiveBytes} bytes`);
}

async function importThread(context: CommandContext, args: string[]): Promise<void> {
  const archivePath = args[0];
  if (!archivePath || args.length > 1) {
    throw new CliError("threads import requires exactly one .codex-thread.zip archive path.");
  }

  const result = await importThreadArchive({
    codexHome: context.paths.realCodexHome,
    archivePath,
    force: context.options.force,
    dryRun: context.options.dryRun,
  });

  if (context.options.json) {
    context.output.json({ ok: true, ...result, dryRun: context.options.dryRun });
    return;
  }

  context.output.info(context.options.dryRun ? "Would import Codex thread archive" : "Imported Codex thread archive");
  context.output.info(`Thread: ${result.title} (${result.threadId})`);
  context.output.info(`Codex home: ${result.codexHome}`);
  context.output.info(`Rollout: ${result.rolloutPath}`);
}

async function installThreadsSkill(context: CommandContext): Promise<void> {
  const sourceDir = path.join(packageRoot(), "skills", CODEX_THREADS_SKILL_NAME);
  const targetDir = path.join(context.paths.realCodexHome, "skills", CODEX_THREADS_SKILL_NAME);
  const source = path.join(sourceDir, "SKILL.md");
  const target = path.join(targetDir, "SKILL.md");

  if (!(await pathExists(source))) {
    throw new CliError(`Packaged Codex Threads skill is missing: ${source}`);
  }

  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });

  if (context.options.json) {
    context.output.json({ ok: true, skill: CODEX_THREADS_SKILL_NAME, target });
    return;
  }

  context.output.info(`Installed ${CODEX_THREADS_SKILL_NAME} skill to ${target}`);
  context.output.info("Restart Codex to pick up new skills.");
}

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function printThreadsHelp(context: CommandContext): void {
  context.output.info(`codex-classroom threads

Usage:
  codex-classroom threads export [thread-id|latest] --out <archive.zip> [options]
  codex-classroom threads import <archive.zip> [options]
  codex-classroom threads install-skill [options]

Commands:
  export         Export one Codex chat thread to a .codex-thread.zip archive
  import         Import one .codex-thread.zip archive into the active Codex home
  install-skill  Install the codex-threads skill into the active Codex home

Options:
  --real-codex-home <path>  Select the Codex home to export from or import into
  --out <path>              Export archive path
  --force                   Replace an existing thread on import
  --dry-run                 Print the planned operation without writing
  --json                    Emit machine-readable output
`);
}
