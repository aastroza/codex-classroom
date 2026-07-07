import fs from "node:fs/promises";
import path from "node:path";

import type { PresentEvent, PresentPlanStep } from "./event-mapper.js";
import { pathExists } from "./fs.js";
import type { VoiceContextInput } from "./voice-context.js";

export interface RolloutMappedEvent {
  context?: VoiceContextInput;
  present?: PresentEvent;
}

export interface RolloutWatcherOptions {
  codexHome: string;
  since: Date;
  pollMs?: number;
  onEvent: (event: RolloutMappedEvent) => void | Promise<void>;
}

interface WatchedFile {
  offset: number;
  parser: RolloutParserState;
}

interface RolloutParserState {
  calls: Map<string, ToolCallInfo>;
}

interface ToolCallInfo {
  name: string;
  command: string;
}

const MAX_INITIAL_BYTES = 768 * 1024;
const MAX_TEXT_LENGTH = 260;

export class RolloutWatcher {
  private readonly sessionsDir: string;
  private readonly sinceMs: number;
  private readonly pollMs: number;
  private readonly onEvent: (event: RolloutMappedEvent) => void | Promise<void>;
  private readonly watched = new Map<string, WatchedFile>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private followRecent = true;

  constructor(options: RolloutWatcherOptions) {
    this.sessionsDir = path.join(options.codexHome, "sessions");
    this.sinceMs = options.since.getTime();
    this.pollMs = options.pollMs ?? 1000;
    this.onEvent = options.onEvent;
  }

  async start(initialThreadId?: string): Promise<void> {
    if (!(await pathExists(this.sessionsDir))) {
      return;
    }

    if (initialThreadId) {
      this.followRecent = false;
      await this.attachThread(initialThreadId);
    } else {
      await this.attachRecentFiles();
    }

    this.timer = setInterval(() => {
      void this.poll().catch(() => {
        // Session polling is best-effort; the sidecar should keep serving manual cues.
      });
    }, this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async attachThread(threadId: string): Promise<boolean> {
    const file = await this.findThreadFile(threadId);
    if (!file) {
      return false;
    }

    await this.hydrateAndWatch(file);
    return true;
  }

  private async poll(): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (this.followRecent) {
      await this.attachRecentFiles();
    }
    for (const file of [...this.watched.keys()]) {
      await this.readNewLines(file);
    }
  }

  private async attachRecentFiles(): Promise<void> {
    const files = await this.listRolloutFiles();
    const recent = files
      .filter((file) => file.mtimeMs >= this.sinceMs - 5000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 4);

    for (const file of recent) {
      if (!this.watched.has(file.file)) {
        await this.hydrateAndWatch(file.file);
      }
    }
  }

  private async hydrateAndWatch(file: string): Promise<void> {
    const stat = await fs.stat(file);
    const parser = createRolloutParserState();
    const text = await readInitialText(file, stat.size);
    for (const event of mapRolloutText(text, parser)) {
      await this.onEvent(event);
    }
    this.watched.set(file, { offset: stat.size, parser });
  }

  private async readNewLines(file: string): Promise<void> {
    const watched = this.watched.get(file);
    if (!watched) {
      return;
    }

    const stat = await fs.stat(file).catch(() => null);
    if (!stat) {
      this.watched.delete(file);
      return;
    }

    if (stat.size < watched.offset) {
      watched.offset = 0;
    }
    if (stat.size === watched.offset) {
      return;
    }

    const handle = await fs.open(file, "r");
    try {
      const length = stat.size - watched.offset;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, watched.offset);
      watched.offset = stat.size;
      for (const event of mapRolloutText(buffer.toString("utf8"), watched.parser)) {
        await this.onEvent(event);
      }
    } finally {
      await handle.close();
    }
  }

  private async findThreadFile(threadId: string): Promise<string | null> {
    const files = await this.listRolloutFiles();
    const pathMatch = files.find((file) => file.file.includes(threadId));
    if (pathMatch) {
      return pathMatch.file;
    }

    for (const file of files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 200)) {
      const firstLine = await readFirstLine(file.file).catch(() => "");
      if (firstLine.includes(threadId)) {
        return file.file;
      }
    }
    return null;
  }

  private async listRolloutFiles(): Promise<Array<{ file: string; mtimeMs: number }>> {
    const files: Array<{ file: string; mtimeMs: number }> = [];
    await walkRolloutFiles(this.sessionsDir, files);
    return files;
  }
}

export function createRolloutParserState(): RolloutParserState {
  return { calls: new Map() };
}

export function mapRolloutText(text: string, state = createRolloutParserState()): RolloutMappedEvent[] {
  const events: RolloutMappedEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const event = mapRolloutLine(line, state);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

export function mapRolloutLine(line: string, state = createRolloutParserState()): RolloutMappedEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return mapRolloutRecord(parsed, state);
}

export function mapRolloutRecord(value: unknown, state = createRolloutParserState()): RolloutMappedEvent | null {
  const record = asRecord(value);
  const timestamp = stringValue(record.timestamp) ?? new Date().toISOString();
  const payload = asRecord(record.payload);

  if (record.type === "event_msg") {
    return mapEventMessage(payload, timestamp);
  }

  if (record.type === "response_item") {
    return mapResponseItem(payload, timestamp, state);
  }

  return null;
}

async function walkRolloutFiles(dir: string, files: Array<{ file: string; mtimeMs: number }>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkRolloutFiles(entryPath, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const stat = await fs.stat(entryPath).catch(() => null);
    if (stat) {
      files.push({ file: entryPath, mtimeMs: stat.mtimeMs });
    }
  }
}

async function readInitialText(file: string, size: number): Promise<string> {
  if (size <= MAX_INITIAL_BYTES) {
    return await fs.readFile(file, "utf8");
  }

  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(MAX_INITIAL_BYTES);
    await handle.read(buffer, 0, MAX_INITIAL_BYTES, size - MAX_INITIAL_BYTES);
    const text = buffer.toString("utf8");
    const firstBreak = text.indexOf("\n");
    return firstBreak >= 0 ? text.slice(firstBreak + 1) : text;
  } finally {
    await handle.close();
  }
}

async function readFirstLine(file: string): Promise<string> {
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, result.bytesRead).toString("utf8");
    return text.split(/\r?\n/, 1)[0] ?? "";
  } finally {
    await handle.close();
  }
}

function mapEventMessage(payload: Record<string, unknown>, at: string): RolloutMappedEvent | null {
  const type = stringValue(payload.type);
  if (type === "agent_message") {
    const text = compactText(stringValue(payload.message) ?? "");
    if (!text || isInternalText(text)) {
      return null;
    }
    return {
      context: {
        source: "rollout",
        kind: "agent-message",
        title: "Codex message",
        summary: text,
        at,
      },
      present: { type: "subtitle", text },
    };
  }

  if (type === "task_started") {
    return {
      context: {
        source: "rollout",
        kind: "turn-started",
        title: "Codex started working",
        summary: "Codex started a new turn.",
        at,
      },
      present: { type: "subtitle", text: "Codex started working." },
    };
  }

  return null;
}

function mapResponseItem(payload: Record<string, unknown>, at: string, state: RolloutParserState): RolloutMappedEvent | null {
  const type = stringValue(payload.type);
  if (type === "function_call") {
    return mapFunctionCall(payload, at, state);
  }
  if (type === "function_call_output") {
    return mapFunctionOutput(payload, at, state);
  }
  if (type === "message") {
    const text = compactText(outputText(payload));
    if (!text || isInternalText(text)) {
      return null;
    }
    return {
      context: {
        source: "rollout",
        kind: "assistant-message",
        title: "Codex answered",
        summary: text,
        at,
      },
      present: { type: "subtitle", text },
    };
  }
  return null;
}

function mapFunctionCall(payload: Record<string, unknown>, at: string, state: RolloutParserState): RolloutMappedEvent | null {
  const name = stringValue(payload.name) ?? "tool";
  const callId = stringValue(payload.call_id) ?? stringValue(payload.id);
  const args = parseJsonObject(stringValue(payload.arguments) ?? "");

  if (name === "update_plan") {
    const plan = arrayValue(args.plan).map(normalizePlanStep).filter((step): step is PresentPlanStep => step !== null);
    if (plan.length === 0) {
      return null;
    }
    return {
      context: {
        source: "rollout",
        kind: "plan",
        title: "Plan updated",
        summary: summarizePlan(plan),
        at,
      },
      present: {
        type: "plan",
        steps: plan,
        explanation: stringValue(args.explanation) ?? null,
      },
    };
  }

  const command = displayToolCall(name, args);
  if (callId) {
    state.calls.set(callId, { name, command });
  }

  return {
    context: {
      source: "rollout",
      kind: name === "exec_command" ? "command-started" : "tool-started",
      title: name === "exec_command" ? "Command started" : `Tool started: ${name}`,
      summary: command,
      command: name === "exec_command" ? command : undefined,
      toolName: name,
      status: "running",
      at,
    },
    present: { type: "command", command, status: "running" },
  };
}

function mapFunctionOutput(payload: Record<string, unknown>, at: string, state: RolloutParserState): RolloutMappedEvent | null {
  const callId = stringValue(payload.call_id);
  const call = callId ? state.calls.get(callId) : undefined;
  if (!call) {
    return null;
  }

  const output = stringValue(payload.output) ?? "";
  const exitCode = inferExitCode(output);
  const failed = exitCode !== null && exitCode !== 0;
  return {
    context: {
      source: "rollout",
      kind: call.name === "exec_command" ? "command-completed" : "tool-completed",
      title: failed ? "Command failed" : "Tool completed",
      summary: failed ? `${call.command} failed with exit code ${exitCode}.` : `${call.command} completed.`,
      command: call.name === "exec_command" ? call.command : undefined,
      toolName: call.name,
      status: failed ? "failed" : "ok",
      at,
    },
    present: {
      type: "command",
      command: call.command,
      status: failed ? "failed" : "passed",
      exitCode,
    },
  };
}

function displayToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "exec_command") {
    return stringValue(args.cmd) ?? stringValue(args.command) ?? "terminal command";
  }
  if (name === "apply_patch") {
    return "apply_patch";
  }
  if (name === "view_image") {
    return `view_image ${stringValue(args.path) ?? ""}`.trim();
  }
  return name.replace(/^functions\./, "");
}

function outputText(payload: Record<string, unknown>): string {
  const output = arrayValue(payload.content).concat(arrayValue(payload.output));
  const parts: string[] = [];
  for (const itemValue of output) {
    const item = asRecord(itemValue);
    const text = stringValue(item.text);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join(" ");
}

function inferExitCode(output: string): number | null {
  const match = output.match(/(?:Process exited with code|exit code)\s+(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizePlanStep(value: unknown): PresentPlanStep | null {
  const record = asRecord(value);
  const step = stringValue(record.step);
  const status = stringValue(record.status);
  if (!step || (status !== "pending" && status !== "in_progress" && status !== "completed")) {
    return null;
  }
  return { step, status };
}

function summarizePlan(plan: PresentPlanStep[]): string {
  const active = plan.find((step) => step.status === "in_progress");
  return active ? `Working on: ${active.step}` : plan.map((step) => step.step).join("; ");
}

function parseJsonObject(text: string): Record<string, unknown> {
  if (!text) {
    return {};
  }
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return {};
  }
}

function compactText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TEXT_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TEXT_LENGTH - 1).trim()}...`;
}

function isInternalText(text: string): boolean {
  return (
    text.startsWith("<permissions instructions>") ||
    text.startsWith("<environment_context>") ||
    text.startsWith("<developer_context>") ||
    text.startsWith("<app-context>") ||
    text.startsWith("<skills_instructions>") ||
    text.startsWith("<plugins_instructions>") ||
    text.startsWith("Capabilities from the `")
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
