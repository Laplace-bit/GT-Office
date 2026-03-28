export interface DirectoryBackend {
  snapshot<T>(params: { workspaceId: string }): Promise<T>
}

export function createDirectoryCommands(backend: DirectoryBackend) {
  return {
    snapshot<T>(params: { workspaceId: string }) {
      return backend.snapshot<T>(params)
    },
  }
}
