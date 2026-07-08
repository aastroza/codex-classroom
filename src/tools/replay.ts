import fs from "node:fs/promises";

import { mapRolloutText } from "../core/rollout-watcher.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run replay -- <rollout.jsonl>");
  process.exit(1);
}

const text = await fs.readFile(file, "utf8");
const moments = mapRolloutText(text).map((event) => event.moment).filter(Boolean);
console.log(JSON.stringify(moments, null, 2));
