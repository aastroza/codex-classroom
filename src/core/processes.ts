import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function findCodexProcesses(): Promise<string[]> {
  if (process.platform === "win32") {
    const imageNames = ["Codex.exe", "codex.exe", "extension-host.exe", "node_repl.exe"];
    const matches: string[] = [];

    for (const imageName of imageNames) {
      matches.push(...(await findWindowsImageProcesses(imageName)));
    }

    return matches;
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm=,args="]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bCodex\b|\bcodex\b|extension-host|node_repl/.test(line))
      .filter((line) => !line.includes("codex-classroom"));
  } catch {
    return [];
  }
}

async function findWindowsImageProcesses(imageName: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.includes("INFO:"))
      .map((line) => line.replace(/^"|"$/g, ""));
  } catch {
    return [];
  }
}
