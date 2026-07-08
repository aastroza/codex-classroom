import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { mapAppServerEvent, type MappedAppServerEvent } from "./event-mapper.js";
import { createClassroomMapper, type ClassroomMapper } from "./classroom.js";

export interface AppServerClientOptions {
  command?: string;
  args?: string[];
}

export interface AppServerInitializeResult {
  userAgent?: string;
  codexHome?: string;
  platformFamily?: string;
  platformOs?: string;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class AppServerClient {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Set<(event: MappedAppServerEvent) => void>();
  private mapper: ClassroomMapper = createClassroomMapper();

  constructor(private readonly options: AppServerClientOptions = {}) {}

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server", "--stdio"];
    this.child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (${signal ?? code ?? "unknown"})`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.child = undefined;
    });

    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.child = undefined;
    });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      this.handleLine(line);
    });
  }

  async initialize(): Promise<AppServerInitializeResult> {
    const result = await this.request("initialize", {
      clientInfo: {
        name: "codex_classroom",
        title: "Codex Classroom",
        version: "0.7.1",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/textDelta",
          "command/exec/outputDelta",
          "process/outputDelta",
          "item/commandExecution/outputDelta",
        ],
      },
    });
    this.notify("initialized", {});
    return asInitializeResult(result);
  }

  onMappedEvent(handler: (event: MappedAppServerEvent) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  async loadedThreads(): Promise<unknown> {
    return await this.request("thread/loaded/list", {});
  }

  async resumeThread(threadId: string): Promise<unknown> {
    return await this.request("thread/resume", {
      threadId,
      initialTurnsPage: {
        limit: 20,
        sortDirection: "desc",
        itemsView: "full",
      },
    });
  }

  async readThread(threadId: string): Promise<unknown> {
    return await this.request("thread/read", { threadId, includeTurns: true });
  }

  async request(method: string, params: unknown): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child) {
      throw new Error("codex app-server is not running.");
    }

    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
    return await result;
  }

  notify(method: string, params: unknown): void {
    const child = this.child;
    if (!child) {
      return;
    }
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    const id = typeof message.id === "number" ? message.id : undefined;
    if (id !== undefined && this.pending.has(id)) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      if (!pending) {
        return;
      }
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    const mapped = mapAppServerEvent(message);
    if (mapped) {
      if (mapped.raw) {
        const moments = this.mapper.ingest(mapped.raw);
        mapped.moment = moments.at(-1);
      }
      for (const handler of this.notificationHandlers) {
        handler(mapped);
      }
    }
  }
}

export async function checkAppServerAvailable(timeoutMs = 3000): Promise<AppServerInitializeResult> {
  const client = new AppServerClient();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timed out waiting for codex app-server.")), timeoutMs).unref();
  });
  try {
    await client.start();
    return await Promise.race([client.initialize(), timeout]);
  } finally {
    client.stop();
  }
}

function asInitializeResult(value: unknown): AppServerInitializeResult {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    userAgent: typeof record.userAgent === "string" ? record.userAgent : undefined,
    codexHome: typeof record.codexHome === "string" ? record.codexHome : undefined,
    platformFamily: typeof record.platformFamily === "string" ? record.platformFamily : undefined,
    platformOs: typeof record.platformOs === "string" ? record.platformOs : undefined,
  };
}
