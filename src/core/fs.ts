import fs from "node:fs/promises";
import path from "node:path";

import { CliError } from "./errors.js";
import { isSubpath } from "./paths.js";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }

  await fs.mkdir(target, { recursive: true });
}

export async function movePath(source: string, destination: string, dryRun: boolean): Promise<"moved" | "missing"> {
  if (!(await pathExists(source))) {
    return "missing";
  }

  if (await pathExists(destination)) {
    throw new CliError(`Destination already exists: ${destination}`);
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rename(source, destination);
  }

  return "moved";
}

export async function copyFileIfMissing(source: string, destination: string, dryRun: boolean): Promise<"copied" | "exists" | "missing"> {
  if (!(await pathExists(source))) {
    return "missing";
  }

  if (await pathExists(destination)) {
    return "exists";
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }

  return "copied";
}

export async function copyDirIfMissing(source: string, destination: string, dryRun: boolean): Promise<"copied" | "exists" | "missing"> {
  if (!(await pathExists(source))) {
    return "missing";
  }

  if (await pathExists(destination)) {
    return "exists";
  }

  if (!dryRun) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true, errorOnExist: true });
  }

  return "copied";
}

export async function writeJsonFile(target: string, value: unknown, dryRun: boolean): Promise<void> {
  if (dryRun) {
    return;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonFile<T>(target: string): Promise<T> {
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

export async function removeInsideRoot(root: string, target: string, dryRun: boolean): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);

  if (!isSubpath(resolvedRoot, resolvedTarget) || resolvedRoot === resolvedTarget) {
    throw new CliError(`Refusing to remove path outside classroom root: ${resolvedTarget}`);
  }

  if (!dryRun) {
    await fs.rm(resolvedTarget, { recursive: true, force: true });
  }
}
