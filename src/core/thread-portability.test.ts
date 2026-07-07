import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import initSqlJs, { type Database } from "sql.js";

import { exportThreadArchive, importThreadArchive } from "./thread-portability.js";

const THREAD_ID = "019f3fff-1111-7222-8333-abcdefabcdef";

test("exports and imports a Codex thread archive", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-thread-portability-"));
  const sourceHome = path.join(root, "source");
  const targetHome = path.join(root, "target");
  const archivePath = path.join(root, "lesson.codex-thread.zip");
  const rolloutPath = path.join(
    sourceHome,
    "sessions",
    "2026",
    "07",
    "07",
    `rollout-2026-07-07T10-00-00-${THREAD_ID}.jsonl`,
  );

  await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
  await fs.writeFile(
    rolloutPath,
    `${JSON.stringify({ type: "session_meta", payload: { session_id: THREAD_ID } })}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(sourceHome, "session_index.jsonl"),
    `${JSON.stringify({ id: THREAD_ID, thread_name: "Prepared class demo", updated_at: "2026-07-07T10:10:00.000Z" })}\n`,
    "utf8",
  );
  await writeSourceStateDatabase(sourceHome, rolloutPath);

  const exported = await exportThreadArchive({
    codexHome: sourceHome,
    selector: "latest",
    out: archivePath,
    dryRun: false,
  });

  assert.equal(exported.threadId, THREAD_ID);
  assert.equal(exported.title, "Prepared class demo");
  assert.ok(exported.archiveBytes > 0);

  const imported = await importThreadArchive({
    codexHome: targetHome,
    archivePath,
    force: false,
    dryRun: false,
  });

  assert.equal(imported.threadId, THREAD_ID);
  assert.equal(imported.inserted, true);
  assert.equal(await fileExists(imported.rolloutPath), true);

  const importedIndex = await fs.readFile(path.join(targetHome, "session_index.jsonl"), "utf8");
  assert.match(importedIndex, new RegExp(THREAD_ID));

  const row = await readThreadRow(path.join(targetHome, "state_5.sqlite"), THREAD_ID);
  assert.equal(row?.title, "Prepared class demo");
  assert.equal(row?.rollout_path, imported.rolloutPath);
});

test("import rejects existing threads unless force is used", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-thread-conflict-"));
  const sourceHome = path.join(root, "source");
  const targetHome = path.join(root, "target");
  const archivePath = path.join(root, "lesson.codex-thread.zip");
  const rolloutPath = path.join(
    sourceHome,
    "sessions",
    "2026",
    "07",
    "07",
    `rollout-2026-07-07T10-00-00-${THREAD_ID}.jsonl`,
  );

  await fs.mkdir(path.dirname(rolloutPath), { recursive: true });
  await fs.writeFile(rolloutPath, "{}\n", "utf8");
  await fs.writeFile(
    path.join(sourceHome, "session_index.jsonl"),
    `${JSON.stringify({ id: THREAD_ID, thread_name: "Prepared class demo", updated_at: "2026-07-07T10:10:00.000Z" })}\n`,
    "utf8",
  );
  await writeSourceStateDatabase(sourceHome, rolloutPath);
  await exportThreadArchive({ codexHome: sourceHome, selector: THREAD_ID, out: archivePath, dryRun: false });
  await importThreadArchive({ codexHome: targetHome, archivePath, force: false, dryRun: false });

  await assert.rejects(
    () => importThreadArchive({ codexHome: targetHome, archivePath, force: false, dryRun: false }),
    /already exists/,
  );

  const replaced = await importThreadArchive({ codexHome: targetHome, archivePath, force: true, dryRun: false });
  assert.equal(replaced.replaced, true);
});

async function writeSourceStateDatabase(codexHome: string, rolloutPath: string): Promise<void> {
  await fs.mkdir(codexHome, { recursive: true });
  const db = await createTestDatabase();
  db.run(`
    create table threads (
      id text primary key,
      rollout_path text not null,
      created_at integer not null,
      updated_at integer not null,
      source text not null,
      model_provider text not null,
      cwd text not null,
      title text not null,
      sandbox_policy text not null,
      approval_mode text not null,
      tokens_used integer not null default 0,
      has_user_event integer not null default 0,
      archived integer not null default 0,
      cli_version text not null default '',
      first_user_message text not null default '',
      created_at_ms integer,
      updated_at_ms integer,
      thread_source text,
      preview text not null default '',
      recency_at integer not null default 0,
      recency_at_ms integer not null default 0
    )
  `);
  db.run(
    `insert into threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
      first_user_message, created_at_ms, updated_at_ms, thread_source, preview, recency_at, recency_at_ms
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      THREAD_ID,
      rolloutPath,
      1783418400,
      1783419000,
      "vscode",
      "openai",
      codexHome,
      "Prepared class demo",
      '{"type":"disabled"}',
      "never",
      123,
      1,
      0,
      "0.142.5",
      "Prepare this demo",
      1783418400000,
      1783419000000,
      "user",
      "Prepare this demo",
      1783419000,
      1783419000000,
    ],
  );
  await fs.writeFile(path.join(codexHome, "state_5.sqlite"), db.export());
  db.close();
}

async function readThreadRow(databasePath: string, threadId: string): Promise<Record<string, unknown> | undefined> {
  const db = await createTestDatabase(await fs.readFile(databasePath));
  const statement = db.prepare("select * from threads where id = ?");
  try {
    statement.bind([threadId]);
    return statement.step() ? statement.getAsObject() : undefined;
  } finally {
    statement.free();
    db.close();
  }
}

async function createTestDatabase(data?: Uint8Array): Promise<Database> {
  const require = createRequire(import.meta.url);
  const SQL = await initSqlJs({
    locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
  });
  return new SQL.Database(data);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
