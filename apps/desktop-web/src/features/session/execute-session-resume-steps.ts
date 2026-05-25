import type { SessionResumeCheckResponse } from '@shell/integration/desktop-api'

export interface SessionResumeStepHandlers {
  startCli: (command: string) => Promise<boolean>
  waitMs: (ms: number) => Promise<void>
  injectCommand: (command: string) => Promise<boolean>
  injectSubmit: (text: string) => Promise<boolean>
}

export async function executeSessionResumeSteps(
  steps: SessionResumeCheckResponse['steps'],
  handlers: SessionResumeStepHandlers,
): Promise<boolean> {
  for (const step of steps) {
    if ('startCli' in step) {
      if (!(await handlers.startCli(step.startCli.command))) {
        return false
      }
      continue
    }
    if ('waitMs' in step) {
      await handlers.waitMs(step.waitMs.ms)
      continue
    }
    if ('injectCommand' in step) {
      if (!(await handlers.injectCommand(step.injectCommand.command))) {
        return false
      }
      continue
    }
    if ('injectSubmit' in step) {
      if (!(await handlers.injectSubmit(step.injectSubmit.text))) {
        return false
      }
    }
  }
  return true
}
