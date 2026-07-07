import { spawn } from "node:child_process";

import { CliError } from "./errors.js";

export async function runCodexApp(options: {
  codexHome: string;
  workspace: string;
  dryRun: boolean;
  extraArgs: string[];
}): Promise<number> {
  const command = "codex";
  const args = ["app", options.workspace, ...options.extraArgs];
  const env = { ...process.env, CODEX_HOME: options.codexHome };

  if (options.dryRun) {
    console.log(`CODEX_HOME=${options.codexHome}`);
    console.log(`${command} ${args.map(quoteArg).join(" ")}`);
    return 0;
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", (error) => {
      reject(new CliError(`Unable to launch Codex CLI: ${error.message}`));
    });

    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

function quoteArg(value: string): string {
  if (/^[a-zA-Z0-9_./:\\-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
