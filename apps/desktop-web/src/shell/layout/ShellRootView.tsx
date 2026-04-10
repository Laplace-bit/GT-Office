import type {
  ComponentProps,
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  RefObject,
} from 'react'
import { FileEditorPane, FileTreePane, GlobalFileSearchModal } from '@features/file-explorer'
import { GitHistoryPane, GitOperationsPane } from '@features/git'
import { GlobalTaskDispatchOverlay, TaskCenterPane } from '@features/task-center'
import { SettingsModal } from '@features/settings'
import { ChannelStudio, CommunicationChannelsPane } from '@features/tool-adapter'
import { StationManageModal, StationSearchModal, WorkbenchCanvas } from '@features/workspace-hub'
import { StationOverviewPane } from '@features/workspace'
import { NotificationList } from '../../components/notification/NotificationList'
import { t, type Locale } from '../i18n/ui-locale'
import {
  LEFT_PANE_WIDTH_MIN,
  RIGHT_PANE_WIDTH_MIN,
  type TelegramInboundDebugToast,
} from './ShellRoot.shared'
import { ActivityRail } from './ActivityRail'
import { LeftBusinessPane } from './LeftBusinessPane'
import { resolveLeftPaneSlotClassName } from './left-pane-layout'
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
  rightPaneResizing: boolean
  leftPaneWidth: number
  leftPaneWidthMax: number
  rightPaneWidth: number
  rightPaneWidthMax: number
  onLeftPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onLeftPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  onRightPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onRightPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  fileTreePaneProps: ComponentProps<typeof FileTreePane>
  taskCenterPaneProps: ComponentProps<typeof TaskCenterPane>
  stationOverviewPaneProps: ComponentProps<typeof StationOverviewPane>
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  pinnedWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
  topmostWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  statusBarProps: ComponentProps<typeof StatusBar>
  globalTaskDispatchOverlayProps: ComponentProps<typeof GlobalTaskDispatchOverlay>
  settingsModalProps: ComponentProps<typeof SettingsModal>
  stationManageModalProps: ComponentProps<typeof StationManageModal>
  channelStudioProps: ComponentProps<typeof ChannelStudio>
  stationSearchModalProps: ComponentProps<typeof StationSearchModal>
  globalFileSearchModalProps: ComponentProps<typeof GlobalFileSearchModal>
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
  const showFileTree = activeNavId === 'files'
  const fileTreeSlotClassName = resolveLeftPaneSlotClassName(showFileTree)

  const secondaryPane = (() => {
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
  })()

  return (
    <div key={activeNavId} className="shell-left-pane-transition">
      <div className={fileTreeSlotClassName} aria-hidden={!showFileTree}>
        <FileTreePane {...fileTreePaneProps} />
      </div>
      {showFileTree ? null : <div className="shell-left-pane-slot">{secondaryPane}</div>}
    </div>
  )
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
  if (showWorkbenchCanvas) {
    return (
      <div key={activeNavId} className="shell-main-view shell-pane-transition">
        <WorkbenchCanvas {...workbenchCanvasProps} />
      </div>
    )
  }

  if (activeNavId === 'files') {
    return (
      <div key="files" className="shell-feature-view shell-pane-transition">
        <FileEditorPane {...fileEditorPaneProps} />
      </div>
    )
  }

  if (activeNavId === 'git') {
    return (
      <div key="git" className="shell-feature-view shell-pane-transition">
        <GitHistoryPane {...gitHistoryPaneProps} />
      </div>
    )
  }

  return <div key="empty" className="shell-feature-view shell-pane-transition" />
}

interface ShellWorkspaceContentProps {
  activeNavId: NavItemId
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
}

function ShellWorkspaceContent({
  activeNavId,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
}: ShellWorkspaceContentProps) {
  return (
    <div className="shell-pane-shell shell-main-pane">
      <ShellMainPaneContent
        activeNavId={activeNavId}
        showWorkbenchCanvas={showWorkbenchCanvas}
        workbenchCanvasProps={workbenchCanvasProps}
        fileEditorPaneProps={fileEditorPaneProps}
        gitHistoryPaneProps={gitHistoryPaneProps}
      />
    </div>
  )
}

interface ShellMainAreaProps {
  shellMainPaneRef: RefObject<HTMLDivElement | null>
  activeNavId: NavItemId
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  pinnedWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  rightPaneResizing: boolean
  rightPaneWidth: number
  rightPaneWidthMax: number
  onRightPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onRightPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
}

function ShellMainArea({
  shellMainPaneRef,
  activeNavId,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  pinnedWorkbenchCanvasProps,
  rightPaneResizing,
  rightPaneWidth,
  rightPaneWidthMax,
  onRightPaneResizePointerDown,
  onRightPaneResizeKeyDown,
  fileEditorPaneProps,
  gitHistoryPaneProps,
}: ShellMainAreaProps) {
  return (
    <div ref={shellMainPaneRef} className="shell-main-content">
      <ShellWorkspaceContent
        activeNavId={activeNavId}
        showWorkbenchCanvas={showWorkbenchCanvas}
        workbenchCanvasProps={workbenchCanvasProps}
        fileEditorPaneProps={fileEditorPaneProps}
        gitHistoryPaneProps={gitHistoryPaneProps}
      />
      {pinnedWorkbenchCanvasProps ? (
        <div
          className={`shell-column-resizer shell-right-pane-resizer ${rightPaneResizing ? 'active' : ''}`}
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          aria-valuemin={RIGHT_PANE_WIDTH_MIN}
          aria-valuemax={rightPaneWidthMax}
          aria-valuenow={rightPaneWidth}
          tabIndex={0}
          onPointerDown={onRightPaneResizePointerDown}
          onKeyDown={onRightPaneResizeKeyDown}
        />
      ) : null}
    </div>
  )
}

interface ShellMainLayoutProps {
  shellRailRef: RefObject<HTMLDivElement | null>
  shellLeftPaneRef: RefObject<HTMLDivElement | null>
  shellResizerRef: RefObject<HTMLDivElement | null>
  shellMainPaneRef: RefObject<HTMLDivElement | null>
  activityRailProps: ComponentProps<typeof ActivityRail>
  activeNavId: NavItemId
  leftPaneVisible: boolean
  leftPaneResizing: boolean
  rightPaneResizing: boolean
  leftPaneWidth: number
  leftPaneWidthMax: number
  rightPaneWidth: number
  rightPaneWidthMax: number
  onLeftPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onLeftPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  onRightPaneResizePointerDown: PointerEventHandler<HTMLDivElement>
  onRightPaneResizeKeyDown: KeyboardEventHandler<HTMLDivElement>
  fileTreePaneProps: ComponentProps<typeof FileTreePane>
  taskCenterPaneProps: ComponentProps<typeof TaskCenterPane>
  stationOverviewPaneProps: ComponentProps<typeof StationOverviewPane>
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  pinnedWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
}

function ShellMainLayout({
  shellRailRef,
  shellLeftPaneRef,
  shellResizerRef,
  shellMainPaneRef,
  activityRailProps,
  activeNavId,
  leftPaneVisible,
  leftPaneResizing,
  rightPaneResizing,
  leftPaneWidth,
  leftPaneWidthMax,
  rightPaneWidth,
  rightPaneWidthMax,
  onLeftPaneResizePointerDown,
  onLeftPaneResizeKeyDown,
  onRightPaneResizePointerDown,
  onRightPaneResizeKeyDown,
  fileTreePaneProps,
  taskCenterPaneProps,
  stationOverviewPaneProps,
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  activePaneModel,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  pinnedWorkbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
}: ShellMainLayoutProps) {
  return (
    <>
      <div ref={shellRailRef} className="shell-rail-slot">
        <ActivityRail {...activityRailProps} />
      </div>

      <div
        ref={shellLeftPaneRef}
        className={`shell-pane-shell shell-left-pane ${activeNavId === 'tasks' ? 'is-task-center' : ''} ${!leftPaneVisible ? 'shell-left-pane--collapsed' : 'shell-left-pane--visible'}`}
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

      <div
        ref={shellResizerRef}
        className={`shell-column-resizer ${leftPaneResizing ? 'active' : ''} ${!leftPaneVisible ? 'shell-column-resizer--collapsed' : ''}`}
        role="separator"
        aria-label="Resize left panel"
        aria-orientation="vertical"
        aria-valuemin={LEFT_PANE_WIDTH_MIN}
        aria-valuemax={leftPaneWidthMax}
        aria-valuenow={leftPaneWidth}
        tabIndex={0}
        onPointerDown={onLeftPaneResizePointerDown}
        onKeyDown={onLeftPaneResizeKeyDown}
      />

      <ShellMainArea
        shellMainPaneRef={shellMainPaneRef}
        activeNavId={activeNavId}
        showWorkbenchCanvas={showWorkbenchCanvas}
        workbenchCanvasProps={workbenchCanvasProps}
        pinnedWorkbenchCanvasProps={pinnedWorkbenchCanvasProps}
        rightPaneResizing={rightPaneResizing}
        rightPaneWidth={rightPaneWidth}
        rightPaneWidthMax={rightPaneWidthMax}
        onRightPaneResizePointerDown={onRightPaneResizePointerDown}
        onRightPaneResizeKeyDown={onRightPaneResizeKeyDown}
        fileEditorPaneProps={fileEditorPaneProps}
        gitHistoryPaneProps={gitHistoryPaneProps}
      />
      {pinnedWorkbenchCanvasProps ? (
        <div className="shell-pane-shell shell-right-pane">
          <WorkbenchCanvas {...pinnedWorkbenchCanvasProps} />
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
  globalFileSearchModalProps: ComponentProps<typeof GlobalFileSearchModal>
}

function ShellRootOverlays({
  globalTaskDispatchOverlayProps,
  settingsModalProps,
  stationManageModalProps,
  channelStudioProps,
  stationSearchModalProps,
  globalFileSearchModalProps,
}: ShellRootOverlaysProps) {
  return (
    <>
      <GlobalTaskDispatchOverlay {...globalTaskDispatchOverlayProps} />
      <SettingsModal {...settingsModalProps} />
      <StationManageModal {...stationManageModalProps} />
      <ChannelStudio {...channelStudioProps} />
      <StationSearchModal {...stationSearchModalProps} />
      <GlobalFileSearchModal {...globalFileSearchModalProps} />
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
  rightPaneResizing,
  leftPaneWidth,
  leftPaneWidthMax,
  rightPaneWidth,
  rightPaneWidthMax,
  onLeftPaneResizePointerDown,
  onLeftPaneResizeKeyDown,
  onRightPaneResizePointerDown,
  onRightPaneResizeKeyDown,
  fileTreePaneProps,
  taskCenterPaneProps,
  stationOverviewPaneProps,
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  activePaneModel,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  pinnedWorkbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
  topmostWorkbenchCanvasProps,
  statusBarProps,
  globalTaskDispatchOverlayProps,
  settingsModalProps,
  stationManageModalProps,
  channelStudioProps,
  stationSearchModalProps,
  globalFileSearchModalProps,
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
        <ShellMainLayout
          shellRailRef={shellRailRef}
          shellLeftPaneRef={shellLeftPaneRef}
          shellResizerRef={shellResizerRef}
          shellMainPaneRef={shellMainPaneRef}
          activityRailProps={activityRailProps}
          activeNavId={activeNavId}
          leftPaneVisible={leftPaneVisible}
          leftPaneResizing={leftPaneResizing}
          rightPaneResizing={rightPaneResizing}
          leftPaneWidth={leftPaneWidth}
          leftPaneWidthMax={leftPaneWidthMax}
          rightPaneWidth={rightPaneWidth}
          rightPaneWidthMax={rightPaneWidthMax}
          onLeftPaneResizePointerDown={onLeftPaneResizePointerDown}
          onLeftPaneResizeKeyDown={onLeftPaneResizeKeyDown}
          onRightPaneResizePointerDown={onRightPaneResizePointerDown}
          onRightPaneResizeKeyDown={onRightPaneResizeKeyDown}
          fileTreePaneProps={fileTreePaneProps}
          taskCenterPaneProps={taskCenterPaneProps}
          stationOverviewPaneProps={stationOverviewPaneProps}
          gitOperationsPaneProps={gitOperationsPaneProps}
          communicationChannelsPaneProps={communicationChannelsPaneProps}
          activePaneModel={activePaneModel}
          showWorkbenchCanvas={showWorkbenchCanvas}
          workbenchCanvasProps={workbenchCanvasProps}
          pinnedWorkbenchCanvasProps={pinnedWorkbenchCanvasProps}
          fileEditorPaneProps={fileEditorPaneProps}
          gitHistoryPaneProps={gitHistoryPaneProps}
        />
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
        globalFileSearchModalProps={globalFileSearchModalProps}
      />
    </div>
  )
}
