import fs from "node:fs/promises";
import path from "node:path";

import type { CommandContext } from "../types.js";
import { pathExists } from "../core/fs.js";

export async function profilesCommand(context: CommandContext): Promise<void> {
  const profilesRoot = path.join(context.paths.classroomRoot, "profiles");
  const profiles = (await pathExists(profilesRoot))
    ? (await fs.readdir(profilesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];

  if (context.options.json) {
    context.output.json({
      ok: true,
      classroomRoot: context.paths.classroomRoot,
      profiles,
    });
    return;
  }

  if (profiles.length === 0) {
    context.output.info("No classroom profiles found.");
    return;
  }

  for (const profile of profiles) {
    context.output.info(profile);
  }
}
