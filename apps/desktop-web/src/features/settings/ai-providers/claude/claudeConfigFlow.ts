import type { AiAgentInstallStatus, ClaudeProviderMode } from '@shell/integration/desktop-api'

export type ClaudeFlowStepId = 'check' | 'provider' | 'guidance' | 'details' | 'apply'

const PRESET_FLOW: ClaudeFlowStepId[] = ['provider', 'guidance', 'details', 'apply']
const DIRECT_FLOW: ClaudeFlowStepId[] = ['provider', 'details', 'apply']

export function needsClaudeRuntimeCheck(installStatus: AiAgentInstallStatus): boolean {
  return !installStatus.installed || (installStatus.requiresNode && !installStatus.nodeReady)
}

export function resolveClaudeFlowSteps(
  mode: ClaudeProviderMode,
  runtimeCheckRequired: boolean,
): ClaudeFlowStepId[] {
  const steps = mode === 'preset' ? PRESET_FLOW : DIRECT_FLOW
  return runtimeCheckRequired ? ['check', ...steps] : steps
}

export function resolveClaudeEntryStep(
  mode: ClaudeProviderMode,
  runtimeCheckRequired: boolean,
): ClaudeFlowStepId {
  if (runtimeCheckRequired) {
    return 'check'
  }
  return mode === 'preset' ? 'provider' : 'details'
}

export function getPreviousClaudeStep(
  currentStep: ClaudeFlowStepId,
  steps: ClaudeFlowStepId[],
): ClaudeFlowStepId | null {
  const currentIndex = steps.indexOf(currentStep)
  if (currentIndex <= 0) {
    return null
  }
  return steps[currentIndex - 1] ?? null
}

export function getNextClaudeStep(
  currentStep: ClaudeFlowStepId,
  steps: ClaudeFlowStepId[],
): ClaudeFlowStepId | null {
  const currentIndex = steps.indexOf(currentStep)
  if (currentIndex < 0 || currentIndex >= steps.length - 1) {
    return null
  }
  return steps[currentIndex + 1] ?? null
}
