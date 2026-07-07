export type OutputMode = "text" | "json";
export type SetupStatus = "copied" | "created" | "updated" | "exists" | "missing" | "skipped";

export interface GlobalOptions {
  classroomRoot?: string;
  realCodexHome?: string;
  desktopStateHome?: string;
  voiceHost?: string;
  voicePort?: string;
  voiceModel?: string;
  voiceName?: string;
  voiceLanguage?: string;
  voiceApiKeyEnv?: string;
  voiceSafetyIdentifier?: string;
  voiceOpen?: boolean;
  copyAuth?: boolean;
  copyConfig?: boolean;
  copyWindowsSandbox?: boolean;
  windowsSandboxMode?: "elevated" | "unelevated" | "inherit";
  passthrough: string[];
  force: boolean;
  noLaunch: boolean;
  yes: boolean;
  json: boolean;
  plain: boolean;
  verbose: boolean;
  noInput: boolean;
  dryRun: boolean;
}

export interface ProfileManifest {
  name: string;
  description?: string;
  copyAuth: boolean;
  copyConfig: boolean;
  copyWindowsSandbox: boolean;
  windowsSandboxMode: "elevated" | "unelevated" | "inherit";
  features: {
    sessions: "empty";
    automations: "empty";
    plugins: "empty" | "minimal" | "inherit";
    skills: "empty" | "minimal" | "inherit";
  };
}

export interface ProfilePaths {
  profileName: string;
  profileDir: string;
  codexHome: string;
  desktopState: string;
  workspace: string;
  manifest: string;
}

export interface CommandContext {
  options: GlobalOptions;
  output: Output;
  paths: PathContext;
}

export interface PathContext {
  classroomRoot: string;
  realCodexHome: string;
  desktopStateHome: string;
}

export interface Output {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  json(value: unknown): void;
}

export interface DoctorCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  summary: string;
  details?: Record<string, unknown>;
}

export interface ActiveSession {
  schemaVersion: 1;
  profile: string;
  backupId: string;
  startedAt: string;
  classroomRoot: string;
  paths: {
    realCodexHome: string;
    desktopStateHome: string;
    profileCodexHome: string;
    profileDesktopState: string;
    workspace: string;
    backupCodexHome: string;
    backupDesktopState: string;
  };
}

export interface MovePlan {
  label: "codex-home" | "desktop-state";
  target: string;
  profile: string;
  backup: string;
}
