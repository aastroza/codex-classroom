import fs from "node:fs/promises";
import path from "node:path";

import { pathExists } from "./fs.js";

export type VoiceContextSource = "cue" | "manual" | "app-server" | "rollout";

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
