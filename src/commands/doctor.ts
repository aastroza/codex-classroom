import path from "node:path";
import { spawn } from "node:child_process";

import type { CommandContext, DoctorCheck } from "../types.js";
import { pathExists } from "../core/fs.js";
import { getProfilePaths } from "../core/paths.js";

export async function doctorCommand(context: CommandContext, args: string[]): Promise<void> {
  const profileName = args[0] ?? "intro";
  const paths = getProfilePaths(context.paths.classroomRoot, profileName);
  const checks: DoctorCheck[] = [];

  checks.push({
    id: "real-codex-home",
    status: (await pathExists(context.paths.realCodexHome)) ? "ok" : "fail",
    summary: `Real Codex home ${await pathStatus(context.paths.realCodexHome)}`,
    details: { path: context.paths.realCodexHome },
  });

  checks.push({
    id: "real-auth",
    status: (await pathExists(path.join(context.paths.realCodexHome, "auth.json"))) ? "ok" : "warn",
    summary: `Source auth.json ${await pathStatus(path.join(context.paths.realCodexHome, "auth.json"))}`,
  });

  checks.push({
    id: "profile-home",
    status: (await pathExists(paths.codexHome)) ? "ok" : "warn",
    summary: `Profile CODEX_HOME ${await pathStatus(paths.codexHome)}`,
    details: { path: paths.codexHome },
  });

  checks.push({
    id: "codex-cli",
    ...(await checkCodexCli()),
  });

  const ok = checks.every((check) => check.status !== "fail");
  const payload = { ok, profile: paths.profileName, checks };

  if (context.options.json) {
    context.output.json(payload);
    return;
  }

  for (const check of checks) {
    context.output.info(`${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }
}

async function pathStatus(target: string): Promise<string> {
  return (await pathExists(target)) ? "exists" : "is missing";
}

async function checkCodexCli(): Promise<Omit<DoctorCheck, "id">> {
  return await new Promise((resolve) => {
    const child = spawn("codex", ["--version"], {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ status: "fail", summary: `Codex CLI not available: ${error.message}` });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ status: "ok", summary: stdout.trim() || "Codex CLI is available" });
      } else {
        resolve({ status: "fail", summary: stderr.trim() || `Codex CLI exited with ${code}` });
      }
    });
  });
}
