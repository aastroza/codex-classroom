import fs from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./fs.js";

export type VoiceContextSource = "cue" | "hook" | "manual";

export interface VoiceContextEvent {
  schemaVersion: 1;
  id: string;
  at: string;
  source: VoiceContextSource;
  kind: string;
  title: string;
  summary: string;
  cwd?: string;
  toolName?: string;
  command?: string;
  status?: string;
}

export interface VoiceContextInput {
  source: VoiceContextSource;
  kind: string;
  title: string;
  summary: string;
  at?: string;
  cwd?: string;
  toolName?: string;
  command?: string;
  status?: string;
}

export interface HookContextInput {
  eventName: string;
  payload?: unknown;
  cwd?: string;
}

const MAX_TEXT_LENGTH = 900;
const MAX_COMMAND_LENGTH = 260;
const MAX_EVENTS = 400;

export function voiceContextDir(classroomRoot: string): string {
  return path.join(classroomRoot, "voice");
}

export function voiceContextPath(classroomRoot: string): string {
  return path.join(voiceContextDir(classroomRoot), "events.jsonl");
}

export async function appendVoiceContextEvent(
  classroomRoot: string,
  input: VoiceContextInput,
): Promise<VoiceContextEvent> {
  const event: VoiceContextEvent = {
    schemaVersion: 1,
    id: createEventId(),
    at: input.at ?? new Date().toISOString(),
    source: input.source,
    kind: input.kind,
    title: truncateText(redactSecrets(input.title), 160),
    summary: truncateText(redactSecrets(input.summary), MAX_TEXT_LENGTH),
    cwd: input.cwd ? truncateText(redactSecrets(input.cwd), 260) : undefined,
    toolName: input.toolName ? truncateText(redactSecrets(input.toolName), 120) : undefined,
    command: input.command ? truncateText(redactSecrets(input.command), MAX_COMMAND_LENGTH) : undefined,
    status: input.status ? truncateText(redactSecrets(input.status), 80) : undefined,
  };

  await fs.mkdir(voiceContextDir(classroomRoot), { recursive: true });
  await fs.appendFile(voiceContextPath(classroomRoot), `${JSON.stringify(event)}\n`, "utf8");
  await trimVoiceContext(classroomRoot);
  return event;
}

export async function readVoiceContextEvents(classroomRoot: string, limit = 40): Promise<VoiceContextEvent[]> {
  const file = voiceContextPath(classroomRoot);
  if (!(await pathExists(file))) {
    return [];
  }

  const lines = (await fs.readFile(file, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const selected = lines.slice(Math.max(0, lines.length - limit));
  const events: VoiceContextEvent[] = [];
  for (const line of selected) {
    try {
      const parsed = JSON.parse(line) as VoiceContextEvent;
      if (parsed.schemaVersion === 1 && parsed.id && parsed.at) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed rows; a classroom sidecar should not fail on one bad line.
    }
  }
  return events;
}

export function buildThreadBrief(events: VoiceContextEvent[], limit = 12): string {
  const recent = events.slice(Math.max(0, events.length - limit));
  if (recent.length === 0) {
    return "No thread context has been recorded yet.";
  }

  return recent
    .map((event) => {
      const parts = [
        event.at,
        event.kind,
        event.title,
        event.summary,
        event.toolName ? `tool=${event.toolName}` : "",
        event.status ? `status=${event.status}` : "",
      ].filter(Boolean);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");
}

export function normalizeHookContext(input: HookContextInput): VoiceContextInput {
  const payload = asRecord(input.payload);
  const cwd = firstString(payload, ["cwd", "current_working_directory"]) ?? input.cwd;
  const toolName = firstString(payload, ["tool_name", "toolName", "tool"]);
  const toolInput = asRecord(payload.tool_input ?? payload.toolInput ?? payload.input);
  const toolResponse = asRecord(payload.tool_response ?? payload.toolResponse ?? payload.response);
  const command = firstString(toolInput, ["command", "cmd"]);
  const prompt = firstString(payload, ["prompt", "user_prompt", "userPrompt", "message"]);
  const status = inferStatus(payload, toolResponse);

  if (input.eventName === "UserPromptSubmit") {
    return {
      source: "hook",
      kind: "user-prompt",
      title: "User submitted a prompt",
      summary: prompt ? `Prompt: ${prompt}` : "A new user prompt started a turn.",
      cwd,
      status,
    };
  }

  if (input.eventName === "PostToolUse") {
    return {
      source: "hook",
      kind: "tool-result",
      title: toolName ? `Tool finished: ${toolName}` : "Tool finished",
      summary: summarizeToolResult(toolResponse, payload),
      cwd,
      toolName,
      command,
      status,
    };
  }

  if (input.eventName === "Stop") {
    return {
      source: "hook",
      kind: "turn-complete",
      title: "Turn completed",
      summary: "Codex finished the current response and is ready for the next instruction.",
      cwd,
      status,
    };
  }

  return {
    source: "hook",
    kind: input.eventName,
    title: `${input.eventName} hook`,
    summary: summarizePayload(payload),
    cwd,
    toolName,
    command,
    status,
  };
}

export async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseHookPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
}

function summarizeToolResult(toolResponse: Record<string, unknown>, payload: Record<string, unknown>): string {
  const stderr = firstString(toolResponse, ["stderr", "error", "errorMessage"]);
  const stdout = firstString(toolResponse, ["stdout", "output", "text"]);
  const message = firstString(payload, ["message", "summary"]);
  const exitCode = firstNumber(toolResponse, ["exit_code", "exitCode", "code"]);

  if (stderr) {
    return exitCode === undefined
      ? `Tool reported: ${stderr}`
      : `Tool exited with code ${exitCode}: ${stderr}`;
  }

  if (stdout) {
    return `Tool output: ${stdout}`;
  }

  if (message) {
    return message;
  }

  return exitCode === undefined ? "Tool finished." : `Tool finished with exit code ${exitCode}.`;
}

function summarizePayload(payload: Record<string, unknown>): string {
  const summary = firstString(payload, ["summary", "message", "text"]);
  if (summary) {
    return summary;
  }

  const keys = Object.keys(payload);
  return keys.length === 0 ? "Hook ran without a JSON payload." : `Hook payload keys: ${keys.slice(0, 8).join(", ")}.`;
}

function inferStatus(payload: Record<string, unknown>, toolResponse: Record<string, unknown>): string | undefined {
  const explicit = firstString(payload, ["status", "state"]);
  if (explicit) {
    return explicit;
  }

  const exitCode = firstNumber(toolResponse, ["exit_code", "exitCode", "code"]);
  if (exitCode === undefined) {
    return undefined;
  }
  return exitCode === 0 ? "ok" : "failed";
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return truncateText(redactSecrets(value.trim()), MAX_TEXT_LENGTH);
    }
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-api-key]")
    .replace(/(api[_-]?key|token|password|secret)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function createEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function trimVoiceContext(classroomRoot: string): Promise<void> {
  const file = voiceContextPath(classroomRoot);
  const text = await fs.readFile(file, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= MAX_EVENTS) {
    return;
  }
  await fs.writeFile(file, `${lines.slice(lines.length - MAX_EVENTS).join("\n")}\n`, "utf8");
}
