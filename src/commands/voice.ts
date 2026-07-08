import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandContext } from "../types.js";
import { AppServerClient, checkAppServerAvailable } from "../core/app-server-client.js";
import { isDuplicateText, type ClassroomMoment } from "../core/classroom.js";
import { maybeAutoNarrateMoment } from "../core/classroom-templates.js";
import { CliError } from "../core/errors.js";
import { mapThreadSnapshot, type MappedAppServerEvent, type PresentEvent } from "../core/event-mapper.js";
import { pathExists } from "../core/fs.js";
import { mapRolloutText, RolloutWatcher, type RolloutMappedEvent } from "../core/rollout-watcher.js";
import {
  appendVoiceContextEvent,
  buildThreadBrief,
  normalizeHookContext,
  parseHookPayload,
  readStdinText,
  readVoiceContextEvents,
  type VoiceContextEvent,
} from "../core/voice-context.js";
import {
  createVoiceToken,
  readLimitedText,
  readVoiceSession,
  validateLocalRequest,
  validateVoiceToken,
  writeVoiceSession,
} from "../core/voice-session.js";
import {
  DEFAULT_VOICE_API_KEY_ENV,
  DEFAULT_VOICE_HOST,
  DEFAULT_VOICE_LANGUAGE,
  DEFAULT_VOICE_MODEL,
  DEFAULT_VOICE_NAME,
  type VoiceCue,
  buildRealtimeSessionConfig,
  parseCueKind,
  parsePort,
} from "../core/voice.js";

interface VoiceOptions {
  host: string;
  port: number;
  model: string;
  voice: string;
  language: string;
  apiKeyEnv: string;
  safetyIdentifier?: string;
  open: boolean;
  contextSource: "app-server" | "hooks" | "both";
  replayFile?: string;
  autoNarrate: boolean;
}

interface VoiceServerState {
  options: VoiceOptions;
  classroomRoot: string;
  apiKey?: string;
  token: string;
  clients: Set<ServerResponse>;
  cueHistory: VoiceCue[];
  contextHistory: VoiceContextEvent[];
  presentHistory: PresentEvent[];
  momentHistory: ClassroomMoment[];
  appServer: AppServerClient | null;
  rolloutWatcher: RolloutWatcher | null;
  paused: boolean;
  lastExplicitCueAt: number;
  lastSpokenCueText?: string;
  appServerThreadProbeDisabled: boolean;
  loggedAppServerThreadProbeError: boolean;
}

const CODEX_VOICE_SKILL_NAME = "codex-voice";
const CODEX_VOICE_HOOK_STATUS = "Speaking Codex Voice turn status";
const CODEX_VOICE_HOOK_COMMAND = "codex-classroom voice hook-stop";
const CODEX_VOICE_CONTEXT_HOOK_STATUS = "Recording Codex Voice context";
const CODEX_VOICE_USER_PROMPT_HOOK_COMMAND = "codex-classroom voice hook-event UserPromptSubmit";
const CODEX_VOICE_POST_TOOL_HOOK_COMMAND = "codex-classroom voice hook-event PostToolUse";

export async function voiceCommand(context: CommandContext, args: string[]): Promise<void> {
  const action = args[0] ?? "help";
  const options = getVoiceOptions(context);

  if (action === "help" || action === "--help" || action === "-h") {
    printVoiceHelp(context);
    return;
  }

  if (action === "start") {
    await startVoice(context, options, { openPath: "/" });
    return;
  }

  if (action === "present") {
    await startVoice(context, options, { openPath: "/present", allowMissingApiKey: true, threadId: args[1] });
    return;
  }

  if (action === "say") {
    await sendCue(context, options, args.slice(1));
    return;
  }

  if (action === "attach") {
    await attachVoiceThread(context, options, args[1]);
    return;
  }

  if (action === "hook-stop") {
    await sendHookStopCue(context, options);
    return;
  }

  if (action === "hook-event") {
    await recordHookEvent(context, options, args[1]);
    return;
  }

  if (action === "context") {
    await printVoiceContext(context, args.slice(1));
    return;
  }

  if (action === "install-skill") {
    await installVoiceSkill(context);
    return;
  }

  if (action === "doctor") {
    await voiceDoctor(context, options);
    return;
  }

  if (action === "install-hook") {
    await installVoiceHook(context);
    return;
  }

  if (action === "uninstall-hook") {
    await uninstallVoiceHook(context);
    return;
  }

  if (action === "pause" || action === "resume") {
    await sendCue(context, options, [action]);
    return;
  }

  throw new CliError(`Unknown voice command: ${action}`);
}

function getVoiceOptions(context: CommandContext): VoiceOptions {
  return {
    host: context.options.voiceHost ?? DEFAULT_VOICE_HOST,
    port: parsePort(context.options.voicePort),
    model: context.options.voiceModel ?? DEFAULT_VOICE_MODEL,
    voice: context.options.voiceName ?? DEFAULT_VOICE_NAME,
    language: context.options.voiceLanguage ?? DEFAULT_VOICE_LANGUAGE,
    apiKeyEnv: context.options.voiceApiKeyEnv ?? DEFAULT_VOICE_API_KEY_ENV,
    safetyIdentifier: context.options.voiceSafetyIdentifier,
    open: context.options.voiceOpen ?? true,
    contextSource: context.options.voiceContextSource ?? "app-server",
    replayFile: context.options.voiceReplayFile,
    autoNarrate: context.options.voiceAutoNarrate ?? true,
  };
}

async function installVoiceSkill(context: CommandContext): Promise<void> {
  const source = path.join(packageRoot(), "skills", CODEX_VOICE_SKILL_NAME, "SKILL.md");
  const targetDir = path.join(context.paths.realCodexHome, "skills", CODEX_VOICE_SKILL_NAME);
  const target = path.join(targetDir, "SKILL.md");

  if (!(await pathExists(source))) {
    throw new CliError(`Packaged Codex Voice skill is missing: ${source}`);
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.copyFile(source, target);

  if (context.options.json) {
    context.output.json({ ok: true, skill: CODEX_VOICE_SKILL_NAME, target });
    return;
  }

  context.output.info(`Installed ${CODEX_VOICE_SKILL_NAME} skill to ${target}`);
  context.output.info("Restart Codex to pick up new skills.");
}

async function voiceDoctor(context: CommandContext, options: VoiceOptions): Promise<void> {
  const checks = [
    await checkCliOnPath(),
    await checkApiKey(options.apiKeyEnv),
    await checkAppServer(),
    await checkAppServerThreads(context.paths.realCodexHome),
    await checkSkillInstalled(context.paths.realCodexHome),
    await checkVoiceSidecar(options),
    await checkVoiceHook(context.paths.realCodexHome),
  ];
  const ok = checks.every((check) => check.status !== "fail");

  if (context.options.json) {
    context.output.json({ ok, checks });
    return;
  }

  for (const check of checks) {
    context.output.info(`${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
    if (check.fix) {
      context.output.info(`  fix: ${check.fix}`);
    }
  }
}

async function installVoiceHook(context: CommandContext): Promise<void> {
  const hooksPath = path.join(context.paths.realCodexHome, "hooks.json");
  const config = await readHooksConfig(hooksPath);
  const installed = [
    ensureCommandHook(config, "Stop", CODEX_VOICE_HOOK_COMMAND, CODEX_VOICE_HOOK_STATUS),
    ensureCommandHook(config, "UserPromptSubmit", CODEX_VOICE_USER_PROMPT_HOOK_COMMAND, CODEX_VOICE_CONTEXT_HOOK_STATUS),
    ensureCommandHook(config, "PostToolUse", CODEX_VOICE_POST_TOOL_HOOK_COMMAND, CODEX_VOICE_CONTEXT_HOOK_STATUS, "*"),
  ];

  await writeHooksConfig(hooksPath, config);

  if (context.options.json) {
    context.output.json({ ok: true, hooksPath, installed: installed.filter(Boolean).length });
    return;
  }

  context.output.info(installed.some(Boolean) ? "Installed Codex Voice context hooks" : "Codex Voice context hooks already installed");
  context.output.info(`hooks.json: ${hooksPath}`);
  context.output.info("Open /hooks in Codex and trust the new hook before expecting it to run.");
}

async function uninstallVoiceHook(context: CommandContext): Promise<void> {
  const hooksPath = path.join(context.paths.realCodexHome, "hooks.json");
  if (!(await pathExists(hooksPath))) {
    context.output.info(`No hooks.json found at ${hooksPath}`);
    return;
  }

  const config = await readHooksConfig(hooksPath);
  const commands = new Set([
    CODEX_VOICE_HOOK_COMMAND,
    CODEX_VOICE_USER_PROMPT_HOOK_COMMAND,
    CODEX_VOICE_POST_TOOL_HOOK_COMMAND,
  ]);
  let removed = 0;
  for (const eventName of Object.keys(config.hooks)) {
    const groups = config.hooks[eventName] ?? [];
    for (const group of groups) {
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((hook) => !(hook.type === "command" && commands.has(hook.command)));
      removed += before - group.hooks.length;
    }
    config.hooks[eventName] = groups.filter((group) => group.hooks.length > 0);
    if (config.hooks[eventName].length === 0) {
      delete config.hooks[eventName];
    }
  }

  await writeHooksConfig(hooksPath, config);

  if (context.options.json) {
    context.output.json({ ok: true, hooksPath, removed });
    return;
  }

  context.output.info(removed > 0 ? "Removed Codex Voice Stop hook" : "Codex Voice Stop hook was not installed");
}

async function startVoice(
  context: CommandContext,
  options: VoiceOptions,
  startOptions: { openPath: "/" | "/present"; allowMissingApiKey?: boolean; threadId?: string },
): Promise<void> {
  const apiKey = process.env[options.apiKeyEnv];
  if (!apiKey && !startOptions.allowMissingApiKey) {
    throw new CliError(`${options.apiKeyEnv} is not set. Configure an OpenAI API key before starting Codex Voice.`);
  }

  const clients = new Set<ServerResponse>();
  const cueHistory: VoiceCue[] = [];
  const contextHistory = await readVoiceContextEvents(context.paths.classroomRoot, 40);
  const presentHistory: PresentEvent[] = [];
  const momentHistory: ClassroomMoment[] = [];
  const token = createVoiceToken();
  const serverState: VoiceServerState = {
    options,
    classroomRoot: context.paths.classroomRoot,
    apiKey,
    token,
    clients,
    cueHistory,
    contextHistory,
    presentHistory,
    momentHistory,
    appServer: null as AppServerClient | null,
    rolloutWatcher: null as RolloutWatcher | null,
    paused: false,
    lastExplicitCueAt: 0,
    lastSpokenCueText: undefined,
    appServerThreadProbeDisabled: false,
    loggedAppServerThreadProbeError: false,
  };
  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response, serverState);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(options.port, options.host);
  await once(server, "listening");

  const url = `http://${options.host}:${options.port}`;
  await writeVoiceSession(context.paths.classroomRoot, {
    schemaVersion: 1,
    url,
    token,
    startedAt: new Date().toISOString(),
  });
  const appServer = shouldUseAppServer(options) ? await startAppServerBridge(context, serverState, startOptions.threadId) : null;
  const rolloutWatcher = await startRolloutBridge(context, serverState, startOptions.threadId);
  serverState.appServer = appServer;
  serverState.rolloutWatcher = rolloutWatcher;
  if (options.replayFile) {
    startReplay(context, serverState, options.replayFile);
  }
  if (context.options.json) {
    context.output.json({ ok: true, url, presentUrl: `${url}/present`, model: options.model, voice: options.voice });
  } else {
    context.output.info(`Codex Voice listening at ${url}`);
    context.output.info(`Presentation panel: ${url}/present`);
    context.output.info(`Model: ${options.model}`);
    context.output.info(`Voice: ${options.voice}`);
    context.output.info(`Auto narration: ${options.autoNarrate ? "on" : "off"}`);
    context.output.info(appServer ? "Context source: app-server + Desktop sessions" : "Context source: Desktop sessions");
    context.output.info("Send cues with: codex-classroom voice say \"short update\"");
    context.output.info("Press Ctrl+C to stop.");
    if (context.options.qr) {
      context.output.info(`Share URL: ${url}/present`);
    }
  }

  if (options.open) {
    openBrowser(`${url}${startOptions.openPath}`);
  }

  server.on("close", () => {
    appServer?.stop();
    rolloutWatcher?.stop();
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: VoiceServerState,
): Promise<void> {
  const localError = validateLocalRequest(request, state.options.host, state.options.port);
  if (localError) {
    sendJson(response, 403, { ok: false, error: localError });
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, renderVoicePage(state.options));
    return;
  }

  if (request.method === "GET" && url.pathname === "/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    for (const cue of state.cueHistory.slice(-20)) {
      response.write(`event: cue\ndata: ${JSON.stringify(cue)}\n\n`);
    }
    for (const event of state.contextHistory.slice(-30)) {
      response.write(`event: context\ndata: ${JSON.stringify(event)}\n\n`);
    }
    for (const event of state.presentHistory.slice(-30)) {
      response.write(`event: present\ndata: ${JSON.stringify(event)}\n\n`);
    }
    for (const moment of state.momentHistory.slice(-30)) {
      response.write(`event: moment\ndata: ${JSON.stringify(moment)}\n\n`);
    }
    state.clients.add(response);
    request.on("close", () => {
      state.clients.delete(response);
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/present") {
    sendHtml(response, renderPresentPage(state.options));
    return;
  }

  if (request.method === "POST" && url.pathname === "/session") {
    if (!state.apiKey) {
      sendJson(response, 503, { ok: false, error: "OPENAI_API_KEY is not configured; voice audio is disabled." });
      return;
    }
    const sdp = await readLimitedText(request);
    const result = await createRealtimeCall({
      sdp,
      apiKey: state.apiKey,
      options: state.options,
    });
    response.writeHead(result.status, {
      "Content-Type": result.contentType,
    });
    response.end(result.body);
    return;
  }

  if (request.method === "POST" && url.pathname === "/cue") {
    const tokenError = validateVoiceToken(request, state.token);
    if (tokenError) {
      sendJson(response, 403, { ok: false, error: tokenError });
      return;
    }
    const payload = await readJson(request);
    const cue = normalizeCue(payload);
    await publishCue(state, cue, { explicit: true });
    sendJson(response, 200, { ok: true, cue });
    return;
  }

  if (request.method === "POST" && url.pathname === "/context-event") {
    const tokenError = validateVoiceToken(request, state.token);
    if (tokenError) {
      sendJson(response, 403, { ok: false, error: tokenError });
      return;
    }
    const event = normalizeContextEvent(await readJson(request));
    state.contextHistory.push(event);
    for (const client of state.clients) {
      client.write(`event: context\ndata: ${JSON.stringify(event)}\n\n`);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/attach") {
    const tokenError = validateVoiceToken(request, state.token);
    if (tokenError) {
      sendJson(response, 403, { ok: false, error: tokenError });
      return;
    }
    const payload = await readJson(request);
    const threadId = typeof (payload as Record<string, unknown>).threadId === "string"
      ? String((payload as Record<string, unknown>).threadId)
      : "";
    if (!threadId) {
      sendJson(response, 400, { ok: false, error: "threadId is required." });
      return;
    }
    const attached = await attachThreadEverywhere(state, threadId);
    if (!attached) {
      sendJson(response, 404, { ok: false, error: `Could not find thread ${threadId} in app-server or Desktop sessions.` });
      return;
    }
    sendJson(response, 200, { ok: true, threadId });
    return;
  }

  if (request.method === "GET" && url.pathname === "/context") {
    const events = await readVoiceContextEvents(state.classroomRoot, 40);
    sendJson(response, 200, {
      ok: true,
      events,
      brief: buildThreadBrief(events),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}

function shouldUseAppServer(options: VoiceOptions): boolean {
  return options.contextSource === "app-server" || options.contextSource === "both";
}

async function startAppServerBridge(
  context: CommandContext,
  state: VoiceServerState,
  initialThreadId?: string,
): Promise<AppServerClient | null> {
  const options = state.options;
  const client = new AppServerClient();
  try {
    await client.start();
    await client.initialize();
  } catch {
    client.stop();
    if (options.contextSource === "app-server") {
      context.output.warn("codex app-server is not available; app-server context is disabled.");
    }
    return null;
  }

  client.onMappedEvent((mapped) => {
    void handleMappedAppServerEvent(context, state, mapped);
  });

  if (initialThreadId) {
    await attachThread(client, state, initialThreadId).catch((error) => {
      handleAppServerAttachError(context, state, error);
    });
  } else {
    await attachFirstLoadedThread(client, state).catch(() => {
      // The present panel still works with manual cues if there is no loaded thread yet.
    });
  }

  startLoadedThreadPolling(context, client, state);

  return client;
}

async function startRolloutBridge(
  context: CommandContext,
  state: VoiceServerState,
  initialThreadId?: string,
): Promise<RolloutWatcher | null> {
  const watcher = new RolloutWatcher({
    codexHome: context.paths.realCodexHome,
    since: new Date(),
    onEvent: async (event) => {
      await handleRolloutEvent(context, state, event);
    },
  });

  try {
    await watcher.start(initialThreadId);
    return watcher;
  } catch (error) {
    context.output.warn(`Desktop session context is disabled: ${error instanceof Error ? error.message : String(error)}`);
    watcher.stop();
    return null;
  }
}

async function attachThreadEverywhere(
  state: VoiceServerState,
  threadId: string,
): Promise<boolean> {
  let attached = false;
  if (state.appServer && !state.appServerThreadProbeDisabled) {
    try {
      const snapshot = await state.appServer.readThread(threadId);
      hydratePresentFromSnapshot(state.presentHistory, state.clients, snapshot);
      attached = true;
    } catch (error) {
      if (isDesktopRolloutReadError(error)) {
        state.appServerThreadProbeDisabled = true;
      }
      // Desktop-created threads are often only readable from rollout files.
    }
  }

  if (state.rolloutWatcher) {
    attached = (await state.rolloutWatcher.attachThread(threadId)) || attached;
  }

  return attached;
}

async function attachFirstLoadedThread(client: AppServerClient, state: VoiceServerState): Promise<void> {
  const loaded = await client.loadedThreads();
  const data = loaded && typeof loaded === "object" ? (loaded as { data?: unknown }).data : undefined;
  if (!Array.isArray(data) || typeof data[0] !== "string") {
    return;
  }
  await attachThread(client, state, data[0]);
}

async function attachThread(client: AppServerClient, state: VoiceServerState, threadId: string): Promise<void> {
  // Probe with thread/read first; Desktop-created rollouts may not match app-server storage.
  const snapshot = await client.readThread(threadId);
  hydratePresentFromSnapshot(state.presentHistory, state.clients, snapshot);
  await client.resumeThread(threadId);
}

function startLoadedThreadPolling(context: CommandContext, client: AppServerClient, state: VoiceServerState): void {
  let attachedThreadId: string | null = null;
  const timer = setInterval(() => {
    void (async () => {
      const loaded = await client.loadedThreads();
      const data = loaded && typeof loaded === "object" ? (loaded as { data?: unknown }).data : undefined;
      const threadId = Array.isArray(data) && typeof data[0] === "string" ? data[0] : null;
      if (!threadId || threadId === attachedThreadId) {
        return;
      }
      attachedThreadId = threadId;
      await attachThread(client, state, threadId);
    })().catch((error) => {
      handleAppServerAttachError(context, state, error);
      // Polling is best-effort; manual attach remains available.
    });
  }, 2000);
  timer.unref();
}

function hydratePresentFromSnapshot(presentHistory: PresentEvent[], clients: Set<ServerResponse>, snapshot: unknown): void {
  for (const event of mapThreadSnapshot(snapshot)) {
    presentHistory.push(event);
    broadcast(clients, "present", event);
  }
}

async function handleMappedAppServerEvent(
  context: CommandContext,
  state: VoiceServerState,
  mapped: MappedAppServerEvent,
): Promise<void> {
  if (mapped.context) {
    const event = await appendVoiceContextEvent(context.paths.classroomRoot, mapped.context);
    state.contextHistory.push(event);
    broadcast(state.clients, "context", event);
  }

  if (mapped.cue) {
    await publishCue(state, mapped.cue, { explicit: false });
  }

  if (mapped.moment) {
    await publishMoment(context, state, mapped.moment);
  }

  if (mapped.present) {
    state.presentHistory.push(mapped.present);
    broadcast(state.clients, "present", mapped.present);
  }
}

async function handleRolloutEvent(
  context: CommandContext,
  state: VoiceServerState,
  event: RolloutMappedEvent,
): Promise<void> {
  if (event.context) {
    const contextEvent = await appendVoiceContextEvent(context.paths.classroomRoot, event.context);
    state.contextHistory.push(contextEvent);
    broadcast(state.clients, "context", contextEvent);
  }

  if (event.moment) {
    await publishMoment(context, state, event.moment);
  }

  if (event.present) {
    // TODO(remove-legacy-present-events): Present now consumes "moment"; keep this for one release.
    state.presentHistory.push(event.present);
    broadcast(state.clients, "present", event.present);
  }
}

async function publishMoment(context: CommandContext, state: VoiceServerState, moment: ClassroomMoment): Promise<void> {
  const existingIndex = state.momentHistory.findIndex((candidate) => candidate.momentId === moment.momentId);
  if (existingIndex >= 0) {
    state.momentHistory[existingIndex] = moment;
  } else {
    state.momentHistory.push(moment);
    state.momentHistory = state.momentHistory.slice(-80);
  }
  broadcast(state.clients, "moment", moment);

  const decision = maybeAutoNarrateMoment(moment, {
    autoNarrate: state.options.autoNarrate,
    paused: state.paused,
    lastExplicitCueAt: state.lastExplicitCueAt,
    lastSpokenText: state.lastSpokenCueText,
  }, Date.parse(moment.at), isDuplicateText);

  if (decision.dropped && context.options.verbose) {
    context.output.info(`Dropped duplicate auto cue: ${moment.detail}`);
  }
  if (decision.cue) {
    await publishCue(state, decision.cue, { explicit: false });
  }
}

async function publishCue(state: VoiceServerState, cue: VoiceCue, options: { explicit: boolean }): Promise<boolean> {
  const normalized: VoiceCue = { ...cue, source: cue.source ?? (options.explicit ? "manual" : "cue") };
  if (normalized.kind === "pause") {
    state.paused = true;
  } else if (normalized.kind === "resume") {
    state.paused = false;
  }
  if (options.explicit) {
    state.lastExplicitCueAt = Date.parse(normalized.at) || Date.now();
  }
  if (normalized.text && state.lastSpokenCueText && isDuplicateText(state.lastSpokenCueText, normalized.text)) {
    return false;
  }

  state.cueHistory.push(normalized);
  if (normalized.text) {
    state.lastSpokenCueText = normalized.text;
  }
  const event = await appendVoiceContextEvent(state.classroomRoot, {
    source: "cue",
    kind: normalized.kind,
    title: `Voice cue: ${normalized.kind}`,
    summary: normalized.text || normalized.kind,
    at: normalized.at,
  });
  state.contextHistory.push(event);
  const presentEvent: PresentEvent = { type: "subtitle", text: normalized.text || normalized.kind };
  state.presentHistory.push(presentEvent);
  broadcast(state.clients, "cue", normalized);
  broadcast(state.clients, "context", event);
  broadcast(state.clients, "present", presentEvent);
  return true;
}

function handleAppServerAttachError(context: CommandContext, state: VoiceServerState, error: unknown): void {
  if (!isDesktopRolloutReadError(error)) {
    if (context.options.verbose) {
      context.output.warn(`Could not attach app-server thread: ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }
  state.appServerThreadProbeDisabled = true;
  if (!state.loggedAppServerThreadProbeError && context.options.verbose) {
    state.loggedAppServerThreadProbeError = true;
    context.output.warn("app-server cannot read Desktop rollouts on this Codex version; using Desktop sessions.");
  }
}

export function isDesktopRolloutReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // TODO(app-server-schema-alignment): probe error "does not start with session metadata"; real turn/plan/updated events should replace inferred phases when schemas align.
  return message.includes("does not start with session metadata");
}

function startReplay(context: CommandContext, state: VoiceServerState, file: string): void {
  const replayPath = path.resolve(file);
  void fs.readFile(replayPath, "utf8").then((text) => {
    const events = mapRolloutText(text);
    let previousMs: number | null = null;
    let delay = 250;
    for (const event of events) {
      const atMs = event.moment ? Date.parse(event.moment.at) : NaN;
      if (Number.isFinite(atMs) && previousMs !== null) {
        delay += Math.min(Math.max((atMs - previousMs) / 5, 40), 2000);
      }
      if (Number.isFinite(atMs)) {
        previousMs = atMs;
      }
      setTimeout(() => {
        void handleRolloutEvent(context, state, event);
      }, delay).unref();
    }
  }).catch((error) => {
    context.output.warn(`Could not replay ${replayPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function broadcast(clients: Set<ServerResponse>, event: string, data: unknown): void {
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

async function createRealtimeCall(input: {
  sdp: string;
  apiKey: string;
  options: VoiceOptions;
}): Promise<{ status: number; contentType: string; body: string }> {
  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set(
    "session",
    JSON.stringify(
      buildRealtimeSessionConfig({
        model: input.options.model,
        voice: input.options.voice,
        language: input.options.language,
      }),
    ),
  );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
  };
  if (input.options.safetyIdentifier) {
    headers["OpenAI-Safety-Identifier"] = input.options.safetyIdentifier;
  }

  const upstream = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers,
    body: form,
  });

  return {
    status: upstream.status,
    contentType: upstream.headers.get("content-type") ?? "application/sdp",
    body: await upstream.text(),
  };
}

async function sendCue(context: CommandContext, options: VoiceOptions, args: string[]): Promise<void> {
  const first = args[0];
  const kind = isCueKind(first) ? parseCueKind(first) : "evidence";
  const textArgs = isCueKind(first) ? args.slice(1) : args;
  const text = textArgs.join(" ").trim();

  if (!text && kind !== "pause" && kind !== "resume") {
    throw new CliError("voice say requires a short message.");
  }

  const cue: VoiceCue = {
    kind,
    text,
    at: new Date().toISOString(),
  };

  const session = await readVoiceSession(context.paths.classroomRoot);
  if (!session) {
    throw new CliError("Codex Voice session token is missing. Start the sidecar with codex-classroom voice start.");
  }

  const response = await fetch(`http://${options.host}:${options.port}/cue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voice-Token": session.token,
    },
    body: JSON.stringify(cue),
  }).catch((error: unknown) => {
    throw new CliError(
      `Could not reach Codex Voice at ${options.host}:${options.port}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  if (!response.ok) {
    throw new CliError(`Codex Voice rejected the cue: ${await response.text()}`);
  }

  if (context.options.json) {
    context.output.json({ ok: true, cue });
  } else {
    context.output.info(`Sent ${kind} cue.`);
  }
}

async function attachVoiceThread(context: CommandContext, options: VoiceOptions, threadId: string | undefined): Promise<void> {
  if (!threadId) {
    throw new CliError("voice attach requires a thread id.");
  }
  const session = await readVoiceSession(context.paths.classroomRoot);
  if (!session) {
    throw new CliError("Codex Voice session token is missing. Start the sidecar with codex-classroom voice start.");
  }

  const response = await fetch(`http://${options.host}:${options.port}/attach`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Voice-Token": session.token,
    },
    body: JSON.stringify({ threadId }),
  }).catch((error: unknown) => {
    throw new CliError(
      `Could not reach Codex Voice at ${options.host}:${options.port}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  if (!response.ok) {
    throw new CliError(`Codex Voice rejected attach: ${await response.text()}`);
  }

  if (context.options.json) {
    context.output.json({ ok: true, threadId });
  } else {
    context.output.info(`Attached Codex Voice to thread ${threadId}.`);
  }
}

async function sendHookStopCue(context: CommandContext, options: VoiceOptions): Promise<void> {
  const event = await appendHookEvent(context, options, "Stop");
  const cue: VoiceCue = {
    kind: "wrap",
    text: "I finished my response and I am ready for the next instruction.",
    at: new Date().toISOString(),
  };

  await notifyContextEvent(context, options, event);
  const session = await readVoiceSession(context.paths.classroomRoot);
  await fetch(`http://${options.host}:${options.port}/cue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "X-Voice-Token": session.token } : {}),
    },
    body: JSON.stringify(cue),
  }).catch(() => {
    // Hooks must not block Codex if the sidecar is not running.
  });
}

async function recordHookEvent(context: CommandContext, options: VoiceOptions, eventName: string | undefined): Promise<void> {
  if (!eventName) {
    throw new CliError("voice hook-event requires a Codex hook event name.");
  }
  const event = await appendHookEvent(context, options, eventName);
  await notifyContextEvent(context, options, event);

  if (context.options.json) {
    context.output.json({ ok: true, event });
  }
}

async function appendHookEvent(
  context: CommandContext,
  _options: VoiceOptions,
  eventName: string,
): Promise<VoiceContextEvent> {
  const stdin = await readStdinText();
  const payload = parseHookPayload(stdin);
  const normalized = normalizeHookContext({
    eventName,
    payload,
    cwd: process.cwd(),
  });
  return await appendVoiceContextEvent(context.paths.classroomRoot, normalized);
}

async function printVoiceContext(context: CommandContext, args: string[]): Promise<void> {
  const limit = parseContextLimit(args[0]);
  const events = await readVoiceContextEvents(context.paths.classroomRoot, limit);
  const brief = buildThreadBrief(events);

  if (context.options.json) {
    context.output.json({ ok: true, events, brief });
    return;
  }

  context.output.info(`Codex Voice context: ${events.length} event(s)`);
  context.output.info(brief);
}

async function notifyContextEvent(context: CommandContext, options: VoiceOptions, event: VoiceContextEvent): Promise<void> {
  const session = await readVoiceSession(context.paths.classroomRoot);
  await fetch(`http://${options.host}:${options.port}/context-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "X-Voice-Token": session.token } : {}),
    },
    body: JSON.stringify(event),
  }).catch(() => {
    // Context hooks should keep working even when the sidecar is not open.
  });
}

function isCueKind(value: string | undefined): boolean {
  return (
    value === "note" ||
    value === "started" ||
    value === "changed" ||
    value === "blocked" ||
    value === "verified" ||
    value === "orientation" ||
    value === "method" ||
    value === "evidence" ||
    value === "decision" ||
    value === "risk" ||
    value === "wrap" ||
    value === "pause" ||
    value === "resume"
  );
}

function normalizeCue(payload: unknown): VoiceCue {
  if (!payload || typeof payload !== "object") {
    throw new Error("Cue payload must be an object.");
  }

  const raw = payload as Record<string, unknown>;
  const kind = parseCueKind(typeof raw.kind === "string" ? raw.kind : undefined);
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  const at = typeof raw.at === "string" ? raw.at : new Date().toISOString();

  if (!text && kind !== "pause" && kind !== "resume") {
    throw new Error("Cue text is required.");
  }

  return { kind, text, at };
}

function normalizeContextEvent(payload: unknown): VoiceContextEvent {
  if (!payload || typeof payload !== "object") {
    throw new Error("Context event payload must be an object.");
  }
  const raw = payload as VoiceContextEvent;
  if (raw.schemaVersion !== 1 || !raw.id || !raw.at || !raw.kind || !raw.summary) {
    throw new Error("Context event payload is invalid.");
  }
  return raw;
}

async function readText(request: IncomingMessage): Promise<string> {
  return await readLimitedText(request);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const text = await readText(request);
  return JSON.parse(text);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(body);
}

interface VoiceDoctorCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  fix?: string;
}

interface HooksConfig {
  hooks: Record<string, HookGroup[]>;
}

interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}

interface HookHandler {
  type: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
}

async function checkCliOnPath(): Promise<VoiceDoctorCheck> {
  const result = await runCommand("codex-classroom", ["--version"]);
  if (result.ok) {
    return { id: "cli-path", status: "ok", summary: `codex-classroom ${result.stdout || "is available"}` };
  }

  return {
    id: "cli-path",
    status: "fail",
    summary: "codex-classroom is not available on PATH",
    fix: "Install globally with npm install -g github:aastroza/codex-classroom, then open a new terminal.",
  };
}

async function checkApiKey(apiKeyEnv: string): Promise<VoiceDoctorCheck> {
  if (process.env[apiKeyEnv]) {
    return { id: "api-key", status: "ok", summary: `${apiKeyEnv} is available in this process` };
  }

  return {
    id: "api-key",
    status: "fail",
    summary: `${apiKeyEnv} is not available in this process`,
    fix: process.platform === "win32"
      ? `$env:${apiKeyEnv} = [Environment]::GetEnvironmentVariable('${apiKeyEnv}','User')`
      : `export ${apiKeyEnv}=...`,
  };
}

async function checkSkillInstalled(codexHome: string): Promise<VoiceDoctorCheck> {
  const target = path.join(codexHome, "skills", CODEX_VOICE_SKILL_NAME, "SKILL.md");
  if (await pathExists(target)) {
    return { id: "skill", status: "ok", summary: `Skill installed at ${target}` };
  }

  return {
    id: "skill",
    status: "fail",
    summary: `Skill is missing at ${target}`,
    fix: "Run codex-classroom voice install-skill, then restart Codex.",
  };
}

async function checkVoiceSidecar(options: VoiceOptions): Promise<VoiceDoctorCheck> {
  const url = `http://${options.host}:${options.port}/health`;
  try {
    const response = await fetch(url);
    if (response.ok) {
      return { id: "sidecar", status: "ok", summary: `Sidecar is responding at ${url}` };
    }
    return {
      id: "sidecar",
      status: "warn",
      summary: `Sidecar responded with HTTP ${response.status}`,
      fix: "Restart it with codex-classroom voice start.",
    };
  } catch {
    return {
      id: "sidecar",
      status: "warn",
      summary: `Sidecar is not running at ${url}`,
      fix: "Start it with codex-classroom voice start.",
    };
  }
}

async function checkVoiceHook(codexHome: string): Promise<VoiceDoctorCheck> {
  const hooksPath = path.join(codexHome, "hooks.json");
  if (!(await pathExists(hooksPath))) {
    return {
      id: "context-hooks",
      status: "warn",
      summary: "Codex Voice context hooks are not installed",
      fix: "Run codex-classroom voice install-hook, then review it with /hooks in Codex.",
    };
  }

  const config = await readHooksConfig(hooksPath);
  const expected = [
    CODEX_VOICE_HOOK_COMMAND,
    CODEX_VOICE_USER_PROMPT_HOOK_COMMAND,
    CODEX_VOICE_POST_TOOL_HOOK_COMMAND,
  ];
  const installed = new Set<string>();
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        if (hook.type === "command") {
          installed.add(hook.command);
        }
      }
    }
  }

  const missing = expected.filter((command) => !installed.has(command));
  if (missing.length === 0) {
    return { id: "context-hooks", status: "ok", summary: `Codex Voice context hooks are configured in ${hooksPath}` };
  }

  return {
    id: "context-hooks",
    status: "warn",
    summary: `Codex Voice context hooks are incomplete (${missing.length} missing)`,
    fix: "Run codex-classroom voice install-hook, then review it with /hooks in Codex.",
  };
}

async function checkAppServer(): Promise<VoiceDoctorCheck> {
  try {
    const result = await checkAppServerAvailable();
    return {
      id: "app-server",
      status: "ok",
      summary: `codex app-server is available${result.userAgent ? ` (${result.userAgent})` : ""}`,
    };
  } catch (error) {
    return {
      id: "app-server",
      status: "warn",
      summary: `codex app-server is not responding: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Codex Voice will fall back to hooks when installed, or run without live thread context.",
    };
  }
}

async function checkAppServerThreads(codexHome: string): Promise<VoiceDoctorCheck> {
  const threadId = await findLatestDesktopThreadId(codexHome);
  if (!threadId) {
    return {
      id: "app-server-threads",
      status: "warn",
      summary: "No Desktop rollout thread was found to probe app-server thread reads",
    };
  }

  const client = new AppServerClient();
  try {
    await client.start();
    await client.initialize();
    await client.readThread(threadId);
    return {
      id: "app-server-threads",
      status: "ok",
      summary: "app-server can read the latest Desktop thread",
    };
  } catch (error) {
    if (isDesktopRolloutReadError(error)) {
      return {
        id: "app-server-threads",
        status: "warn",
        summary: "app-server cannot read Desktop rollouts on this Codex version",
      };
    }
    return {
      id: "app-server-threads",
      status: "warn",
      summary: `app-server thread probe failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    client.stop();
  }
}

async function findLatestDesktopThreadId(codexHome: string): Promise<string | null> {
  const sessionsDir = path.join(codexHome, "sessions");
  const files: Array<{ file: string; mtimeMs: number }> = [];
  await collectRolloutFiles(sessionsDir, files);
  const latest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) {
    return null;
  }
  const match = path.basename(latest.file).match(/rollout-.+-(019[0-9a-f-]+)\.jsonl$/i);
  return match?.[1] ?? null;
}

async function collectRolloutFiles(dir: string, files: Array<{ file: string; mtimeMs: number }>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectRolloutFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat) {
        files.push({ file: fullPath, mtimeMs: stat.mtimeMs });
      }
    }
  }
}

async function runCommand(command: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ ok: false, stdout: "", stderr: error.message });
    });
    child.on("exit", (code) => {
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function readHooksConfig(hooksPath: string): Promise<HooksConfig> {
  if (!(await pathExists(hooksPath))) {
    return { hooks: {} };
  }

  const parsed = JSON.parse(await fs.readFile(hooksPath, "utf8")) as Partial<HooksConfig>;
  return { hooks: parsed.hooks ?? {} };
}

async function writeHooksConfig(hooksPath: string, config: HooksConfig): Promise<void> {
  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function ensureHookGroups(config: HooksConfig, event: string): HookGroup[] {
  config.hooks[event] ??= [];
  return config.hooks[event];
}

function ensureCommandHook(
  config: HooksConfig,
  event: string,
  command: string,
  statusMessage: string,
  matcher?: string,
): boolean {
  const groups = ensureHookGroups(config, event);
  const group = groups.find((candidate) => (candidate.matcher ?? "") === (matcher ?? "")) ?? {
    ...(matcher ? { matcher } : {}),
    hooks: [],
  };
  if (!groups.includes(group)) {
    groups.push(group);
  }

  const alreadyInstalled = group.hooks.some((hook) => hook.type === "command" && hook.command === command);
  if (alreadyInstalled) {
    return false;
  }

  group.hooks.push({
    type: "command",
    command,
    timeout: 10,
    statusMessage,
  });
  return true;
}

function parseContextLimit(value: string | undefined): number {
  if (value === undefined) {
    return 20;
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new CliError("voice context limit must be an integer between 1 and 200.");
  }
  return limit;
}

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? { cmd: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { cmd: "open", args: [url] }
        : { cmd: "xdg-open", args: [url] };

  const child = spawn(command.cmd, command.args, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
}

function renderVoicePage(options: VoiceOptions): string {
  const config = JSON.stringify({
    model: options.model,
    voice: options.voice,
    language: options.language,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Voice</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #141414; color: #f2efe7; }
    main { max-width: 920px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 34px; line-height: 1.1; margin: 0 0 8px; letter-spacing: 0; }
    p { color: #b7b0a3; line-height: 1.55; margin: 0; }
    .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 32px; }
    .panel { border: 1px solid #3b3833; border-radius: 8px; padding: 18px; background: #1e1d1a; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    button { border: 1px solid #565047; border-radius: 6px; background: #2c2924; color: #f2efe7; padding: 10px 14px; font: inherit; cursor: pointer; }
    button.primary { background: #f2efe7; color: #141414; border-color: #f2efe7; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    textarea { width: 100%; min-height: 88px; box-sizing: border-box; margin-top: 12px; border-radius: 6px; border: 1px solid #565047; background: #141414; color: #f2efe7; padding: 12px; font: inherit; resize: vertical; }
    .status { display: inline-flex; align-items: center; gap: 8px; border: 1px solid #3b3833; border-radius: 999px; padding: 8px 12px; color: #d6d0c4; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #8f8577; }
    .dot.live { background: #60d394; }
    .dot.error { background: #ff6b6b; }
    .log { display: grid; gap: 10px; margin-top: 12px; }
    .cue { border-left: 3px solid #d8b86a; padding: 8px 0 8px 12px; color: #e8e1d6; }
    .meta { color: #8f8577; font-size: 13px; margin-bottom: 3px; }
    @media (max-width: 760px) { .top, .grid { display: block; } .panel { margin-bottom: 16px; } }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <h1>Codex Voice</h1>
        <p>Keep this tab open during class. Codex can speak as itself, listen to the teacher, and comment only when useful.</p>
      </div>
      <div class="status"><span id="statusDot" class="dot"></span><span id="statusText">Disconnected</span></div>
    </div>

    <div class="grid">
      <section class="panel">
        <h2>Session</h2>
        <p id="sessionConfig"></p>
        <div class="controls">
          <button id="connectButton" class="primary">Start</button>
          <button id="disconnectButton" disabled>Stop</button>
          <button id="muteButton" disabled>Mute mic</button>
        </div>
      </section>

      <section class="panel">
        <h2>Manual cue</h2>
        <p>Send one short cue for Codex to say in its own voice.</p>
        <textarea id="manualCue" placeholder="I just found the failing test and I am narrowing the fix."></textarea>
        <div class="controls">
          <button id="sendButton" disabled>Send cue</button>
          <button id="pauseButton" disabled>Pause</button>
          <button id="resumeButton" disabled>Resume</button>
        </div>
      </section>
    </div>

    <section class="panel" style="margin-top:16px">
      <h2>Cues</h2>
      <div id="log" class="log"></div>
    </section>

    <section class="panel" style="margin-top:16px">
      <h2>Thread context</h2>
      <p id="contextStatus">Waiting for Codex hook events.</p>
      <div id="contextLog" class="log"></div>
    </section>
  </main>
  <script>
    const config = ${config};
    let pc;
    let dc;
    let micTrack;
    let connected = false;
    const pendingContext = [];

    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const connectButton = document.getElementById("connectButton");
    const disconnectButton = document.getElementById("disconnectButton");
    const muteButton = document.getElementById("muteButton");
    const sendButton = document.getElementById("sendButton");
    const pauseButton = document.getElementById("pauseButton");
    const resumeButton = document.getElementById("resumeButton");
    const manualCue = document.getElementById("manualCue");
    const log = document.getElementById("log");
    const contextStatus = document.getElementById("contextStatus");
    const contextLog = document.getElementById("contextLog");
    document.getElementById("sessionConfig").textContent = config.model + " - " + config.voice + " - " + config.language;

    function setStatus(text, mode) {
      statusText.textContent = text;
      statusDot.className = "dot" + (mode ? " " + mode : "");
    }

    function setConnected(value) {
      connected = value;
      connectButton.disabled = value;
      disconnectButton.disabled = !value;
      muteButton.disabled = !value;
      sendButton.disabled = !value;
      pauseButton.disabled = !value;
      resumeButton.disabled = !value;
    }

    async function connect() {
      setStatus("Connecting", "");
      pc = new RTCPeerConnection();
      const audio = document.createElement("audio");
      audio.autoplay = true;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
      };

      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTrack = media.getTracks()[0];
      pc.addTrack(micTrack);

      dc = pc.createDataChannel("oai-events");
      dc.addEventListener("open", () => {
        setStatus("Live", "live");
        setConnected(true);
        flushPendingContext();
      });
      dc.addEventListener("close", () => {
        setStatus("Disconnected", "");
        setConnected(false);
      });
      dc.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "error") appendLog("error", data.error?.message || "Realtime error");
        } catch {
          // Ignore non-JSON data channel messages.
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text());
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    }

    function disconnect() {
      if (dc) dc.close();
      if (pc) pc.close();
      if (micTrack) micTrack.stop();
      dc = undefined;
      pc = undefined;
      micTrack = undefined;
      setStatus("Disconnected", "");
      setConnected(false);
    }

    function sendCueToRealtime(cue) {
      appendLog(cue.kind, cue.text || cue.kind);
      if (!connected || !dc || dc.readyState !== "open") return;

      const prompt = cue.kind === "pause"
        ? "Pause your classroom voice now. Stay silent until a resume cue or teacher request."
        : cue.kind === "resume"
          ? "Resume your classroom voice. Say one brief first-person sentence that you are ready to continue."
          : cueLabel(cue.kind) + ": " + cue.text + "\\n\\nSay one short first-person classroom-friendly sentence about this. If the teacher appears to be speaking, wait for a natural pause.";

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }));
      dc.send(JSON.stringify({
        type: "response.create",
      }));
    }

    function sendContextToRealtime(event) {
      appendContext(event);
      if (!connected || !dc || dc.readyState !== "open") {
        pendingContext.push(event);
        while (pendingContext.length > 30) pendingContext.shift();
        return;
      }
      injectContextToRealtime(event);
    }

    function injectContextToRealtime(event) {
      const prompt = "Thread context update for future teacher questions. Store this silently and do not speak now.\\n" +
        event.kind + ": " + event.title + "\\n" +
        event.summary +
        (event.toolName ? "\\nTool: " + event.toolName : "") +
        (event.status ? "\\nStatus: " + event.status : "");

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      }));
    }

    function flushPendingContext() {
      const queued = pendingContext.splice(0, pendingContext.length);
      for (const event of queued) {
        injectContextToRealtime(event);
      }
    }

    function cueLabel(kind) {
      return {
        orientation: "Classroom task",
        method: "Method",
        evidence: "Evidence",
        decision: "Decision",
        risk: "Risk",
        wrap: "Wrap",
      }[kind] || "Classroom note";
    }

    function appendLog(kind, text) {
      const row = document.createElement("div");
      row.className = "cue";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = new Date().toLocaleTimeString() + " - " + kind;
      const body = document.createElement("div");
      body.textContent = text;
      row.append(meta, body);
      log.prepend(row);
    }

    function appendContext(event) {
      contextStatus.textContent = "Recent context is being shared silently with Codex Voice.";
      const row = document.createElement("div");
      row.className = "cue";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = new Date(event.at).toLocaleTimeString() + " - " + event.kind;
      const body = document.createElement("div");
      body.textContent = event.title + ": " + event.summary;
      row.append(meta, body);
      contextLog.prepend(row);
      while (contextLog.children.length > 12) {
        contextLog.removeChild(contextLog.lastChild);
      }
    }

    async function postCue(kind, text) {
      await fetch("/cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, at: new Date().toISOString() }),
      });
    }

    connectButton.addEventListener("click", () => connect().catch((error) => {
      setStatus("Error", "error");
      appendLog("error", error.message);
      disconnect();
    }));
    disconnectButton.addEventListener("click", disconnect);
    muteButton.addEventListener("click", () => {
      if (!micTrack) return;
      micTrack.enabled = !micTrack.enabled;
      muteButton.textContent = micTrack.enabled ? "Mute mic" : "Unmute mic";
    });
    sendButton.addEventListener("click", () => {
      const text = manualCue.value.trim();
      if (!text) return;
      manualCue.value = "";
      postCue("evidence", text);
    });
    pauseButton.addEventListener("click", () => postCue("pause", ""));
    resumeButton.addEventListener("click", () => postCue("resume", ""));

    const events = new EventSource("/events");
    events.addEventListener("cue", (event) => sendCueToRealtime(JSON.parse(event.data)));
    events.addEventListener("context", (event) => sendContextToRealtime(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}

function renderPresentPage(_options: VoiceOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codex Classroom Present</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; overflow: hidden; background: #111; color: #f7f1e7; }
    main { height: 100vh; display: grid; grid-template-rows: auto auto 1fr auto; gap: 24px; padding: 42px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 32px; }
    h1 { margin: 0; font-size: clamp(42px, 5vw, 76px); line-height: 0.95; letter-spacing: 0; }
    .task { color: #d8d0c2; font-size: clamp(22px, 2.2vw, 34px); line-height: 1.22; max-width: 1400px; min-height: 42px; }
    .live { display: inline-flex; align-items: center; gap: 12px; border: 1px solid #3a362f; border-radius: 999px; padding: 12px 18px; color: #d8d0c2; font-size: 24px; }
    .dot { width: 14px; height: 14px; border-radius: 50%; background: #60d394; }
    .grid { display: grid; grid-template-columns: 0.9fr 1.35fr; gap: 28px; min-height: 0; }
    .panel { min-height: 0; border: 1px solid #37332d; border-radius: 18px; padding: 30px; background: #1c1a17; box-shadow: 0 20px 70px rgba(0,0,0,.25); }
    h2 { margin: 0 0 24px; color: #f4c95d; font-size: clamp(24px, 3vw, 42px); line-height: 1; }
    .phase-list { display: grid; gap: 16px; }
    .step { display: grid; grid-template-columns: 42px 1fr; gap: 18px; align-items: start; font-size: clamp(24px, 2.5vw, 38px); line-height: 1.16; color: #d8d0c2; }
    .mark { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; border: 2px solid #716a5e; color: #716a5e; font-size: 22px; margin-top: 2px; transition: background .25s ease, border-color .25s ease, color .25s ease; }
    .step { transition: opacity .25s ease, transform .25s ease, color .25s ease; }
    .step.pending { opacity: .45; }
    .step.active { color: #fffaf0; transform: translateX(8px); }
    .step.active .mark { border-color: #65d6ad; background: #65d6ad; color: #111; }
    .step.done .mark { border-color: #f4c95d; background: #f4c95d; color: #111; }
    .moment { display: grid; align-content: center; gap: 26px; border-color: #37332d; transition: border-color .25s ease, background .25s ease; }
    .moment.risk { border-color: #ff6b6b; background: #241817; }
    .moment.wrap { border-color: #65d6ad; background: #17211c; }
    .moment-title { font-size: clamp(42px, 5vw, 86px); line-height: .98; font-weight: 800; letter-spacing: 0; }
    .moment-detail { color: #d8d0c2; font-size: clamp(26px, 2.9vw, 48px); line-height: 1.16; max-width: 1120px; }
    .recent { display: grid; gap: 10px; margin-top: 26px; color: #9d9486; font-size: clamp(16px, 1.5vw, 23px); }
    .recent div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .subtitle { border-radius: 18px; background: #f7f1e7; color: #151515; padding: 24px 30px; font-size: clamp(28px, 3vw, 52px); line-height: 1.1; min-height: 106px; display: flex; align-items: center; }
    .empty { color: #8f8679; }
    @media (max-width: 900px) { body { overflow: auto; } main { height: auto; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex is working</h1>
      <div class="live"><span class="dot"></span><span id="status">Live</span></div>
    </header>
    <div id="task" class="task">Waiting for a Codex classroom task.</div>
    <section class="grid">
      <div class="panel">
        <h2>Phases</h2>
        <div id="phases" class="phase-list"><div class="empty">Waiting for Codex phase updates.</div></div>
      </div>
      <div id="momentCard" class="panel moment">
        <div id="momentTitle" class="moment-title empty">Waiting for activity.</div>
        <div id="momentDetail" class="moment-detail"></div>
        <div id="recent" class="recent"></div>
      </div>
    </section>
    <div id="subtitle" class="subtitle">Codex Classroom presentation panel is ready.</div>
  </main>
  <script>
    const phases = document.getElementById("phases");
    const task = document.getElementById("task");
    const momentCard = document.getElementById("momentCard");
    const momentTitle = document.getElementById("momentTitle");
    const momentDetail = document.getElementById("momentDetail");
    const recent = document.getElementById("recent");
    const subtitle = document.getElementById("subtitle");
    const status = document.getElementById("status");
    const momentsById = new Map();
    let frozen = false;

    function renderPhases(items) {
      if (!items || items.length === 0) {
        phases.innerHTML = '<div class="empty">Waiting for Codex phase updates.</div>';
        return;
      }
      phases.innerHTML = items.slice(0, 6).map((phase) => {
        const done = phase.status === "done";
        const active = phase.status === "active";
        const mark = done ? "OK" : active ? ">" : "";
        const cls = done ? "step done" : active ? "step active" : "step pending";
        return '<div class="' + cls + '"><div class="mark">' + mark + '</div><div>' + escapeHtml(phase.label) + '</div></div>';
      }).join("");
    }

    function renderMoment(moment) {
      momentsById.set(moment.momentId, moment);
      if (moment.type === "orientation") {
        task.textContent = moment.detail;
      }
      if (frozen && moment.type !== "wrap") return;
      momentCard.className = "panel moment " + (moment.type === "risk" ? "risk" : moment.type === "wrap" ? "wrap" : "");
      momentTitle.className = "moment-title";
      momentTitle.textContent = moment.title;
      momentDetail.textContent = moment.detail;
      if (moment.phases) renderPhases(moment.phases);
      const evidence = Array.from(momentsById.values())
        .filter((item) => item.type === "evidence" || item.type === "method" || item.type === "tool")
        .slice(-3)
        .reverse();
      recent.innerHTML = evidence.map((item) => '<div>' + escapeHtml(item.title + ": " + item.detail) + '</div>').join("");
      if (moment.type === "wrap") {
        frozen = true;
        subtitle.textContent = moment.detail;
      }
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
    }

    const events = new EventSource("/events");
    events.addEventListener("ready", () => { status.textContent = "Live"; });
    events.addEventListener("moment", (event) => renderMoment(JSON.parse(event.data)));
    events.addEventListener("present", (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "plan") renderPhases(data.steps.map((step) => ({
        label: step.step,
        status: step.status === "completed" ? "done" : step.status === "in_progress" ? "active" : "pending",
      })));
      if (data.type === "command") {
        if (!frozen) {
          momentTitle.className = "moment-title";
          momentTitle.textContent = data.status === "failed" ? "Command failed" : data.status === "passed" ? "Command passed" : "Running command";
          momentDetail.textContent = data.command;
        }
      }
      if (data.type === "diff") {
        if (!frozen) {
          momentTitle.className = "moment-title";
          momentTitle.textContent = data.filesChanged + " file" + (data.filesChanged === 1 ? "" : "s") + " changed";
          momentDetail.textContent = "+" + (data.additions || 0) + " / -" + (data.deletions || 0);
        }
      }
      if (data.type === "subtitle") subtitle.textContent = data.text;
    });
    events.addEventListener("cue", (event) => {
      const cue = JSON.parse(event.data);
      if (cue.text) subtitle.textContent = cue.text;
    });
    events.addEventListener("error", () => { status.textContent = "Reconnecting"; });
  </script>
</body>
</html>`;
}

function printVoiceHelp(context: CommandContext): void {
  context.output.info(`codex-classroom voice

Usage:
  codex-classroom voice start [options]
  codex-classroom voice say [kind] <message> [options]
  codex-classroom voice attach <threadId> [options]
  codex-classroom voice pause [options]
  codex-classroom voice resume [options]
  codex-classroom voice context [limit] [options]
  codex-classroom voice doctor [options]
  codex-classroom voice install-skill [options]
  codex-classroom voice install-hook [options]
  codex-classroom voice uninstall-hook [options]
  codex-classroom present [threadId] [options]

Voice options:
  --host <host>             Local host to bind or contact (default: 127.0.0.1)
  --port <port>             Local port to bind or contact (default: 17321)
  --model <model>           Realtime model (default: gpt-realtime-2.1-mini)
  --voice <voice>           Realtime voice (default: marin)
  --language <language>     Spoken language (default: Spanish)
  --api-key-env <name>      Environment variable containing the OpenAI API key
  --safety-identifier <id>  Optional stable privacy-preserving safety identifier
  --context-source <source> app-server, hooks, or both (default: app-server)
  --replay <file>           Replay a rollout JSONL into the panel at demo speed
  --auto-narrate            Inject sparse classroom narration when Codex is silent
  --no-auto-narrate         Disable automatic classroom narration
  --no-open                 Do not open the browser after starting
  --qr                      Print the presentation URL

Cue kinds:
  orientation, method, evidence, decision, risk, wrap, pause, resume
`);
}
