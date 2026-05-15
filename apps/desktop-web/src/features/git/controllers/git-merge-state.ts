import type {
  GitConflictFile,
  GitMergeResult,
  GitMergeStateResponse,
} from '@shell/integration/desktop-api'

export interface GitMergeUiState {
  isMerging: boolean
  mergeConflicts: GitConflictFile[]
}

export const IDLE_GIT_MERGE_UI_STATE: GitMergeUiState = {
  isMerging: false,
  mergeConflicts: [],
}

export function resolveGitMergeUiStateFromStartMergeResult(
  result: GitMergeResult,
): GitMergeUiState {
  if (result.success) {
    return IDLE_GIT_MERGE_UI_STATE
  }
  return {
    isMerging: true,
    mergeConflicts: result.conflicts,
  }
}

export function resolveGitMergeUiStateFromMergeStateResponse(
  response: GitMergeStateResponse,
): GitMergeUiState {
  if (!response.inProgress) {
    return IDLE_GIT_MERGE_UI_STATE
  }
  return {
    isMerging: true,
    mergeConflicts: response.conflicts,
  }
}
