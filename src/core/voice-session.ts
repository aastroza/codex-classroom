import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "node:http";

import { pathExists } from "./fs.js";
import { voiceContextDir } from "./voice-context.js";

const MAX_BODY_BYTES = 64 * 1024;

export interface VoiceSessionFile {
  schemaVersion: 1;
  url: string;
  token: string;
  startedAt: string;
}

export function createVoiceToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function voiceSessionPath(classroomRoot: string): string {
  return path.join(voiceContextDir(classroomRoot), "session.json");
}

export async function writeVoiceSession(classroomRoot: string, session: VoiceSessionFile): Promise<void> {
  await fs.mkdir(path.dirname(voiceSessionPath(classroomRoot)), { recursive: true });
  await fs.writeFile(voiceSessionPath(classroomRoot), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export async function readVoiceSession(classroomRoot: string): Promise<VoiceSessionFile | null> {
  const file = voiceSessionPath(classroomRoot);
  if (!(await pathExists(file))) {
    return null;
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<VoiceSessionFile>;
  if (parsed.schemaVersion !== 1 || !parsed.token || !parsed.url || !parsed.startedAt) {
    return null;
  }
  return parsed as VoiceSessionFile;
}

export function validateLocalRequest(request: IncomingMessage, host: string, port: number): string | null {
  const expected = new Set([
    `${host}:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  const requestHost = request.headers.host;
  if (typeof requestHost === "string" && !expected.has(requestHost)) {
    return "Forbidden host.";
  }

  const origin = request.headers.origin;
  if (typeof origin === "string") {
    try {
      const parsed = new URL(origin);
      if (!expected.has(parsed.host)) {
        return "Forbidden origin.";
      }
    } catch {
      return "Forbidden origin.";
    }
  }

  return null;
}

export function validateVoiceToken(request: IncomingMessage, expectedToken: string): string | null {
  const actual = request.headers["x-voice-token"];
  if (actual !== expectedToken) {
    return "Invalid voice token.";
  }
  return null;
}

export async function readLimitedText(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
