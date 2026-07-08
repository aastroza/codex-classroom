import { Buffer } from "node:buffer";

export type MomentType = "orientation" | "method" | "tool" | "evidence" | "decision" | "risk" | "wrap";
export type TaskType = "research" | "coding" | "writing" | "generic";
export type Phase = { id: string; label: string; status: "pending" | "active" | "done" };

export interface ClassroomMoment {
  type: MomentType;
  momentId: string;
  title: string;
  detail: string;
  internal?: string;
  speakable: boolean;
  phase: string;
  status?: "running" | "done" | "failed";
  at: string;
  phases?: Phase[];
}

export type PresentEvent =
  | { type: "plan"; steps: Array<{ step: string; status: "pending" | "in_progress" | "completed" }>; explanation?: string | null }
  | { type: "command"; command: string; status: "running" | "passed" | "failed"; exitCode?: number | null }
  | { type: "diff"; filesChanged: number; additions?: number; deletions?: number }
  | { type: "subtitle"; text: string };

export type RawMappedEvent =
  | { kind: "user-prompt"; text: string; at: string }
  | { kind: "web-search-call"; query?: string; at: string }
  | { kind: "web-search-end"; query?: string; at: string }
  | { kind: "command-started"; command: string; toolName?: string; at: string }
  | { kind: "command-completed"; command: string; toolName?: string; exitCode?: number | null; at: string }
  | { kind: "file-change"; filesChanged: number; at: string }
  | { kind: "dynamic-tool"; toolName: string; status: "running" | "done" | "failed"; at: string }
  | { kind: "review"; text: string; status: "running" | "done"; at: string }
  | { kind: "realtime-transcript"; role: string; text: string; at: string }
  | { kind: "agent-message"; text: string; at: string }
  | { kind: "assistant-message"; text: string; at: string }
  | { kind: "task-complete"; at: string }
  | { kind: "plan"; phases: Phase[]; at: string };

export const TASK_KEYWORDS: Record<TaskType, string[]> = {
  research: ["busca", "buscar", "search", "noticias", "news", "investiga", "research"],
  coding: ["arregla", "fix", "test", "bug", "implementa", "implement", "código", "codigo", "code"],
  writing: ["escribe", "redacta", "write", "draft", "artículo", "articulo", "article"],
  generic: [],
};

const PHASES: Record<TaskType, Array<{ id: string; label: string }>> = {
  research: [
    { id: "understanding", label: "Entendiendo la tarea" },
    { id: "gathering", label: "Buscando fuentes" },
    { id: "checking", label: "Comparando fuentes" },
    { id: "producing", label: "Preparando respuesta" },
    { id: "done", label: "Respuesta lista" },
  ],
  coding: [
    { id: "inspecting", label: "Revisando contexto" },
    { id: "editing", label: "Editando solución" },
    { id: "verifying", label: "Verificando cambios" },
    { id: "done", label: "Trabajo listo" },
  ],
  writing: [
    { id: "understanding", label: "Entendiendo la tarea" },
    { id: "working", label: "Desarrollando texto" },
    { id: "producing", label: "Preparando entrega" },
    { id: "done", label: "Respuesta lista" },
  ],
  generic: [
    { id: "understanding", label: "Entendiendo la tarea" },
    { id: "working", label: "Trabajando" },
    { id: "producing", label: "Preparando entrega" },
    { id: "done", label: "Respuesta lista" },
  ],
};

export interface ClassroomMapper {
  ingest(event: RawMappedEvent): ClassroomMoment[];
  phases(): Phase[];
  taskType(): TaskType;
}

interface MapperState {
  taskType: TaskType;
  phases: Phase[];
  inferenceLocked: boolean;
  lastSubtitleDetails: string[];
  toolActivity: boolean;
  completedSearches: number;
  searchBurstId: string | null;
  searchBurstStartMs: number | null;
  searchBurstLastMs: number | null;
  searchBurstCount: number;
  finalCandidate: string | null;
  completed: boolean;
}

export function classifyTask(firstUserPrompt: string): TaskType {
  const text = normalizeText(firstUserPrompt);
  for (const type of ["research", "coding", "writing"] as const) {
    if (TASK_KEYWORDS[type].some((keyword) => text.includes(keyword))) {
      return type;
    }
  }
  return "generic";
}

export function createClassroomMapper(): ClassroomMapper {
  const state: MapperState = {
    taskType: "generic",
    phases: buildPhases("generic"),
    inferenceLocked: false,
    lastSubtitleDetails: [],
    toolActivity: false,
    completedSearches: 0,
    searchBurstId: null,
    searchBurstStartMs: null,
    searchBurstLastMs: null,
    searchBurstCount: 0,
    finalCandidate: null,
    completed: false,
  };

  return {
    ingest(event) {
      return ingestEvent(state, event);
    },
    phases() {
      return clonePhases(state.phases);
    },
    taskType() {
      return state.taskType;
    },
  };
}

export function inferPhase(previous: Phase[], moment: RawMappedEvent): Phase[] {
  const type = previous.some((phase) => phase.id === "gathering")
    ? "research"
    : previous.some((phase) => phase.id === "editing")
      ? "coding"
      : previous.some((phase) => phase.id === "working")
        ? "generic"
        : "research";
  const state: MapperState = {
    taskType: type,
    phases: clonePhases(previous),
    inferenceLocked: false,
    lastSubtitleDetails: [],
    toolActivity: false,
    completedSearches: 0,
    searchBurstId: null,
    searchBurstStartMs: null,
    searchBurstLastMs: null,
    searchBurstCount: 0,
    finalCandidate: null,
    completed: false,
  };
  advancePhase(state, moment);
  return clonePhases(state.phases);
}

export function phasesForTask(type: TaskType): Phase[] {
  return buildPhases(type);
}

export function isDuplicateText(a: string, b: string): boolean {
  const left = bigrams(normalizeForSimilarity(a));
  const right = bigrams(normalizeForSimilarity(b));
  if (left.length === 0 && right.length === 0) {
    return true;
  }
  if (left.length === 0 || right.length === 0) {
    return false;
  }

  const counts = new Map<string, number>();
  for (const value of left) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let overlap = 0;
  for (const value of right) {
    const count = counts.get(value) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(value, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length) > 0.8;
}

export function sanitizePromptForClassroom(text: string): string {
  const repaired = repairTextEncoding(text);
  return truncateSentence(
    stripLocalPaths(stripMarkdownLinks(stripSkillInstructions(repaired)))
      .replace(/\s+/g, " ")
      .trim(),
    140,
  );
}

export function repairTextEncoding(text: string): string {
  if (!/[ÃÂâ]/.test(text)) {
    return text;
  }
  try {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    return repaired.includes("\uFFFD") ? text : repaired;
  } catch {
    return text;
  }
}

export function parseVoiceSayCommand(command: string): { type: MomentType; kind: string; text: string } | null {
  const normalized = unwrapShell(command).trim();
  const match = normalized.match(/^(?:codex-classroom|cxclass)\s+voice\s+say(?:\s+(\S+))?\s+([\s\S]+)$/);
  if (!match) {
    return null;
  }
  const maybeKind = match[1] ?? "evidence";
  const rawText = match[2]?.trim() ?? "";
  const text = repairTextEncoding(unquote(rawText));
  if (!text) {
    return null;
  }
  return { kind: maybeKind, type: cueKindToMomentType(maybeKind), text: stripLocalPaths(text) };
}

function ingestEvent(state: MapperState, event: RawMappedEvent): ClassroomMoment[] {
  event = repairRawMappedEvent(event);
  const moments: ClassroomMoment[] = [];

  if (event.kind === "user-prompt" && state.phases.every((phase) => phase.status === "pending")) {
    state.taskType = classifyTask(event.text);
    state.phases = buildPhases(state.taskType);
  }

  advancePhase(state, event);

  if (event.kind === "plan") {
    state.inferenceLocked = true;
    state.phases = clonePhases(event.phases);
    return [withPhases(state, {
      type: "method",
      momentId: "plan-real",
      title: "Plan de trabajo",
      detail: "Codex preparó un plan explícito para la tarea.",
      speakable: false,
      phase: activePhase(state.phases).id,
      at: event.at,
    })];
  }

  if (event.kind === "user-prompt") {
    const detail = sanitizePromptForClassroom(event.text);
    pushMoment(state, moments, {
      type: "orientation",
      momentId: "orientation-task",
      title: "Tarea de la clase",
      detail,
      internal: stripLocalPaths(stripMarkdownLinks(stripSkillInstructions(event.text))),
      speakable: false,
      phase: activePhase(state.phases).id,
      at: event.at,
    });
  } else if (event.kind === "web-search-call") {
    const burst = updateSearchBurst(state, event.at);
    const title = burst.count <= 1 ? "Consultando fuentes actuales" : `Comparando ${burst.count} fuentes`;
    pushMoment(state, moments, {
      type: "tool",
      momentId: burst.id,
      title,
      detail: truncateSentence(stripLocalPaths(event.query ?? "Buscando información reciente"), 160),
      internal: event.query,
      speakable: false,
      phase: activePhase(state.phases).id,
      status: "running",
      at: event.at,
    }, { allowDuplicateUpdate: true });
  } else if (event.kind === "web-search-end") {
    state.completedSearches += 1;
    touchSearchBurst(state, event.at);
    if (state.completedSearches === 3) {
      pushMoment(state, moments, {
        type: "method",
        momentId: "method-compare-sources",
        title: "Comparando fuentes",
        detail: "Estoy comparando varias fuentes porque la información reciente puede cambiar; una sola fuente no basta.",
        speakable: true,
        phase: activePhase(state.phases).id,
        status: "done",
        at: event.at,
      });
    }
  } else if (event.kind === "command-started") {
    const voiceCue = parseVoiceSayCommand(event.command);
    if (voiceCue) {
      pushMoment(state, moments, {
        type: voiceCue.type,
        momentId: `cue-${hashText(voiceCue.text)}`,
        title: titleForMomentType(voiceCue.type),
        detail: truncateSentence(voiceCue.text, 180),
        speakable: false,
        phase: activePhase(state.phases).id,
        status: "done",
        at: event.at,
      });
    } else if (!isSuppressedCommand(event.command)) {
      pushMoment(state, moments, {
        type: "tool",
        momentId: `tool-${hashText(event.command)}`,
        title: event.toolName === "exec_command" ? "Ejecutando comando" : `Usando ${event.toolName ?? "herramienta"}`,
        detail: truncateSentence(stripLocalPaths(event.command), 160),
        internal: event.command,
        speakable: false,
        phase: activePhase(state.phases).id,
        status: "running",
        at: event.at,
      });
    }
  } else if (event.kind === "command-completed" && !parseVoiceSayCommand(event.command) && !isSuppressedCommand(event.command)) {
    pushMoment(state, moments, {
      type: event.exitCode && event.exitCode !== 0 ? "risk" : "tool",
      momentId: `tool-${hashText(event.command)}`,
      title: event.exitCode && event.exitCode !== 0 ? "Comando falló" : "Comando listo",
      detail: event.exitCode && event.exitCode !== 0
        ? `El comando terminó con código ${event.exitCode}.`
        : "La herramienta terminó sin errores visibles.",
      internal: event.command,
      speakable: Boolean(event.exitCode && event.exitCode !== 0),
      phase: activePhase(state.phases).id,
      status: event.exitCode && event.exitCode !== 0 ? "failed" : "done",
      at: event.at,
    }, { allowDuplicateUpdate: true });
  } else if (event.kind === "file-change") {
    activatePhase(state.phases, state.taskType === "coding" ? "editing" : activePhase(state.phases).id);
    pushMoment(state, moments, {
      type: "evidence",
      momentId: "files-changed",
      title: "Archivos cambiados",
      detail: event.filesChanged === 1 ? "Codex cambió un archivo relevante." : `Codex cambió ${event.filesChanged} archivos relevantes.`,
      speakable: false,
      phase: activePhase(state.phases).id,
      status: "done",
      at: event.at,
    }, { allowDuplicateUpdate: true });
  } else if (event.kind === "dynamic-tool") {
    pushMoment(state, moments, {
      type: event.status === "failed" ? "risk" : "tool",
      momentId: `dynamic-${hashText(event.toolName)}`,
      title: event.status === "failed" ? "Herramienta falló" : "Herramienta externa",
      detail: event.status === "failed" ? `${event.toolName} falló.` : `Codex está usando ${event.toolName}.`,
      speakable: event.status === "failed",
      phase: activePhase(state.phases).id,
      status: event.status,
      at: event.at,
    }, { allowDuplicateUpdate: true });
  } else if (event.kind === "review") {
    pushMoment(state, moments, {
      type: event.status === "running" ? "method" : "wrap",
      momentId: "review",
      title: event.status === "running" ? "Revisando cambios" : "Revisión lista",
      detail: event.status === "running" ? "Codex está revisando el trabajo antes de cerrar." : truncateSentence(stripMarkdown(event.text), 180),
      internal: event.text,
      speakable: event.status === "done",
      phase: activePhase(state.phases).id,
      status: event.status === "running" ? "running" : "done",
      at: event.at,
    }, { allowDuplicateUpdate: true });
  } else if (event.kind === "realtime-transcript" && event.role === "user") {
    pushMoment(state, moments, {
      type: "orientation",
      momentId: `teacher-${hashText(event.text)}`,
      title: "Pregunta del profesor",
      detail: truncateSentence(stripLocalPaths(event.text), 160),
      internal: event.text,
      speakable: false,
      phase: activePhase(state.phases).id,
      at: event.at,
    });
  } else if (event.kind === "agent-message" || event.kind === "assistant-message") {
    if (isLowValueAgentMessage(event.text)) {
      return moments.map((moment) => withPhases(state, moment));
    }
    state.finalCandidate = event.text;
    const detail = truncateSentence(stripLocalPaths(stripMarkdown(event.text)), event.text.length > 300 ? 180 : 160);
    if (state.completed) {
      markAllDone(state.phases);
      pushMoment(state, moments, {
        type: "wrap",
        momentId: "wrap-final",
        title: "Respuesta lista",
        detail: truncateSentence(stripLocalPaths(stripMarkdown(firstSentence(event.text))), 200),
        internal: event.text,
        speakable: true,
        phase: "done",
        status: "done",
        at: event.at,
      });
    } else if (event.text.length > 300 && state.toolActivity) {
      pushMoment(state, moments, {
        type: "wrap",
        momentId: "wrap-draft",
        title: "Preparando respuesta",
        detail,
        internal: event.text,
        speakable: false,
        phase: activePhase(state.phases).id,
        at: event.at,
      });
    } else {
      pushMoment(state, moments, {
        type: "evidence",
        momentId: `message-${hashText(detail)}`,
        title: "Señal para mirar",
        detail,
        internal: event.text,
        speakable: false,
        phase: activePhase(state.phases).id,
        at: event.at,
      });
    }
  } else if (event.kind === "task-complete") {
    state.completed = true;
    markAllDone(state.phases);
    const candidateDetail = truncateSentence(stripLocalPaths(stripMarkdown(firstSentence(state.finalCandidate ?? "La respuesta está lista para revisar."))), 200);
    const detail = state.lastSubtitleDetails.some((previous) => isDuplicateText(previous, candidateDetail))
      ? "La respuesta está lista para revisar con la clase."
      : candidateDetail;
    pushMoment(state, moments, {
      type: "wrap",
      momentId: "wrap-final",
      title: "Respuesta lista",
      detail,
      internal: state.finalCandidate ?? undefined,
      speakable: true,
      phase: "done",
      status: "done",
      at: event.at,
    }, { allowDuplicateUpdate: true });
  }

  return moments.map((moment) => withPhases(state, moment));
}

function advancePhase(state: MapperState, event: RawMappedEvent): void {
  if (state.inferenceLocked) {
    return;
  }
  if (event.kind === "plan") {
    return;
  }
  if (event.kind === "user-prompt") {
    activatePhase(state.phases, firstPhaseId(state.taskType));
  } else if (event.kind === "web-search-call" || isFileReadCommand(event)) {
    state.toolActivity = true;
    activatePhase(state.phases, state.taskType === "research" ? "gathering" : firstPhaseId(state.taskType));
  } else if (event.kind === "web-search-end") {
    state.toolActivity = true;
    if (state.completedSearches + 1 >= 3) {
      activatePhase(state.phases, state.taskType === "research" ? "checking" : "verifying");
    }
  } else if (event.kind === "command-started" || event.kind === "dynamic-tool") {
    state.toolActivity = true;
    const command = event.kind === "command-started" ? event.command : event.toolName;
    if (/test|check|verify|tsc|build/i.test(command)) {
      activatePhase(state.phases, state.taskType === "coding" ? "verifying" : "checking");
    } else if (state.taskType === "coding") {
      activatePhase(state.phases, "inspecting");
    }
  } else if ((event.kind === "agent-message" || event.kind === "assistant-message") && event.text.length > 300 && state.toolActivity) {
    activatePhase(state.phases, "producing");
  } else if (event.kind === "task-complete") {
    state.completed = true;
    markAllDone(state.phases);
  }
}

function repairRawMappedEvent(event: RawMappedEvent): RawMappedEvent {
  switch (event.kind) {
    case "user-prompt":
    case "review":
    case "realtime-transcript":
    case "agent-message":
    case "assistant-message":
      return { ...event, text: repairTextEncoding(event.text) };
    case "web-search-call":
    case "web-search-end":
      return { ...event, query: event.query ? repairTextEncoding(event.query) : event.query };
    case "command-started":
    case "command-completed":
      return { ...event, command: repairTextEncoding(event.command) };
    case "dynamic-tool":
      return { ...event, toolName: repairTextEncoding(event.toolName) };
    case "plan":
      return { ...event, phases: event.phases.map((phase) => ({ ...phase, label: repairTextEncoding(phase.label) })) };
    default:
      return event;
  }
}

function pushMoment(
  state: MapperState,
  moments: ClassroomMoment[],
  moment: ClassroomMoment,
  options: { allowDuplicateUpdate?: boolean } = {},
): void {
  const detail = moment.detail.trim();
  if (!detail) {
    return;
  }
  if (!options.allowDuplicateUpdate && state.lastSubtitleDetails.some((previous) => isDuplicateText(previous, detail))) {
    return;
  }
  state.lastSubtitleDetails.push(detail);
  state.lastSubtitleDetails = state.lastSubtitleDetails.slice(-3);
  moments.push(moment);
}

function withPhases(state: MapperState, moment: ClassroomMoment): ClassroomMoment {
  return { ...moment, phases: clonePhases(state.phases) };
}

function updateSearchBurst(state: MapperState, at: string): { id: string; count: number } {
  const now = Date.parse(at);
  if (!state.searchBurstId || state.searchBurstLastMs === null || now - state.searchBurstLastMs > 30_000) {
    state.searchBurstStartMs = now;
    state.searchBurstId = `search-${Math.floor(now / 30_000)}`;
    state.searchBurstCount = 0;
  }
  state.searchBurstLastMs = now;
  state.searchBurstCount += 1;
  return { id: state.searchBurstId, count: state.searchBurstCount };
}

function touchSearchBurst(state: MapperState, at: string): void {
  const now = Date.parse(at);
  if (Number.isFinite(now)) {
    state.searchBurstLastMs = now;
  }
}

function buildPhases(type: TaskType): Phase[] {
  return PHASES[type].map((phase) => ({ ...phase, status: "pending" }));
}

function activatePhase(phases: Phase[], phaseId: string): void {
  const index = phases.findIndex((phase) => phase.id === phaseId);
  if (index < 0) {
    return;
  }
  const currentIndex = phases.findIndex((phase) => phase.status === "active");
  if (currentIndex > index) {
    return;
  }
  for (let i = 0; i < phases.length; i += 1) {
    phases[i] = {
      ...phases[i],
      status: i < index ? "done" : i === index ? "active" : phases[i].status === "done" ? "done" : "pending",
    };
  }
}

function markAllDone(phases: Phase[]): void {
  for (let i = 0; i < phases.length; i += 1) {
    phases[i] = { ...phases[i], status: "done" };
  }
}

function activePhase(phases: Phase[]): Phase {
  return phases.find((phase) => phase.status === "active") ?? phases.find((phase) => phase.status === "done") ?? phases[0];
}

function firstPhaseId(type: TaskType): string {
  return PHASES[type][0].id;
}

function clonePhases(phases: Phase[]): Phase[] {
  return phases.map((phase) => ({ ...phase }));
}

function isFileReadCommand(event: RawMappedEvent): boolean {
  return event.kind === "command-started" && /(?:Get-Content|cat|sed|rg|type)\b/i.test(event.command);
}

function isSuppressedCommand(command: string): boolean {
  return /codex-classroom voice start\b|Get-Content .*codex-voice.*SKILL\.md/i.test(command);
}

function isLowValueAgentMessage(text: string): boolean {
  return /codex-voice|codex-classroom voice say|sidecar de voz|teaching beats|leer sus instrucciones|pediste explicitamente|pediste explícitamente|skill indica/i.test(text);
}

function cueKindToMomentType(kind: string): MomentType {
  if (kind === "orientation") return "orientation";
  if (kind === "method" || kind === "started") return "method";
  if (kind === "decision") return "decision";
  if (kind === "risk" || kind === "blocked") return "risk";
  if (kind === "wrap" || kind === "verified") return "wrap";
  return "evidence";
}

function titleForMomentType(type: MomentType): string {
  const titles: Record<MomentType, string> = {
    orientation: "Tarea de la clase",
    method: "Método de trabajo",
    tool: "Herramienta en uso",
    evidence: "Evidencia encontrada",
    decision: "Decisión tomada",
    risk: "Riesgo o bloqueo",
    wrap: "Respuesta lista",
  };
  return titles[type];
}

function unwrapShell(command: string): string {
  return command.replace(/^powershell(?:\.exe)?\s+-Command\s+/i, "").replace(/^cmd(?:\.exe)?\s+\/c\s+/i, "").trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').trim();
  }
  return trimmed.replace(/\\"/g, '"').trim();
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
}

function stripSkillInstructions(text: string): string {
  return text
    .replace(/\[\$[^\]]+\]\([^)]*\)/g, "")
    .replace(/usa\s+\$?codex-voice[^.]*\.?/gi, "");
}

function stripMarkdown(text: string): string {
  return stripMarkdownLinks(text)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function stripLocalPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\\\?[^\s)\]"']+/g, "[local path]")
    .replace(/\/home\/[^\s)\]"']+/g, "[local path]");
}

function firstSentence(text: string): string {
  return text.split(/\. |\n/)[0]?.trim() || text.trim();
}

function truncateSentence(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function normalizeText(text: string): string {
  return repairTextEncoding(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeForSimilarity(text: string): string {
  return normalizeText(stripMarkdown(text))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): string[] {
  if (text.length < 2) {
    return text ? [text] : [];
  }
  const grams: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    grams.push(text.slice(i, i + 2));
  }
  return grams;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
