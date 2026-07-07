#!/usr/bin/env node
import { parseArgs } from "node:util";

import { initCommand } from "./commands/init.js";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { profilesCommand } from "./commands/profiles.js";
import { resetCommand } from "./commands/reset.js";
import { enterCommand } from "./commands/enter.js";
import { restoreCommand } from "./commands/restore.js";
import { rescueCommand } from "./commands/rescue.js";
import { CliError } from "./core/errors.js";
import { createOutput } from "./core/output.js";
import { createPathContext } from "./core/paths.js";
import type { CommandContext, GlobalOptions } from "./types.js";

const VERSION = "0.2.5";

const command = process.argv[2] ?? "help";
const rawArgs = process.argv.slice(command === "help" ? 2 : 3);

const global = parseGlobalOptions(rawArgs);
const output = createOutput(global.json, global.plain);
const context: CommandContext = {
  options: global,
  output,
  paths: createPathContext({
    classroomRoot: global.classroomRoot,
    realCodexHome: global.realCodexHome,
    desktopStateHome: global.desktopStateHome,
  }),
};

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "version" || command === "--version" || command === "-v") {
    console.log(VERSION);
  } else if (command === "init") {
    await initCommand(context, global.positionals);
  } else if (command === "enter") {
    await enterCommand(context, global.positionals);
  } else if (command === "restore") {
    await restoreCommand(context, global.positionals);
  } else if (command === "rescue") {
    await rescueCommand(context);
  } else if (command === "start") {
    await startCommand(context, global.positionals);
  } else if (command === "status") {
    await statusCommand(context, global.positionals);
  } else if (command === "doctor") {
    await doctorCommand(context, global.positionals);
  } else if (command === "profiles") {
    await profilesCommand(context);
  } else if (command === "reset") {
    await resetCommand(context, global.positionals);
  } else {
    throw new CliError(`Unknown command: ${command}`);
  }
} catch (error) {
  const cliError = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error));
  output.error(cliError.message);
  if (global.json) {
    output.json({ ok: false, error: cliError.message });
  }
  process.exitCode = cliError.exitCode;
}

interface ParsedGlobalOptions extends GlobalOptions {
  positionals: string[];
}

function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  const separatorIndex = args.indexOf("--");
  const ownArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  const passthrough = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : [];
  const parsed = parseArgs({
    args: ownArgs,
    allowPositionals: true,
    options: {
      "classroom-root": { type: "string" },
      "real-codex-home": { type: "string" },
      "desktop-state-home": { type: "string" },
      "copy-auth": { type: "boolean" },
      "no-copy-auth": { type: "boolean" },
      "copy-config": { type: "boolean" },
      "no-copy-config": { type: "boolean" },
      "copy-windows-sandbox": { type: "boolean" },
      "no-copy-windows-sandbox": { type: "boolean" },
      "windows-sandbox-mode": { type: "string" },
      force: { type: "boolean", default: false },
      "no-launch": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      json: { type: "boolean", default: false },
      plain: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "no-input": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  return {
    classroomRoot: parsed.values["classroom-root"],
    realCodexHome: parsed.values["real-codex-home"],
    desktopStateHome: parsed.values["desktop-state-home"],
    copyAuth: parsed.values["no-copy-auth"] ? false : parsed.values["copy-auth"],
    copyConfig: parsed.values["no-copy-config"] ? false : parsed.values["copy-config"],
    copyWindowsSandbox: parsed.values["no-copy-windows-sandbox"]
      ? false
      : parsed.values["copy-windows-sandbox"],
    windowsSandboxMode: parseWindowsSandboxMode(parsed.values["windows-sandbox-mode"]),
    passthrough,
    force: parsed.values.force ?? false,
    noLaunch: parsed.values["no-launch"] ?? false,
    yes: parsed.values.yes ?? false,
    json: parsed.values.json ?? false,
    plain: parsed.values.plain ?? false,
    verbose: parsed.values.verbose ?? false,
    noInput: parsed.values["no-input"] ?? false,
    dryRun: parsed.values["dry-run"] ?? false,
    positionals: parsed.positionals,
  };
}

function printHelp(): void {
  console.log(`codex-classroom ${VERSION}

Launch Codex Desktop with clean, local classroom profiles.

Usage:
  codex-classroom init [profile] [options]
  codex-classroom enter [profile] [options] [-- <codex app args>]
  codex-classroom restore [options]
  codex-classroom rescue [options]
  codex-classroom start [profile] [options] [-- <codex app args>]
  codex-classroom status [profile] [options]
  codex-classroom doctor [profile] [options]
  codex-classroom profiles [options]
  codex-classroom reset [profile] [options]

Commands:
  init       Create a classroom profile with auth and clean classroom config
  enter      Swap local Codex state to a classroom profile, then launch Desktop
  restore    Restore the real local Codex state after class
  rescue     Show active-session recovery details
  start      Legacy launcher; does not isolate Codex Desktop sidebar state
  status     Show profile paths and setup state
  doctor     Run local checks without printing secrets
  profiles   List known classroom profiles
  reset      Remove one profile under the classroom root

Options:
  --classroom-root <path>    Override ~/.codex-classroom
  --real-codex-home <path>   Override ~/.codex
  --desktop-state-home <path> Override Codex Desktop app-state path
  --copy-auth                Copy auth.json into the classroom profile
  --no-copy-auth             Do not copy auth.json
  --copy-config              Copy real config.toml instead of generating a clean one
  --no-copy-config           Generate a clean classroom config.toml
  --copy-windows-sandbox     Copy Windows sandbox setup assets into the classroom profile
  --no-copy-windows-sandbox  Do not copy Windows sandbox setup assets
  --windows-sandbox-mode <mode>
                             Set [windows].sandbox to elevated, unelevated, or inherit
  -y, --yes                  Confirm destructive prompts
  --force                    Bypass Codex process checks
  --no-launch                Enter classroom mode without opening Codex Desktop
  --dry-run                  Print planned changes without writing
  --json                     Emit machine-readable output
  --plain                    Avoid styled text in human output
  --no-input                 Fail instead of prompting
  --verbose                  Include extra diagnostics
  -h, --help                 Show help
  -v, --version              Show version
`);
}

function parseWindowsSandboxMode(value: string | undefined): ParsedGlobalOptions["windowsSandboxMode"] {
  if (value === undefined) {
    return undefined;
  }

  if (value === "elevated" || value === "unelevated" || value === "inherit") {
    return value;
  }

  throw new CliError("--windows-sandbox-mode must be elevated, unelevated, or inherit.");
}
