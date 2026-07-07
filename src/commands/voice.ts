import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import { pathExists } from "../core/fs.js";
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
}

const CODEX_VOICE_SKILL_NAME = "codex-voice";
const CODEX_VOICE_HOOK_STATUS = "Speaking Codex Voice turn status";
const CODEX_VOICE_HOOK_COMMAND = "codex-classroom voice hook-stop";

export async function voiceCommand(context: CommandContext, args: string[]): Promise<void> {
  const action = args[0] ?? "help";
  const options = getVoiceOptions(context);

  if (action === "help" || action === "--help" || action === "-h") {
    printVoiceHelp(context);
    return;
  }

  if (action === "start") {
    await startVoice(context, options);
    return;
  }

  if (action === "say") {
    await sendCue(context, options, args.slice(1));
    return;
  }

  if (action === "hook-stop") {
    await sendHookStopCue(options);
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
  const stopHooks = ensureHookGroups(config, "Stop");
  const group = stopHooks[0] ?? { hooks: [] };
  if (stopHooks.length === 0) {
    stopHooks.push(group);
  }

  const alreadyInstalled = group.hooks.some((hook) => hook.type === "command" && hook.command === CODEX_VOICE_HOOK_COMMAND);
  if (!alreadyInstalled) {
    group.hooks.push({
      type: "command",
      command: CODEX_VOICE_HOOK_COMMAND,
      timeout: 10,
      statusMessage: CODEX_VOICE_HOOK_STATUS,
    });
  }

  await writeHooksConfig(hooksPath, config);

  if (context.options.json) {
    context.output.json({ ok: true, hooksPath, installed: !alreadyInstalled });
    return;
  }

  context.output.info(alreadyInstalled ? "Codex Voice Stop hook already installed" : "Installed Codex Voice Stop hook");
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
  const groups = config.hooks.Stop ?? [];
  let removed = 0;
  for (const group of groups) {
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((hook) => !(hook.type === "command" && hook.command === CODEX_VOICE_HOOK_COMMAND));
    removed += before - group.hooks.length;
  }
  config.hooks.Stop = groups.filter((group) => group.hooks.length > 0);
  if (config.hooks.Stop.length === 0) {
    delete config.hooks.Stop;
  }

  await writeHooksConfig(hooksPath, config);

  if (context.options.json) {
    context.output.json({ ok: true, hooksPath, removed });
    return;
  }

  context.output.info(removed > 0 ? "Removed Codex Voice Stop hook" : "Codex Voice Stop hook was not installed");
}

async function startVoice(context: CommandContext, options: VoiceOptions): Promise<void> {
  const apiKey = process.env[options.apiKeyEnv];
  if (!apiKey) {
    throw new CliError(`${options.apiKeyEnv} is not set. Configure an OpenAI API key before starting Codex Voice.`);
  }

  const clients = new Set<ServerResponse>();
  const cueHistory: VoiceCue[] = [];
  const server = http.createServer(async (request, response) => {
    try {
      await routeRequest(request, response, {
        options,
        apiKey,
        clients,
        cueHistory,
      });
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
  if (context.options.json) {
    context.output.json({ ok: true, url, model: options.model, voice: options.voice });
  } else {
    context.output.info(`Codex Voice listening at ${url}`);
    context.output.info(`Model: ${options.model}`);
    context.output.info(`Voice: ${options.voice}`);
    context.output.info("Send cues with: codex-classroom voice say \"short update\"");
    context.output.info("Press Ctrl+C to stop.");
  }

  if (options.open) {
    openBrowser(url);
  }
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: {
    options: VoiceOptions;
    apiKey: string;
    clients: Set<ServerResponse>;
    cueHistory: VoiceCue[];
  },
): Promise<void> {
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
    state.clients.add(response);
    request.on("close", () => {
      state.clients.delete(response);
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/session") {
    const sdp = await readText(request);
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
    const payload = await readJson(request);
    const cue = normalizeCue(payload);
    state.cueHistory.push(cue);
    for (const client of state.clients) {
      client.write(`event: cue\ndata: ${JSON.stringify(cue)}\n\n`);
    }
    sendJson(response, 200, { ok: true, cue });
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
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
  const kind = isCueKind(first) ? parseCueKind(first) : "note";
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

  const response = await fetch(`http://${options.host}:${options.port}/cue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

async function sendHookStopCue(options: VoiceOptions): Promise<void> {
  const cue: VoiceCue = {
    kind: "verified",
    text: "I finished my response and I am ready for the next instruction.",
    at: new Date().toISOString(),
  };

  await fetch(`http://${options.host}:${options.port}/cue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cue),
  }).catch(() => {
    // Hooks must not block Codex if the sidecar is not running.
  });
}

function isCueKind(value: string | undefined): boolean {
  return (
    value === "note" ||
    value === "started" ||
    value === "changed" ||
    value === "blocked" ||
    value === "verified" ||
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

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
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
      id: "stop-hook",
      status: "warn",
      summary: "Codex Voice Stop hook is not installed",
      fix: "Run codex-classroom voice install-hook, then review it with /hooks in Codex.",
    };
  }

  const config = await readHooksConfig(hooksPath);
  const installed = (config.hooks.Stop ?? []).some((group) =>
    group.hooks.some((hook) => hook.type === "command" && hook.command === CODEX_VOICE_HOOK_COMMAND),
  );
  if (installed) {
    return { id: "stop-hook", status: "ok", summary: `Codex Voice Stop hook is configured in ${hooksPath}` };
  }

  return {
    id: "stop-hook",
    status: "warn",
    summary: "Codex Voice Stop hook is not installed",
    fix: "Run codex-classroom voice install-hook, then review it with /hooks in Codex.",
  };
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
  </main>
  <script>
    const config = ${config};
    let pc;
    let dc;
    let micTrack;
    let connected = false;

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

    function cueLabel(kind) {
      return {
        note: "Classroom note",
        started: "Codex started work",
        changed: "Codex changed something",
        blocked: "Codex hit a blocker",
        verified: "Codex verified the result",
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
      postCue("note", text);
    });
    pauseButton.addEventListener("click", () => postCue("pause", ""));
    resumeButton.addEventListener("click", () => postCue("resume", ""));

    const events = new EventSource("/events");
    events.addEventListener("cue", (event) => sendCueToRealtime(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}

function printVoiceHelp(context: CommandContext): void {
  context.output.info(`codex-classroom voice

Usage:
  codex-classroom voice start [options]
  codex-classroom voice say [kind] <message> [options]
  codex-classroom voice pause [options]
  codex-classroom voice resume [options]
  codex-classroom voice doctor [options]
  codex-classroom voice install-skill [options]
  codex-classroom voice install-hook [options]
  codex-classroom voice uninstall-hook [options]

Voice options:
  --host <host>             Local host to bind or contact (default: 127.0.0.1)
  --port <port>             Local port to bind or contact (default: 17321)
  --model <model>           Realtime model (default: gpt-realtime-2.1-mini)
  --voice <voice>           Realtime voice (default: marin)
  --language <language>     Spoken language (default: Spanish)
  --api-key-env <name>      Environment variable containing the OpenAI API key
  --safety-identifier <id>  Optional stable privacy-preserving safety identifier
  --no-open                 Do not open the browser after starting

Cue kinds:
  note, started, changed, blocked, verified, pause, resume
`);
}
