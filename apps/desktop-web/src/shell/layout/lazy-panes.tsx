import { lazy } from 'react'

export const LazyWorkbenchCanvas = lazy(() =>
  import('@features/workspace-hub/WorkbenchCanvas').then((module) => ({
    default: module.WorkbenchCanvas,
  })),
)

export const LazyFileEditorPane = lazy(() =>
  import('@features/file-explorer/FileEditorPane').then((module) => ({
    default: module.FileEditorPane,
  })),
)

export const LazyFileTreePane = lazy(() =>
  import('@features/file-explorer/FileTreePane').then((module) => ({
    default: module.FileTreePane,
  })),
)

export const LazyGlobalFileSearchModal = lazy(() =>
  import('@features/file-explorer/GlobalFileSearchModal').then((module) => ({
    default: module.GlobalFileSearchModal,
  })),
)

export const LazyGitHistoryPane = lazy(() =>
  import('@features/git/components/GitHistoryPane').then((module) => ({
    default: module.GitHistoryPane,
  })),
)

export const LazyGitOperationsPane = lazy(() =>
  import('@features/git/components/GitOperationsPane').then((module) => ({
    default: module.GitOperationsPane,
  })),
)

export const LazyTaskCenterPane = lazy(() =>
  import('@features/task-center/TaskCenterPane').then((module) => ({
    default: module.TaskCenterPane,
  })),
)

export const LazySettingsModal = lazy(() =>
  import('@features/settings/SettingsModal').then((module) => ({
    default: module.SettingsModal,
  })),
)

export const LazyChannelStudio = lazy(() =>
  import('@features/tool-adapter/ChannelStudio').then((module) => ({
    default: module.ChannelStudio,
  })),
)

export const LazyCommunicationChannelsPane = lazy(() =>
  import('@features/tool-adapter/CommunicationChannelsPane').then((module) => ({
    default: module.CommunicationChannelsPane,
  })),
)

export const LazyStationManageModal = lazy(() =>
  import('@features/workspace-hub/StationManageModal').then((module) => ({
    default: module.StationManageModal,
  })),
)

export const LazyStationSearchModal = lazy(() =>
  import('@features/workspace-hub/StationSearchModal').then((module) => ({
    default: module.StationSearchModal,
  })),
)

export const LazyGlobalTaskDispatchOverlay = lazy(() =>
  import('@features/task-center/GlobalTaskDispatchOverlay').then((module) => ({
    default: module.GlobalTaskDispatchOverlay,
  })),
)

export function PaneLoadingFallback() {
  return <div className="shell-pane-loading" aria-hidden="true" />
}
