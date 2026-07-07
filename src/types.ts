export type OutputMode = "text" | "json";

export interface GlobalOptions {
  classroomRoot?: string;
  realCodexHome?: string;
  copyAuth?: boolean;
  copyConfig?: boolean;
  passthrough: string[];
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
