export const DEFAULT_NARRATOR_HOST = "127.0.0.1";
export const DEFAULT_NARRATOR_PORT = 17321;
export const DEFAULT_NARRATOR_MODEL = "gpt-realtime-2.1-mini";
export const DEFAULT_NARRATOR_VOICE = "marin";
export const DEFAULT_NARRATOR_LANGUAGE = "Spanish";
export const DEFAULT_NARRATOR_API_KEY_ENV = "OPENAI_API_KEY";

export type NarratorCueKind =
  | "note"
  | "started"
  | "changed"
  | "blocked"
  | "verified"
  | "pause"
  | "resume";

export interface NarratorCue {
  kind: NarratorCueKind;
  text: string;
  at: string;
}

export interface NarratorSessionOptions {
  model: string;
  voice: string;
  language: string;
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_NARRATOR_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }

  return port;
}

export function parseCueKind(value: string | undefined): NarratorCueKind {
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

export function buildNarratorInstructions(language: string): string {
  return `# Role and Objective
You are a live classroom narrator for a Codex demonstration.
Help students follow important Codex activity while the teacher remains in control.

# Language
Speak in ${language}.

# Classroom Rules
- Speak only when a cue from the local classroom tool asks you to narrate, or when the teacher directly asks you to comment.
- Keep narrated updates to one short sentence.
- Prefer concrete teaching signals: what Codex is trying, what changed, what failed, what was verified, or what students should inspect.
- Do not read raw logs, secrets, credentials, private paths, or long command output.
- If the teacher is speaking, wait until there is a natural pause.
- If the teacher asks you to stop, pause narration until they ask you to resume.
- Do not explain your private reasoning. Describe observable work only.

# Pacing
Use a calm, concise voice. Avoid filler and repeated openings.`;
}

export function buildRealtimeSessionConfig(options: NarratorSessionOptions): Record<string, unknown> {
  return {
    type: "realtime",
    model: options.model,
    instructions: buildNarratorInstructions(options.language),
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

export function buildCuePrompt(cue: NarratorCue): string {
  if (cue.kind === "pause") {
    return "Pause classroom narration now. Stay silent until a resume cue or teacher request.";
  }

  if (cue.kind === "resume") {
    return "Resume classroom narration. Say one brief sentence that you are ready to continue.";
  }

  const labels: Record<Exclude<NarratorCueKind, "pause" | "resume">, string> = {
    note: "Classroom note",
    started: "Codex started work",
    changed: "Codex changed something",
    blocked: "Codex hit a blocker",
    verified: "Codex verified the result",
  };

  return `${labels[cue.kind]}: ${cue.text}

Say one short classroom-friendly sentence about this. If the teacher appears to be speaking, wait for a natural pause.`;
}
