import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureProfile } from "./profiles.js";
import { getProfilePaths } from "./paths.js";
import { createActiveSession, enterClassroom, restoreClassroom } from "./switcher.js";

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

async function readText(target: string): Promise<string> {
  return fs.readFile(target, "utf8");
}
