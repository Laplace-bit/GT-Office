// Re-export types for backward compatibility
export type { GitFileFilter, GitDiffScope, GitGraphCommitView, GitWorkspaceController, UseGitWorkspaceControllerInput } from './controllers/types'
export { ROW_HEIGHT, OVERSCAN_ROWS, formatGitTimestamp } from './controllers/types'

// Delegate to the composed controller
export { useGitController as useGitWorkspaceController } from './controllers/useGitController'
