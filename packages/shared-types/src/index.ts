export type WorkspaceId = string;
export type TerminalSessionId = string;

export interface ResultEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  traceId: string;
}

export interface WorkspaceContext {
  workspaceId: WorkspaceId;
  root: string;
  permissions: Record<string, unknown>;
  terminalDefaultCwd: "workspace_root" | "custom";
}
