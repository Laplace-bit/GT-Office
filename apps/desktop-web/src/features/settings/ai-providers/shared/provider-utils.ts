import type { AiAgentSnapshotCard } from '@shell/integration/desktop-api'

export type LightAgentId = Exclude<AiAgentSnapshotCard['agent'], 'claude'>
export type LightAgentSnapshotCard = AiAgentSnapshotCard & { agent: LightAgentId }

export function isLightAgentSnapshotCard(
  agent: AiAgentSnapshotCard | null | undefined,
): agent is LightAgentSnapshotCard {
  return agent?.agent === 'codex' || agent?.agent === 'gemini'
}

export function describeUnknownError(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  return String(value)
}

export function resolveEnabledEnhancementCount(agent: AiAgentSnapshotCard): number {
  void agent
  return 0
}
