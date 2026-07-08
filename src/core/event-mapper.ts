import type { VoiceCue } from "./voice.js";
import type { VoiceContextInput } from "./voice-context.js";
import type { ClassroomMoment, Phase, RawMappedEvent } from "./classroom.js";

export interface PresentPlanStep {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

export type PresentEvent =
  | { type: "plan"; steps: PresentPlanStep[]; explanation?: string | null }
  | { type: "command"; command: string; status: "running" | "passed" | "failed"; exitCode?: number | null }
  | { type: "diff"; filesChanged: number; additions?: number; deletions?: number }
  | { type: "subtitle"; text: string };

export interface MappedAppServerEvent {
  context?: VoiceContextInput;
  cue?: VoiceCue;
  present?: PresentEvent;
  raw?: RawMappedEvent;
  moment?: ClassroomMoment;
}

export function mapThreadSnapshot(snapshot: unknown): PresentEvent[] {
  const turns = extractTurns(snapshot).sort((a, b) => (numberValue(a.startedAt) ?? 0) - (numberValue(b.startedAt) ?? 0));
  const events: PresentEvent[] = [];
  let lastPlan: PresentEvent | null = null;
  let lastCommand: PresentEvent | null = null;
  let lastDiff: PresentEvent | null = null;
  let lastSubtitle: PresentEvent | null = null;

  for (const turn of turns) {
    const turnStatus = stringValue(turn.status) ?? "completed";
    for (const itemValue of arrayValue(turn.items)) {
      const item = asRecord(itemValue);
      if (item.type === "plan") {
        const steps = planTextToSteps(stringValue(item.text) ?? "", turnStatus);
        if (steps.length > 0) {
          lastPlan = { type: "plan", steps, explanation: null };
        }
      }

      if (item.type === "commandExecution") {
        lastCommand = commandItemToPresent(item);
      }

      if (item.type === "fileChange") {
        const changes = arrayValue(item.changes);
        if (changes.length > 0) {
          lastDiff = { type: "diff", filesChanged: changes.length };
        }
      }

      if (item.type === "agentMessage") {
        const text = compactText(stringValue(item.text) ?? "");
        if (text) {
          lastSubtitle = { type: "subtitle", text };
        }
      }
    }
  }

  if (lastPlan) events.push(lastPlan);
  if (lastCommand) events.push(lastCommand);
  if (lastDiff) events.push(lastDiff);
  if (lastSubtitle) events.push(lastSubtitle);
  return events;
}

export function mapAppServerEvent(notification: unknown, now = new Date()): MappedAppServerEvent | null {
  const record = asRecord(notification);
  const method = stringValue(record.method);
  const params = asRecord(record.params);
  const at = now.toISOString();

  if (method === "turn/plan/updated") {
    const plan = arrayValue(params.plan).map(normalizePlanStep).filter((step): step is PresentPlanStep => step !== null);
    const activeStep = plan.find((step) => step.status === "in_progress");
    const phases = plan.map(planStepToPhase);
    return {
      context: {
        source: "app-server",
        kind: "plan",
        title: activeStep ? "Plan step in progress" : "Plan updated",
        summary: activeStep ? activeStep.step : summarizePlan(plan),
        at,
        status: activeStep?.status,
      },
      cue: activeStep
        ? {
            kind: "method",
            text: `I am now working on: ${activeStep.step}`,
            at,
          }
        : undefined,
      present: {
        type: "plan",
        steps: plan,
        explanation: stringValue(params.explanation) ?? null,
      },
      raw: phases.length > 0 ? { kind: "plan", phases, at } : undefined,
    };
  }

  if (method === "turn/started") {
    return {
      context: {
        source: "app-server",
        kind: "turn-started",
        title: "Turn started",
        summary: "Codex started working on a turn.",
        at,
        status: "running",
      },
      raw: { kind: "assistant-message", text: "Codex started working.", at },
    };
  }

  if (method === "item/started") {
    const item = asRecord(params.item);
    if (item.type === "commandExecution") {
      const command = stringValue(item.command) ?? "command";
      return {
        context: {
          source: "app-server",
          kind: "command-started",
          title: "Command started",
          summary: command,
          command,
          at,
          status: "running",
        },
        present: { type: "command", command, status: "running" },
        raw: { kind: "command-started", command, toolName: "commandExecution", at },
      };
    }
    if (item.type === "agentMessage") {
      const text = compactText(stringValue(item.text) ?? "");
      return text ? {
        context: {
          source: "app-server",
          kind: "agent-message",
          title: "Agent message",
          summary: text,
          at,
        },
        raw: { kind: "agent-message", text, at },
      } : null;
    }
  }

  if (method === "item/completed") {
    const item = asRecord(params.item);
    if (item.type === "commandExecution") {
      const command = stringValue(item.command) ?? "command";
      const status = commandStatus(item);
      const exitCode = numberValue(item.exitCode);
      const failed = status === "failed";
      const summary = failed ? `Command failed with exit code ${exitCode}: ${command}` : `Command passed: ${command}`;
      return {
        context: {
          source: "app-server",
          kind: "command-completed",
          title: failed ? "Command failed" : "Command passed",
          summary,
          command,
          at,
          status: failed ? "failed" : "ok",
        },
        cue: {
          kind: failed ? "risk" : "wrap",
          text: failed ? `The command failed with exit code ${exitCode}: ${command}` : `The command passed: ${command}`,
          at,
        },
        present: {
          type: "command",
          command,
          status: failed ? "failed" : "passed",
          exitCode,
        },
        raw: { kind: "command-completed", command, toolName: "commandExecution", exitCode, at },
      };
    }

    if (item.type === "fileChange") {
      const changes = arrayValue(item.changes);
      return {
        context: {
          source: "app-server",
          kind: "file-change",
          title: "Files changed",
          summary: `${changes.length} file change(s) recorded.`,
          at,
          status: stringValue(item.status),
        },
        raw: { kind: "file-change", filesChanged: changes.length, at },
      };
    }

    if (item.type === "agentMessage") {
      const text = compactText(stringValue(item.text) ?? "");
      return text ? {
        context: {
          source: "app-server",
          kind: "agent-message",
          title: "Agent message",
          summary: text,
          at,
        },
        present: { type: "subtitle", text },
        raw: { kind: "agent-message", text, at },
      } : null;
    }
  }

  if (method === "turn/diff/updated") {
    const diff = stringValue(params.diff) ?? "";
    const stats = summarizeDiff(diff);
    return {
      context: {
        source: "app-server",
        kind: "diff-updated",
        title: "Diff updated",
        summary: `${stats.filesChanged} file(s), +${stats.additions}/-${stats.deletions}.`,
        at,
      },
      present: { type: "diff", ...stats },
      raw: { kind: "file-change", filesChanged: stats.filesChanged, at },
    };
  }

  if (method === "turn/completed") {
    const turn = asRecord(params.turn);
    const status = stringValue(turn.status) ?? "completed";
    return {
      context: {
        source: "app-server",
        kind: "turn-completed",
        title: "Turn completed",
        summary: `Codex turn completed with status ${status}.`,
        at,
        status,
      },
      cue: {
        kind: status === "failed" ? "risk" : "wrap",
        text: status === "failed" ? "The turn ended with a failure." : "The turn is complete.",
        at,
      },
      present: {
        type: "subtitle",
        text: status === "failed" ? "Turn ended with a failure." : "Turn complete.",
      },
      raw: { kind: "task-complete", at },
    };
  }

  if (method === "model/safetyBuffering/updated" || method === "model/rerouted" || method === "model/verification") {
    const reason = stringValue(params.reason) ?? stringValue(params.model) ?? method;
    return {
      context: {
        source: "app-server",
        kind: method,
        title: "Model status",
        summary: reason,
        at,
        status: "running",
      },
      raw: { kind: "dynamic-tool", toolName: method, status: "running", at },
    };
  }

  return null;
}

function extractTurns(snapshot: unknown): Record<string, unknown>[] {
  const root = asRecord(snapshot);
  const thread = asRecord(root.thread);
  const initialTurnsPage = asRecord(root.initialTurnsPage);
  const turns = arrayValue(thread.turns);
  const pageTurns = arrayValue(initialTurnsPage.data);
  return [...turns, ...pageTurns].map(asRecord).filter((turn) => arrayValue(turn.items).length > 0);
}

function planTextToSteps(text: string, turnStatus: string): PresentPlanStep[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((step, index, steps) => ({
      step,
      status: turnStatus === "inProgress" && index === steps.length - 1 ? "in_progress" : "completed",
    }));
}

function commandItemToPresent(item: Record<string, unknown>): PresentEvent {
  const command = stringValue(item.command) ?? "command";
  const status = commandStatus(item);
  const exitCode = numberValue(item.exitCode);
  return {
    type: "command",
    command,
    status: status === "running" ? "running" : status === "failed" ? "failed" : "passed",
    exitCode,
  };
}

function commandStatus(item: Record<string, unknown>): "running" | "passed" | "failed" {
  const status = stringValue(item.status);
  const exitCode = numberValue(item.exitCode);
  if (status === "inProgress") {
    return "running";
  }
  if (status === "failed" || status === "declined" || (exitCode !== null && exitCode !== 0)) {
    return "failed";
  }
  return "passed";
}

function compactText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) {
    return normalized;
  }
  return `${normalized.slice(0, 217).trim()}...`;
}

function normalizePlanStep(value: unknown): PresentPlanStep | null {
  const record = asRecord(value);
  const step = stringValue(record.step);
  const status = stringValue(record.status);
  if (!step || (status !== "pending" && status !== "in_progress" && status !== "inProgress" && status !== "completed")) {
    return null;
  }
  return { step, status: status === "inProgress" ? "in_progress" : status };
}

function planStepToPhase(step: PresentPlanStep): Phase {
  return {
    id: step.step.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step",
    label: step.step,
    status: step.status === "completed" ? "done" : step.status === "in_progress" ? "active" : "pending",
  };
}

function summarizePlan(plan: PresentPlanStep[]): string {
  if (plan.length === 0) {
    return "Plan updated.";
  }
  return plan.map((step) => `${step.status}: ${step.step}`).join("; ");
}

function summarizeDiff(diff: string): { filesChanged: number; additions: number; deletions: number } {
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      files.add(line);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { filesChanged: files.size, additions, deletions };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
