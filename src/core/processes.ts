import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function findCodexProcesses(): Promise<string[]> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Codex.exe", "/FO", "CSV", "/NH"]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.includes("INFO:"))
        .map((line) => line.replace(/^"|"$/g, ""));
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "pid=,comm=,args="]);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /\bCodex\b|\bcodex\b/.test(line))
      .filter((line) => !line.includes("codex-classroom"));
  } catch {
    return [];
  }
}
