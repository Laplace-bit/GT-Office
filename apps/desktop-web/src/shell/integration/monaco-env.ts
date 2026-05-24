let monacoEnvReady: Promise<void> | null = null

export function ensureMonacoEnvironment(): Promise<void> {
  if (!monacoEnvReady) {
    monacoEnvReady = import('./monaco-env.impl.js').then(() => undefined)
  }
  return monacoEnvReady
}
