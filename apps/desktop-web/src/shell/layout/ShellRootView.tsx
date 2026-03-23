import type {
  ComponentProps,
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  RefObject,
} from 'react'
import { FileEditorPane, FileTreePane } from '@features/file-explorer'
import { GitHistoryPane, GitOperationsPane } from '@features/git'
import { GlobalTaskDispatchOverlay, TaskCenterPane } from '@features/task-center'
import { SettingsModal } from '@features/settings'
import { ChannelStudio, CommunicationChannelsPane } from '@features/tool-adapter'
import { StationManageModal, StationSearchModal, WorkbenchCanvas } from '@features/workspace-hub'
import { StationOverviewPane } from '@features/workspace'
import { NotificationList } from '../../components/notification/NotificationList'
import { t, type Locale } from '../i18n/ui-locale'
import { LEFT_PANE_WIDTH_MAX, LEFT_PANE_WIDTH_MIN, type TelegramInboundDebugToast } from './ShellRoot.shared'
import { ActivityRail } from './ActivityRail'
import { LeftBusinessPane } from './LeftBusinessPane'
import { StatusBar } from './StatusBar'
import { TopControlBar } from './TopControlBar'
import type { NavItemId, PaneModel } from './navigation-model'

interface ShellRootViewProps {
  shellContainerRef: RefObject<HTMLDivElement | null>
  shellTopRef: RefObject<HTMLDivElement | null>
  shellMainRef: RefObject<HTMLElement | null>
  shellStatusRef: RefObject<HTMLDivElement | null>
  shellRailRef: RefObject<HTMLDivElement | null>
  shellLeftPaneRef: RefObject<HTMLDivElement | null>
  shellResizerRef: RefObject<HTMLDivElement | null>
  shellMainPaneRef: RefObject<HTMLDivElement | null>
  nativeWindowTopWindows: boolean
  locale: Locale
  topControlBarProps: ComponentProps<typeof TopControlBar>
  telegramDebugToast: TelegramInboundDebugToast | null
  onDismissTelegramDebugToast: () => void
  shellMainStyle: CSSProperties
  activityRailProps: ComponentProps<typeof ActivityRail>
  activeNavId: NavItemId
  leftPaneVisible: boolean
  leftPaneResizing: boolean
  leftPaneWidth: number
  onLeftPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onLeftPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  fileTreePaneProps: ComponentProps<typeof FileTreePane>
  taskCenterPaneProps: ComponentProps<typeof TaskCenterPane>
  stationOverviewPaneProps: ComponentProps<typeof StationOverviewPane>
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
  topmostWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  statusBarProps: ComponentProps<typeof StatusBar>
  globalTaskDispatchOverlayProps: ComponentProps<typeof GlobalTaskDispatchOverlay>
  settingsModalProps: ComponentProps<typeof SettingsModal>
  stationManageModalProps: ComponentProps<typeof StationManageModal>
  channelStudioProps: ComponentProps<typeof ChannelStudio>
  stationSearchModalProps: ComponentProps<typeof StationSearchModal>
}

interface TelegramDebugToastCardProps {
  locale: Locale
  toast: TelegramInboundDebugToast
  onDismiss: () => void
}

function TelegramDebugToastCard({ locale, toast, onDismiss }: TelegramDebugToastCardProps) {
  return (
    <section className="telegram-debug-toast" role="status" aria-live="polite">
      <header className="telegram-debug-toast-header">
        <strong>{t(locale, 'channel.telegram.debugToast.title')}</strong>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t(locale, 'channel.telegram.debugToast.dismiss')}
        >
          ×
        </button>
      </header>
      <p>
        {t(locale, 'channel.telegram.debugToast.sender', {
          sender: toast.senderName || toast.senderId,
        })}
      </p>
      <p>
        {t(locale, 'channel.telegram.debugToast.peer', {
          peer: toast.peerId,
        })}
      </p>
      <p>
        {t(locale, 'channel.telegram.debugToast.message', {
          message: toast.messageId,
        })}
      </p>
      <p>
        {t(locale, 'channel.telegram.debugToast.content', {
          content: toast.text || t(locale, 'channel.telegram.debugToast.empty'),
        })}
      </p>
      <p>
        {t(locale, 'channel.telegram.debugToast.account', {
          account: toast.accountId,
        })}
      </p>
      <p className="telegram-debug-toast-time">
        {new Date(toast.receivedAtMs).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
          hour12: false,
        })}
      </p>
    </section>
  )
}

interface ShellLeftPaneContentProps {
  activeNavId: NavItemId
  fileTreePaneProps: ComponentProps<typeof FileTreePane>
  taskCenterPaneProps: ComponentProps<typeof TaskCenterPane>
  stationOverviewPaneProps: ComponentProps<typeof StationOverviewPane>
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
}

function ShellLeftPaneContent({
  activeNavId,
  fileTreePaneProps,
  taskCenterPaneProps,
  stationOverviewPaneProps,
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  activePaneModel,
}: ShellLeftPaneContentProps) {
  if (activeNavId === 'files') {
    return <FileTreePane {...fileTreePaneProps} />
  }
  if (activeNavId === 'tasks') {
    return (
      <div className="task-center-scroll-host">
        <TaskCenterPane {...taskCenterPaneProps} />
      </div>
    )
  }
  if (activeNavId === 'stations') {
    return <StationOverviewPane {...stationOverviewPaneProps} />
  }
  if (activeNavId === 'git') {
    return <GitOperationsPane {...gitOperationsPaneProps} />
  }
  if (activeNavId === 'channels') {
    return <CommunicationChannelsPane {...communicationChannelsPaneProps} />
  }
  return <LeftBusinessPane model={activePaneModel} />
}

interface ShellMainPaneContentProps {
  activeNavId: NavItemId
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
}

function ShellMainPaneContent({
  activeNavId,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
}: ShellMainPaneContentProps) {
  return (
    <>
      {showWorkbenchCanvas ? (
        <div className="shell-main-view">
          <WorkbenchCanvas {...workbenchCanvasProps} />
        </div>
      ) : null}

      {activeNavId === 'files' ? (
        <div className="shell-feature-view">
          <FileEditorPane {...fileEditorPaneProps} />
        </div>
      ) : null}

      {activeNavId === 'git' ? (
        <div className="shell-feature-view">
          <GitHistoryPane {...gitHistoryPaneProps} />
        </div>
      ) : null}
    </>
  )
}

interface ShellRootOverlaysProps {
  globalTaskDispatchOverlayProps: ComponentProps<typeof GlobalTaskDispatchOverlay>
  settingsModalProps: ComponentProps<typeof SettingsModal>
  stationManageModalProps: ComponentProps<typeof StationManageModal>
  channelStudioProps: ComponentProps<typeof ChannelStudio>
  stationSearchModalProps: ComponentProps<typeof StationSearchModal>
}

function ShellRootOverlays({
  globalTaskDispatchOverlayProps,
  settingsModalProps,
  stationManageModalProps,
  channelStudioProps,
  stationSearchModalProps,
}: ShellRootOverlaysProps) {
  return (
    <>
      <GlobalTaskDispatchOverlay {...globalTaskDispatchOverlayProps} />
      <SettingsModal {...settingsModalProps} />
      <StationManageModal {...stationManageModalProps} />
      <ChannelStudio {...channelStudioProps} />
      <StationSearchModal {...stationSearchModalProps} />
      <NotificationList />
    </>
  )
}

export function ShellRootView({
  shellContainerRef,
  shellTopRef,
  shellMainRef,
  shellStatusRef,
  shellRailRef,
  shellLeftPaneRef,
  shellResizerRef,
  shellMainPaneRef,
  nativeWindowTopWindows,
  locale,
  topControlBarProps,
  telegramDebugToast,
  onDismissTelegramDebugToast,
  shellMainStyle,
  activityRailProps,
  activeNavId,
  leftPaneVisible,
  leftPaneResizing,
  leftPaneWidth,
  onLeftPaneResizePointerDown,
  onLeftPaneResizeKeyDown,
  fileTreePaneProps,
  taskCenterPaneProps,
  stationOverviewPaneProps,
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  activePaneModel,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
  topmostWorkbenchCanvasProps,
  statusBarProps,
  globalTaskDispatchOverlayProps,
  settingsModalProps,
  stationManageModalProps,
  channelStudioProps,
  stationSearchModalProps,
}: ShellRootViewProps) {
  return (
    <div
      ref={shellContainerRef}
      className={`agent-shell ${
        nativeWindowTopWindows ? 'shell-native-window-top-windows' : ''
      }`}
    >
      <div ref={shellTopRef} className="shell-top-slot">
        <TopControlBar {...topControlBarProps} />
        {telegramDebugToast ? (
          <TelegramDebugToastCard
            locale={locale}
            toast={telegramDebugToast}
            onDismiss={onDismissTelegramDebugToast}
          />
        ) : null}
      </div>

      <main ref={shellMainRef} className="shell-main-layout relative z-10" style={shellMainStyle}>
        <div ref={shellRailRef} className="shell-rail-slot">
          <ActivityRail {...activityRailProps} />
        </div>

        {leftPaneVisible ? (
          <div
            ref={shellLeftPaneRef}
            className={`shell-pane-shell shell-left-pane ${activeNavId === 'tasks' ? 'is-task-center' : ''}`}
          >
            <ShellLeftPaneContent
              activeNavId={activeNavId}
              fileTreePaneProps={fileTreePaneProps}
              taskCenterPaneProps={taskCenterPaneProps}
              stationOverviewPaneProps={stationOverviewPaneProps}
              gitOperationsPaneProps={gitOperationsPaneProps}
              communicationChannelsPaneProps={communicationChannelsPaneProps}
              activePaneModel={activePaneModel}
            />
          </div>
        ) : null}

        {leftPaneVisible ? (
          <div
            ref={shellResizerRef}
            className={`shell-column-resizer ${leftPaneResizing ? 'active' : ''}`}
            role="separator"
            aria-label="Resize left panel"
            aria-orientation="vertical"
            aria-valuemin={LEFT_PANE_WIDTH_MIN}
            aria-valuemax={LEFT_PANE_WIDTH_MAX}
            aria-valuenow={leftPaneWidth}
            tabIndex={0}
            onPointerDown={onLeftPaneResizePointerDown}
            onKeyDown={onLeftPaneResizeKeyDown}
          />
        ) : null}

        <div ref={shellMainPaneRef} className="shell-pane-shell shell-main-pane">
          <ShellMainPaneContent
            activeNavId={activeNavId}
            showWorkbenchCanvas={showWorkbenchCanvas}
            workbenchCanvasProps={workbenchCanvasProps}
            fileEditorPaneProps={fileEditorPaneProps}
            gitHistoryPaneProps={gitHistoryPaneProps}
          />
        </div>
      </main>

      {topmostWorkbenchCanvasProps ? <WorkbenchCanvas {...topmostWorkbenchCanvasProps} /> : null}

      <div ref={shellStatusRef} className="relative z-10">
        <StatusBar {...statusBarProps} />
      </div>

      <ShellRootOverlays
        globalTaskDispatchOverlayProps={globalTaskDispatchOverlayProps}
        settingsModalProps={settingsModalProps}
        stationManageModalProps={stationManageModalProps}
        channelStudioProps={channelStudioProps}
        stationSearchModalProps={stationSearchModalProps}
      />
    </div>
  )
}
