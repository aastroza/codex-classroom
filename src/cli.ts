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
import { voiceCommand } from "./commands/voice.js";
import { CliError } from "./core/errors.js";
import { createOutput } from "./core/output.js";
import { createPathContext } from "./core/paths.js";
import type { CommandContext, GlobalOptions } from "./types.js";

const VERSION = "0.7.1";

const command = process.argv[2] ?? "help";
const rawArgs = process.argv.slice(command === "help" ? 2 : 3);

const COMMON_OPTIONS = new Set([
  "classroom-root",
  "real-codex-home",
  "desktop-state-home",
  "json",
  "plain",
  "verbose",
  "no-input",
  "help",
  "h",
]);

const COMMAND_OPTIONS: Record<string, Set<string>> = {
  init: new Set(["copy-auth", "no-copy-auth", "copy-config", "no-copy-config", "copy-windows-sandbox", "no-copy-windows-sandbox", "windows-sandbox-mode"]),
  enter: new Set(["force", "no-launch", "profile-fresh", "yes", "y", "dry-run"]),
  restore: new Set(["force", "yes", "y", "dry-run"]),
  rescue: new Set([]),
  start: new Set(["no-launch"]),
  status: new Set([]),
  doctor: new Set([]),
  profiles: new Set([]),
  reset: new Set(["yes", "y", "dry-run"]),
  voice: new Set(["host", "port", "model", "voice", "language", "api-key-env", "safety-identifier", "replay", "auto-narrate", "no-auto-narrate", "open", "no-open", "qr"]),
  present: new Set(["host", "port", "model", "voice", "language", "api-key-env", "safety-identifier", "replay", "auto-narrate", "no-auto-narrate", "open", "no-open", "qr"]),
  help: new Set([]),
  version: new Set([]),
};

let global: ParsedGlobalOptions;
try {
  global = parseGlobalOptions(rawArgs);
} catch (error) {
  const cliError = error instanceof CliError ? error : new CliError(error instanceof Error ? error.message : String(error));
  console.error(`Error: ${cliError.message}`);
  process.exit(cliError.exitCode);
}
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
  } else if (command === "voice") {
    await voiceCommand(context, global.positionals);
  } else if (command === "present") {
    await voiceCommand(context, ["present", ...global.positionals]);
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
  validateOptionsForCommand(command, ownArgs);
  const parsed = parseArgs({
    args: ownArgs,
    allowPositionals: true,
    options: {
      "classroom-root": { type: "string" },
      "real-codex-home": { type: "string" },
      "desktop-state-home": { type: "string" },
      host: { type: "string" },
      port: { type: "string" },
      model: { type: "string" },
      voice: { type: "string" },
      language: { type: "string" },
      "api-key-env": { type: "string" },
      "safety-identifier": { type: "string" },
      replay: { type: "string" },
      "auto-narrate": { type: "boolean", default: true },
      "no-auto-narrate": { type: "boolean" },
      open: { type: "boolean", default: true },
      "no-open": { type: "boolean" },
      "copy-auth": { type: "boolean" },
      "no-copy-auth": { type: "boolean" },
      "copy-config": { type: "boolean" },
      "no-copy-config": { type: "boolean" },
      "copy-windows-sandbox": { type: "boolean" },
      "no-copy-windows-sandbox": { type: "boolean" },
      "windows-sandbox-mode": { type: "string" },
      force: { type: "boolean", default: false },
      "no-launch": { type: "boolean", default: false },
      "profile-fresh": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      json: { type: "boolean", default: false },
      plain: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "no-input": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      qr: { type: "boolean", default: false },
    },
  });

  return {
    classroomRoot: parsed.values["classroom-root"],
    realCodexHome: parsed.values["real-codex-home"],
    desktopStateHome: parsed.values["desktop-state-home"],
    voiceHost: parsed.values.host,
    voicePort: parsed.values.port,
    voiceModel: parsed.values.model,
    voiceName: parsed.values.voice,
    voiceLanguage: parsed.values.language,
    voiceApiKeyEnv: parsed.values["api-key-env"],
    voiceSafetyIdentifier: parsed.values["safety-identifier"],
    voiceOpen: parsed.values["no-open"] ? false : parsed.values.open,
    voiceReplayFile: parsed.values.replay,
    voiceAutoNarrate: parsed.values["no-auto-narrate"] ? false : parsed.values["auto-narrate"],
    copyAuth: parsed.values["no-copy-auth"] ? false : parsed.values["copy-auth"],
    copyConfig: parsed.values["no-copy-config"] ? false : parsed.values["copy-config"],
    copyWindowsSandbox: parsed.values["no-copy-windows-sandbox"]
      ? false
      : parsed.values["copy-windows-sandbox"],
    windowsSandboxMode: parseWindowsSandboxMode(parsed.values["windows-sandbox-mode"]),
    passthrough,
    force: parsed.values.force ?? false,
    noLaunch: parsed.values["no-launch"] ?? false,
    profileFresh: parsed.values["profile-fresh"] ?? false,
    yes: parsed.values.yes ?? false,
    json: parsed.values.json ?? false,
    plain: parsed.values.plain ?? false,
    verbose: parsed.values.verbose ?? false,
    noInput: parsed.values["no-input"] ?? false,
    dryRun: parsed.values["dry-run"] ?? false,
    qr: parsed.values.qr ?? false,
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
  codex-classroom voice <start|say|attach|pause|resume> [options]
  codex-classroom present [threadId] [options]

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
  voice      Start or control Codex Voice for classroom conversation
  present    Open a projection-friendly classroom panel

Options:
  --classroom-root <path>    Override ~/.codex-classroom
  --real-codex-home <path>   Override ~/.codex
  --desktop-state-home <path> Override Codex Desktop app-state path
  --host <host>               Codex Voice local host
  --port <port>               Codex Voice local port
  --model <model>             Codex Voice Realtime model
  --voice <voice>             Codex Voice Realtime voice
  --language <language>       Codex Voice spoken language
  --api-key-env <name>        Env var containing the OpenAI API key
  --safety-identifier <id>    Optional privacy-preserving Realtime safety id
  --replay <file>             Feed a rollout JSONL into Present/Voice for demos
  --auto-narrate              Let the classroom layer speak phase transitions
  --no-auto-narrate           Disable automatic classroom narration
  --no-open                   Do not open browser for voice start
  --qr                        Print presentation URL for sharing
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
  --profile-fresh            Reset the profile Desktop state before enter
  --dry-run                  Print planned changes without writing
  --json                     Emit machine-readable output
  --plain                    Avoid styled text in human output
  --no-input                 Fail instead of prompting
  --verbose                  Include extra diagnostics
  -h, --help                 Show help
  -v, --version              Show version
`);
}

function validateOptionsForCommand(commandName: string, args: string[]): void {
  const allowed = new Set([...(COMMAND_OPTIONS[commandName] ?? []), ...COMMON_OPTIONS]);
  for (const arg of args) {
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    const option = arg.startsWith("--")
      ? arg.slice(2).split("=")[0]
      : arg.slice(1);
    if (option && !allowed.has(option)) {
      throw new CliError(`Unknown option for ${commandName}: ${arg.startsWith("--") ? `--${option}` : `-${option}`}`);
    }
  }
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
