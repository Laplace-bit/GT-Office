import type { SessionProvider } from '@shell/integration/desktop-api'

/** Matches `gt-agent-session::SessionRelaunchMode` / `session_resume_check` relaunch_mode. */
export type SessionRelaunchMode = 'resume' | 'continueLast' | 'fork' | 'forkLast'

export interface SessionRelaunchRequest {
  mode: SessionRelaunchMode
  /** Required for `resume` and `fork`; omitted for `continueLast` / `forkLast`. */
  gtoSessionId?: string
  /** Provider session id from card scan (Claude jsonl stem / Codex rollout id). */
  providerSessionId?: string | null
  /** Working directory from registry; avoids an extra `session_get` IPC round-trip. */
  cwd?: string | null
}

/** Build provider CLI launch command locally (same rules as `gt-agent-session` resume.rs). */
export function buildSessionRelaunchLaunchCommand(
  mode: SessionRelaunchMode,
  provider: SessionProvider,
  providerSessionId?: string | null,
): string {
  const id = providerSessionId?.trim() || null

  switch (mode) {
    case 'continueLast':
      return provider === 'claude' ? 'claude --continue' : 'codex resume --last'
    case 'forkLast':
      return provider === 'claude' ? 'claude --fork-session --continue' : 'codex fork --last'
    case 'fork':
      if (provider === 'claude') {
        return id ? `claude --fork-session --resume ${id}` : 'claude --fork-session --continue'
      }
      return id ? `codex fork ${id}` : 'codex fork --last'
    case 'resume':
    default:
      if (provider === 'claude') {
        return id ? `claude --resume ${id}` : 'claude --continue'
      }
      return id ? `codex resume ${id}` : 'codex resume --last'
  }
}
