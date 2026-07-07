import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureProfile } from "./profiles.js";
import { activeSessionPath, getProfilePaths } from "./paths.js";
import { createActiveSession, enterClassroom, restoreClassroom, writeActiveSession } from "./switcher.js";

test("enterClassroom and restoreClassroom swap both Codex state roots", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-classroom-test-"));
  const classroomRoot = path.join(root, "classroom");
  const realCodexHome = path.join(root, "real-codex-home");
  const desktopStateHome = path.join(root, "desktop-state-home");
  const sourceCodexHome = path.join(root, "source-codex-home");
  const profilePaths = getProfilePaths(classroomRoot, "intro");

  await fs.mkdir(realCodexHome, { recursive: true });
  await fs.writeFile(path.join(realCodexHome, "real.txt"), "real codex");
  await fs.mkdir(desktopStateHome, { recursive: true });
  await fs.writeFile(path.join(desktopStateHome, "desktop.txt"), "real desktop");
  await fs.mkdir(sourceCodexHome, { recursive: true });
  await fs.writeFile(path.join(sourceCodexHome, "auth.json"), "{}");
  await fs.writeFile(path.join(sourceCodexHome, "config.toml"), "model = \"test\"\n");

  await ensureProfile({
    paths: profilePaths,
    realCodexHome: sourceCodexHome,
    copyAuth: true,
    copyConfig: true,
    copyWindowsSandbox: false,
    windowsSandboxMode: "inherit",
    dryRun: false,
  });
  await fs.writeFile(path.join(profilePaths.desktopState, "classroom.txt"), "classroom desktop");

  const session = createActiveSession({
    profile: "intro",
    classroomRoot,
    realCodexHome,
    desktopStateHome,
    profilePaths,
    backupId: "backup-test",
  });

  await enterClassroom(session, false);

  assert.equal(await readText(path.join(realCodexHome, "auth.json")), "{}");
  assert.equal(await readText(path.join(desktopStateHome, "classroom.txt")), "classroom desktop");
  assert.equal(await readText(path.join(session.paths.backupCodexHome, "real.txt")), "real codex");
  assert.equal(await readText(path.join(session.paths.backupDesktopState, "desktop.txt")), "real desktop");

  await fs.writeFile(path.join(realCodexHome, "new-classroom-state.txt"), "kept");
  await restoreClassroom(session, false);

  assert.equal(await readText(path.join(realCodexHome, "real.txt")), "real codex");
  assert.equal(await readText(path.join(desktopStateHome, "desktop.txt")), "real desktop");
  assert.equal(await readText(path.join(profilePaths.codexHome, "new-classroom-state.txt")), "kept");

  await fs.rm(root, { recursive: true, force: true });
});

test("enterClassroom clears active session when the first move fails before state changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-classroom-test-"));
  const classroomRoot = path.join(root, "classroom");
  const realCodexHome = path.join(root, "real-codex-home");
  const desktopStateHome = path.join(root, "desktop-state-home");
  const profilePaths = getProfilePaths(classroomRoot, "intro");

  await fs.mkdir(realCodexHome, { recursive: true });
  await fs.mkdir(desktopStateHome, { recursive: true });
  await fs.mkdir(profilePaths.codexHome, { recursive: true });
  await fs.mkdir(profilePaths.desktopState, { recursive: true });
  await fs.mkdir(path.join(classroomRoot, "backups", "backup-test", "codex-home"), { recursive: true });

  const session = createActiveSession({
    profile: "intro",
    classroomRoot,
    realCodexHome,
    desktopStateHome,
    profilePaths,
    backupId: "backup-test",
  });

  await assert.rejects(() => enterClassroom(session, false));

  assert.equal(await exists(activeSessionPath(classroomRoot)), false);
  assert.equal(await exists(realCodexHome), true);
  assert.equal(await exists(profilePaths.codexHome), true);

  await fs.rm(root, { recursive: true, force: true });
});

test("restoreClassroom tolerates sessions where only one state root moved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-classroom-test-"));
  const classroomRoot = path.join(root, "classroom");
  const realCodexHome = path.join(root, "real-codex-home");
  const desktopStateHome = path.join(root, "desktop-state-home");
  const profilePaths = getProfilePaths(classroomRoot, "intro");

  await fs.mkdir(profilePaths.codexHome, { recursive: true });
  await fs.writeFile(path.join(profilePaths.codexHome, "classroom.txt"), "classroom");
  await fs.mkdir(desktopStateHome, { recursive: true });
  await fs.writeFile(path.join(desktopStateHome, "desktop.txt"), "real desktop");
  await fs.mkdir(profilePaths.desktopState, { recursive: true });

  const session = createActiveSession({
    profile: "intro",
    classroomRoot,
    realCodexHome,
    desktopStateHome,
    profilePaths,
    backupId: "backup-test",
  });

  await fs.mkdir(path.dirname(session.paths.backupCodexHome), { recursive: true });
  await fs.mkdir(session.paths.backupCodexHome, { recursive: true });
  await fs.writeFile(path.join(session.paths.backupCodexHome, "real.txt"), "real");
  await fs.rename(profilePaths.codexHome, realCodexHome);
  await writeActiveSession(session, false);

  await restoreClassroom(session, false);

  assert.equal(await readText(path.join(realCodexHome, "real.txt")), "real");
  assert.equal(await readText(path.join(profilePaths.codexHome, "classroom.txt")), "classroom");
  assert.equal(await readText(path.join(desktopStateHome, "desktop.txt")), "real desktop");
  assert.equal(await exists(activeSessionPath(classroomRoot)), false);

  await fs.rm(root, { recursive: true, force: true });
});

async function readText(target: string): Promise<string> {
  return fs.readFile(target, "utf8");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
