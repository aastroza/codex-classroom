import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

import type { CommandContext } from "../types.js";
import { CliError } from "../core/errors.js";
import {
  DEFAULT_NARRATOR_API_KEY_ENV,
  DEFAULT_NARRATOR_HOST,
  DEFAULT_NARRATOR_LANGUAGE,
  DEFAULT_NARRATOR_MODEL,
  DEFAULT_NARRATOR_VOICE,
  type NarratorCue,
  buildRealtimeSessionConfig,
  parseCueKind,
  parsePort,
} from "../core/narrator.js";

interface NarratorOptions {
  host: string;
  port: number;
  model: string;
  voice: string;
  language: string;
  apiKeyEnv: string;
  safetyIdentifier?: string;
  open: boolean;
}

export async function narratorCommand(context: CommandContext, args: string[]): Promise<void> {
  const action = args[0] ?? "help";
  const options = getNarratorOptions(context);

  if (action === "help" || action === "--help" || action === "-h") {
    printNarratorHelp(context);
    return;
  }

  if (action === "start") {
    await startNarrator(context, options);
    return;
  }

  if (action === "say") {
    await sendCue(context, options, args.slice(1));
    return;
  }

  if (action === "pause" || action === "resume") {
    await sendCue(context, options, [action]);
    return;
  }

  throw new CliError(`Unknown narrator command: ${action}`);
}

function getNarratorOptions(context: CommandContext): NarratorOptions {
  return {
    host: context.options.narratorHost ?? DEFAULT_NARRATOR_HOST,
    port: parsePort(context.options.narratorPort),
    model: context.options.narratorModel ?? DEFAULT_NARRATOR_MODEL,
    voice: context.options.narratorVoice ?? DEFAULT_NARRATOR_VOICE,
    language: context.options.narratorLanguage ?? DEFAULT_NARRATOR_LANGUAGE,
    apiKeyEnv: context.options.narratorApiKeyEnv ?? DEFAULT_NARRATOR_API_KEY_ENV,
    safetyIdentifier: context.options.narratorSafetyIdentifier,
    open: context.options.narratorOpen ?? true,
  };
}

async function startNarrator(context: CommandContext, options: NarratorOptions): Promise<void> {
  const apiKey = process.env[options.apiKeyEnv];
  if (!apiKey) {
    throw new CliError(`${options.apiKeyEnv} is not set. Configure an OpenAI API key before starting live narration.`);
  }

  const clients = new Set<ServerResponse>();
  const cueHistory: NarratorCue[] = [];
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
    context.output.info(`Live narrator listening at ${url}`);
    context.output.info(`Model: ${options.model}`);
    context.output.info(`Voice: ${options.voice}`);
    context.output.info("Send cues with: codex-classroom narrator say \"short update\"");
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
    options: NarratorOptions;
    apiKey: string;
    clients: Set<ServerResponse>;
    cueHistory: NarratorCue[];
  },
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    sendHtml(response, renderNarratorPage(state.options));
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
  options: NarratorOptions;
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

async function sendCue(context: CommandContext, options: NarratorOptions, args: string[]): Promise<void> {
  const first = args[0];
  const kind = isCueKind(first) ? parseCueKind(first) : "note";
  const textArgs = isCueKind(first) ? args.slice(1) : args;
  const text = textArgs.join(" ").trim();

  if (!text && kind !== "pause" && kind !== "resume") {
    throw new CliError("narrator say requires a short message.");
  }

  const cue: NarratorCue = {
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
      `Could not reach live narrator at ${options.host}:${options.port}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });

  if (!response.ok) {
    throw new CliError(`Live narrator rejected the cue: ${await response.text()}`);
  }

  if (context.options.json) {
    context.output.json({ ok: true, cue });
  } else {
    context.output.info(`Sent ${kind} cue.`);
  }
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

function normalizeCue(payload: unknown): NarratorCue {
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

function renderNarratorPage(options: NarratorOptions): string {
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
  <title>Codex Classroom Narrator</title>
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
        <h1>Codex Classroom Narrator</h1>
        <p>Keep this tab open during class. The browser handles microphone and speaker audio; the local CLI only routes cues.</p>
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
        <p>Send one short update to the voice narrator.</p>
        <textarea id="manualCue" placeholder="Codex just found the failing test and is narrowing the fix."></textarea>
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
    document.getElementById("sessionConfig").textContent = config.model + " · " + config.voice + " · " + config.language;

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
        ? "Pause classroom narration now. Stay silent until a resume cue or teacher request."
        : cue.kind === "resume"
          ? "Resume classroom narration. Say one brief sentence that you are ready to continue."
          : cueLabel(cue.kind) + ": " + cue.text + "\\n\\nSay one short classroom-friendly sentence about this. If the teacher appears to be speaking, wait for a natural pause.";

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
        response: { modalities: ["audio", "text"] },
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
      meta.textContent = new Date().toLocaleTimeString() + " · " + kind;
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

function printNarratorHelp(context: CommandContext): void {
  context.output.info(`codex-classroom narrator

Usage:
  codex-classroom narrator start [options]
  codex-classroom narrator say [kind] <message> [options]
  codex-classroom narrator pause [options]
  codex-classroom narrator resume [options]

Narrator options:
  --host <host>             Local host to bind or contact (default: 127.0.0.1)
  --port <port>             Local port to bind or contact (default: 17321)
  --model <model>           Realtime model (default: gpt-realtime-2.1-mini)
  --voice <voice>           Realtime voice (default: marin)
  --language <language>     Narration language (default: Spanish)
  --api-key-env <name>      Environment variable containing the OpenAI API key
  --safety-identifier <id>  Optional stable privacy-preserving safety identifier
  --no-open                 Do not open the browser after starting

Cue kinds:
  note, started, changed, blocked, verified, pause, resume
`);
}
