import type { ClassroomMoment } from "./classroom.js";
import type { VoiceCue, VoiceCueKind } from "./voice.js";

export interface AutoNarrationState {
  lastExplicitCueAt: number;
  lastSpokenText?: string;
  paused: boolean;
  autoNarrate: boolean;
}

export interface AutoNarrationDecision {
  cue?: VoiceCue;
  dropped: boolean;
}

export function maybeAutoNarrateMoment(
  moment: ClassroomMoment,
  state: AutoNarrationState,
  nowMs: number,
  isDuplicate: (a: string, b: string) => boolean,
): AutoNarrationDecision {
  if (!state.autoNarrate || state.paused || !moment.speakable || nowMs - state.lastExplicitCueAt <= 45_000) {
    return { dropped: false };
  }
  if (state.lastSpokenText && isDuplicate(state.lastSpokenText, moment.detail)) {
    return { dropped: true };
  }
  return {
    dropped: false,
    cue: {
      kind: momentTypeToCueKind(moment.type),
      text: moment.detail,
      at: new Date(nowMs).toISOString(),
      source: "auto",
    },
  };
}

export const CLASSROOM_TEMPLATES = {
  es: {
    method: "Estoy comparando varias fuentes porque la información reciente puede cambiar; una sola fuente no basta.",
    wrap: "La respuesta está lista para revisar con la clase.",
  },
  en: {
    method: "I am comparing several sources because recent information can change; one source is not enough.",
    wrap: "The answer is ready to review with the class.",
  },
} as const;

function momentTypeToCueKind(type: ClassroomMoment["type"]): VoiceCueKind {
  if (type === "tool") {
    return "evidence";
  }
  return type;
}
