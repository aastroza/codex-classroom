export const DEFAULT_VOICE_HOST = "127.0.0.1";
export const DEFAULT_VOICE_PORT = 17321;
export const DEFAULT_VOICE_MODEL = "gpt-realtime-2.1-mini";
export const DEFAULT_VOICE_NAME = "marin";
export const DEFAULT_VOICE_LANGUAGE = "Spanish";
export const DEFAULT_VOICE_API_KEY_ENV = "OPENAI_API_KEY";

export type VoiceCueKind =
  | "note"
  | "started"
  | "changed"
  | "blocked"
  | "verified"
  | "pause"
  | "resume";

export interface VoiceCue {
  kind: VoiceCueKind;
  text: string;
  at: string;
}

export interface VoiceSessionOptions {
  model: string;
  voice: string;
  language: string;
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_VOICE_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }

  return port;
}

export function parseCueKind(value: string | undefined): VoiceCueKind {
  if (value === undefined) {
    return "note";
  }

  if (
    value === "note" ||
    value === "started" ||
    value === "changed" ||
    value === "blocked" ||
    value === "verified" ||
    value === "pause" ||
    value === "resume"
  ) {
    return value;
  }

  throw new Error("--kind must be note, started, changed, blocked, verified, pause, or resume.");
}

export function buildVoiceInstructions(language: string): string {
  return `# Role and Objective
You are Codex speaking as yourself during a live classroom demonstration.
You are a voice companion for the teacher: explain your observable work, answer short spoken questions, and help students follow the demo without taking over the class.

# Language
Speak in ${language}.

# Classroom Rules
- Speak in first person as Codex: "Estoy revisando...", "Encontre...", "Voy a verificar...".
- When a cue from the local classroom tool arrives, turn it into one short first-person classroom comment.
- When the teacher asks a question, answer naturally and briefly.
- Prefer concrete teaching signals: what you are trying, what changed, what failed, what was verified, or what students should inspect.
- Do not read raw logs, secrets, credentials, private paths, or long command output.
- If the teacher is speaking, wait for a natural pause.
- If the teacher asks you to stop, stay quiet until they ask you to resume.
- Do not explain your private reasoning. Describe observable work only.
- You may be playful, but stay concise and useful for the class.

# Pacing
Use a friendly, concise voice. Avoid filler and repeated openings.`;
}

export function buildRealtimeSessionConfig(options: VoiceSessionOptions): Record<string, unknown> {
  return {
    type: "realtime",
    model: options.model,
    instructions: buildVoiceInstructions(options.language),
    reasoning: {
      effort: "low",
    },
    audio: {
      output: {
        voice: options.voice,
      },
    },
  };
}

export function buildCuePrompt(cue: VoiceCue): string {
  if (cue.kind === "pause") {
    return "Pause your classroom voice now. Stay silent until a resume cue or teacher request.";
  }

  if (cue.kind === "resume") {
    return "Resume your classroom voice. Say one brief first-person sentence that you are ready to continue.";
  }

  const labels: Record<Exclude<VoiceCueKind, "pause" | "resume">, string> = {
    note: "Classroom note",
    started: "Codex started work",
    changed: "Codex changed something",
    blocked: "Codex hit a blocker",
    verified: "Codex verified the result",
  };

  return `${labels[cue.kind]}: ${cue.text}

Say one short first-person classroom-friendly sentence about this. If the teacher appears to be speaking, wait for a natural pause.`;
}
