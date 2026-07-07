import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { CliError } from "./errors.js";
import { pathExists } from "./fs.js";

export interface ThreadExportResult {
  threadId: string;
  title: string;
  archivePath: string;
  archiveBytes: number;
  rolloutPath: string;
}

export interface ThreadImportResult {
  threadId: string;
  title: string;
  archivePath: string;
  codexHome: string;
  rolloutPath: string;
  inserted: boolean;
  replaced: boolean;
}

interface ThreadArchiveManifest {
  schemaVersion: 1;
  type: "codex-classroom-thread-export";
  threadId: string;
  exportedAt: string;
  source: {
    rolloutBasename: string;
    relativeRolloutPath: string;
  };
  threadsTableSchema: string;
  stateThread: Record<string, JsonValue>;
  sessionIndex: Array<Record<string, JsonValue>>;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const THREAD_ARCHIVE_TYPE = "codex-classroom-thread-export";
const THREAD_ARCHIVE_VERSION = 1;

let sqlModule: Promise<SqlJsStatic> | undefined;

export async function exportThreadArchive(input: {
  codexHome: string;
  selector: string;
  out?: string;
  dryRun: boolean;
}): Promise<ThreadExportResult> {
  const codexHome = path.resolve(input.codexHome);
  const threadId = await resolveThreadSelector(codexHome, input.selector);
  const stateDbPath = path.join(codexHome, "state_5.sqlite");
  const database = await openDatabase(stateDbPath);
  try {
    const stateThread = getThreadRow(database, threadId);
    if (!stateThread) {
      throw new CliError(`Thread "${threadId}" was not found in ${stateDbPath}. Close Codex and try again if the thread is recent.`);
    }

    const rolloutPath = String(stateThread.rollout_path ?? "");
    if (!rolloutPath || !(await pathExists(rolloutPath))) {
      throw new CliError(`Thread rollout file is missing: ${rolloutPath}`);
    }

    const relativeRolloutPath = relativeSessionRolloutPath(codexHome, rolloutPath);
    const sessionIndex = await findSessionIndexRows(codexHome, threadId, stateThread);
    const schema = getThreadsTableSchema(database);
    const title = String(stateThread.title ?? sessionIndex[0]?.thread_name ?? threadId);
    const archivePath = path.resolve(input.out ?? `${sanitizeArchiveName(title)}-${threadId}.codex-thread.zip`);
    const rolloutBytes = await fs.readFile(rolloutPath);

    const manifest: ThreadArchiveManifest = {
      schemaVersion: THREAD_ARCHIVE_VERSION,
      type: THREAD_ARCHIVE_TYPE,
      threadId,
      exportedAt: new Date().toISOString(),
      source: {
        rolloutBasename: path.basename(rolloutPath),
        relativeRolloutPath,
      },
      threadsTableSchema: schema,
      stateThread: toJsonRecord(stateThread),
      sessionIndex,
    };

    const entries: Record<string, Uint8Array> = {
      "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
      [`threads/${toArchivePath(relativeRolloutPath)}`]: rolloutBytes,
    };
    const archiveBytes = zipSync(entries, { level: 6 });

    if (!input.dryRun) {
      await fs.mkdir(path.dirname(archivePath), { recursive: true });
      await fs.writeFile(archivePath, archiveBytes);
    }

    return {
      threadId,
      title,
      archivePath,
      archiveBytes: archiveBytes.byteLength,
      rolloutPath,
    };
  } finally {
    database.close();
  }
}

export async function importThreadArchive(input: {
  codexHome: string;
  archivePath: string;
  force: boolean;
  dryRun: boolean;
}): Promise<ThreadImportResult> {
  const codexHome = path.resolve(input.codexHome);
  const archivePath = path.resolve(input.archivePath);
  if (!(await pathExists(archivePath))) {
    throw new CliError(`Thread archive not found: ${archivePath}`);
  }

  await assertSafeSqliteWrite(path.join(codexHome, "state_5.sqlite"));

  const archive = unzipSync(await fs.readFile(archivePath));
  const manifest = readManifest(archive);
  const rolloutEntry = `threads/${toArchivePath(manifest.source.relativeRolloutPath)}`;
  const rolloutBytes = archive[rolloutEntry];
  if (!rolloutBytes) {
    throw new CliError(`Thread archive is missing ${rolloutEntry}`);
  }

  const targetRolloutPath = path.join(codexHome, "sessions", fromArchivePath(manifest.source.relativeRolloutPath));
  const rolloutExists = await pathExists(targetRolloutPath);
  const stateDbPath = path.join(codexHome, "state_5.sqlite");
  const stateExists = await pathExists(stateDbPath);
  const database = stateExists ? await openDatabase(stateDbPath) : await createDatabase();

  try {
    ensureThreadsTable(database, manifest.threadsTableSchema);
    const existing = getThreadRow(database, manifest.threadId);
    if ((existing || rolloutExists) && !input.force) {
      throw new CliError(`Thread "${manifest.threadId}" already exists. Use --force to replace it.`);
    }

    const row: Record<string, JsonValue> = {
      ...manifest.stateThread,
      rollout_path: targetRolloutPath,
    };
    upsertThreadRow(database, row);

    if (!input.dryRun) {
      await fs.mkdir(path.dirname(targetRolloutPath), { recursive: true });
      await fs.writeFile(targetRolloutPath, rolloutBytes);
      await upsertSessionIndexRows(codexHome, manifest.sessionIndex, manifest.threadId, input.force);
      await fs.mkdir(path.dirname(stateDbPath), { recursive: true });
      await fs.writeFile(stateDbPath, database.export());
    }

    return {
      threadId: manifest.threadId,
      title: String(row.title ?? manifest.threadId),
      archivePath,
      codexHome,
      rolloutPath: targetRolloutPath,
      inserted: !existing,
      replaced: Boolean(existing || rolloutExists),
    };
  } finally {
    database.close();
  }
}

async function getSql(): Promise<SqlJsStatic> {
  sqlModule ??= initSqlJs({
    locateFile: (file) => {
      const require = createRequire(import.meta.url);
      return require.resolve(`sql.js/dist/${file}`);
    },
  });
  return await sqlModule;
}

async function openDatabase(databasePath: string): Promise<Database> {
  if (!(await pathExists(databasePath))) {
    throw new CliError(`Codex state database not found: ${databasePath}`);
  }

  const SQL = await getSql();
  return new SQL.Database(await fs.readFile(databasePath));
}

async function createDatabase(): Promise<Database> {
  const SQL = await getSql();
  return new SQL.Database();
}

function getThreadRow(database: Database, threadId: string): Record<string, unknown> | undefined {
  const statement = database.prepare("select * from threads where id = ?");
  try {
    statement.bind([threadId]);
    return statement.step() ? statement.getAsObject() : undefined;
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) {
      return undefined;
    }
    throw error;
  } finally {
    statement.free();
  }
}

function getThreadsTableSchema(database: Database): string {
  const statement = database.prepare("select sql from sqlite_master where type = 'table' and name = 'threads'");
  try {
    if (!statement.step()) {
      throw new CliError("Codex state database does not contain a threads table.");
    }
    const row = statement.getAsObject();
    return String(row.sql);
  } finally {
    statement.free();
  }
}

function ensureThreadsTable(database: Database, schema: string): void {
  const result = database.exec("select name from sqlite_master where type = 'table' and name = 'threads'");
  if (result.length > 0 && result[0]?.values.length > 0) {
    return;
  }
  database.run(schema);
}

function upsertThreadRow(database: Database, row: Record<string, JsonValue>): void {
  const columns = getThreadColumns(database);
  const values = columns.map((column) => row[column] ?? null);
  const placeholders = columns.map(() => "?").join(", ");
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  database.run(`insert or replace into threads (${quotedColumns}) values (${placeholders})`, values);
}

function getThreadColumns(database: Database): string[] {
  const result = database.exec("pragma table_info(threads)");
  if (result.length === 0) {
    throw new CliError("Could not inspect threads table columns.");
  }
  const nameIndex = result[0].columns.indexOf("name");
  return result[0].values.map((row) => String(row[nameIndex]));
}

async function resolveThreadSelector(codexHome: string, selector: string): Promise<string> {
  if (selector === "latest") {
    const rows = await readSessionIndex(codexHome);
    if (rows.length === 0) {
      throw new CliError("No threads found in session_index.jsonl.");
    }
    const sorted = rows
      .filter((row) => typeof row.id === "string")
      .sort((a, b) => Date.parse(String(b.updated_at ?? "")) - Date.parse(String(a.updated_at ?? "")));
    const latest = sorted[0];
    if (!latest?.id) {
      throw new CliError("Could not resolve latest thread from session_index.jsonl.");
    }
    return String(latest.id);
  }

  if (!/^[a-zA-Z0-9-]+$/.test(selector)) {
    throw new CliError("Thread selector must be a thread id or latest.");
  }
  return selector;
}

async function findSessionIndexRows(
  codexHome: string,
  threadId: string,
  stateThread: Record<string, unknown>,
): Promise<Array<Record<string, JsonValue>>> {
  const rows = await readSessionIndex(codexHome);
  const matches = rows.filter((row) => row.id === threadId);
  if (matches.length > 0) {
    return matches;
  }

  return [
    {
      id: threadId,
      thread_name: String(stateThread.title ?? threadId),
      updated_at: new Date(Number(stateThread.updated_at_ms ?? Date.now())).toISOString(),
    },
  ];
}

async function readSessionIndex(codexHome: string): Promise<Array<Record<string, JsonValue>>> {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  if (!(await pathExists(indexPath))) {
    return [];
  }

  const rows: Array<Record<string, JsonValue>> = [];
  for (const line of (await fs.readFile(indexPath, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Record<string, JsonValue>;
      rows.push(parsed);
    } catch {
      // Ignore malformed index lines instead of blocking archive operations.
    }
  }
  return rows;
}

async function upsertSessionIndexRows(
  codexHome: string,
  incomingRows: Array<Record<string, JsonValue>>,
  threadId: string,
  force: boolean,
): Promise<void> {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  const existing = await readSessionIndex(codexHome);
  const kept = existing.filter((row) => row.id !== threadId);
  const rows = incomingRows.length > 0 ? incomingRows : [{ id: threadId, thread_name: threadId, updated_at: new Date().toISOString() }];
  const output = [...kept, ...rows].map((row) => JSON.stringify(row)).join("\n");
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${output}\n`, "utf8");
}

async function assertSafeSqliteWrite(databasePath: string): Promise<void> {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${databasePath}${suffix}`;
    if (!(await pathExists(sidecar))) {
      continue;
    }
    const stat = await fs.stat(sidecar);
    if (stat.size > 0) {
      throw new CliError(`Refusing to import while SQLite sidecar is active: ${sidecar}. Close Codex Desktop and try again.`);
    }
  }
}

function readManifest(archive: Record<string, Uint8Array>): ThreadArchiveManifest {
  const bytes = archive["manifest.json"];
  if (!bytes) {
    throw new CliError("Thread archive is missing manifest.json.");
  }

  const manifest = JSON.parse(strFromU8(bytes)) as Partial<ThreadArchiveManifest>;
  if (
    manifest.schemaVersion !== THREAD_ARCHIVE_VERSION ||
    manifest.type !== THREAD_ARCHIVE_TYPE ||
    typeof manifest.threadId !== "string" ||
    !manifest.source?.relativeRolloutPath ||
    typeof manifest.threadsTableSchema !== "string" ||
    !manifest.stateThread
  ) {
    throw new CliError("Thread archive manifest is invalid or unsupported.");
  }

  return manifest as ThreadArchiveManifest;
}

function relativeSessionRolloutPath(codexHome: string, rolloutPath: string): string {
  const relative = path.relative(path.join(codexHome, "sessions"), rolloutPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const parts = path.normalize(rolloutPath).split(path.sep);
    const sessionsIndex = parts.lastIndexOf("sessions");
    if (sessionsIndex >= 0 && parts.length > sessionsIndex + 1) {
      return toArchivePath(parts.slice(sessionsIndex + 1).join(path.sep));
    }
    throw new CliError(`Thread rollout path is not under sessions/: ${rolloutPath}`);
  }
  return toArchivePath(relative);
}

function toArchivePath(value: string): string {
  return value.split(path.sep).join("/");
}

function fromArchivePath(value: string): string {
  return value.split("/").join(path.sep);
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toJsonRecord(value: Record<string, unknown>): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = toJsonValue(item);
  }
  return output;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  return String(value);
}

function sanitizeArchiveName(value: string): string {
  const normalized = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "codex-thread";
}
