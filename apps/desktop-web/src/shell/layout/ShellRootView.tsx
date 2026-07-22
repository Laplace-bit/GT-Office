import {
  type ComponentProps,
  type CSSProperties,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type RefObject,
  useState,
} from 'react'
import { BusinessDesignerPane } from '@features/business-designer'
import { FileEditorPane, FileTreePane, GlobalFileSearchModal } from '@features/file-explorer'
import { GitHistoryPane, GitOperationsPane } from '@features/git'
import { GlobalTaskDispatchOverlay, TaskCenterPane } from '@features/task-center'
import { SettingsModal } from '@features/settings'
import { ChannelStudio, CommunicationChannelsPane } from '@features/tool-adapter'
import { StationManageModal, StationSearchModal, WorkbenchCanvas } from '@features/workspace-hub'
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
import type { WorkspaceTabInfo } from '../state/workspace-tab-model'
import type { WorkspaceSwitchAnimation } from '../state/ui-preferences'

type ShellTopControlBarProps = ComponentProps<typeof TopControlBar> & {
  workspaceTabs?: WorkspaceTabInfo[]
  activeTabId?: string | null
  workspaceSwitching?: boolean
  workspaceSwitchAnimation?: WorkspaceSwitchAnimation
  onSwitchTab?: (workspaceId: string) => void | Promise<void>
  onCloseTab?: (workspaceId: string) => void | Promise<void>
  onAddTab?: () => void | Promise<void>
  onReorderTabs?: (fromIndex: number, toIndex: number) => void
}

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
  topControlBarProps: ShellTopControlBarProps
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
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  businessDesignerPaneProps: ComponentProps<typeof BusinessDesignerPane>
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
  workspaceSwitching: boolean
  workspaceSwitchAnimation: WorkspaceSwitchAnimation
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
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
}

function ShellLeftPaneContent({
  activeNavId,
  fileTreePaneProps,
  taskCenterPaneProps,
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
    if (activeNavId === 'git') {
      return <GitOperationsPane {...gitOperationsPaneProps} />
    }
    if (activeNavId === 'channels') {
      return <CommunicationChannelsPane {...communicationChannelsPaneProps} />
    }
    if (activeNavId === 'designer') {
      return <LeftBusinessPane model={activePaneModel} />
    }
    return <LeftBusinessPane model={activePaneModel} />
  })()

  return (
    <div className="shell-left-pane-content">
      <div className={fileTreeSlotClassName} aria-hidden={!showFileTree}>
        <FileTreePane {...fileTreePaneProps} />
      </div>
      {showFileTree ? null : (
        <div key={activeNavId} className="shell-left-pane-slot shell-left-pane-transition">
          {secondaryPane}
        </div>
      )}
    </div>
  )
}

interface ShellMainPaneContentProps {
  activeNavId: NavItemId
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
  businessDesignerPaneProps: ComponentProps<typeof BusinessDesignerPane>
}

function ShellMainPaneContent({
  activeNavId,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
  businessDesignerPaneProps,
}: ShellMainPaneContentProps) {
  if (showWorkbenchCanvas) {
    return (
      <div className="shell-main-view shell-pane-transition">
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

  if (activeNavId === 'designer') {
    return (
      <div key="designer" className="shell-feature-view shell-pane-transition">
        <BusinessDesignerPane {...businessDesignerPaneProps} />
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
  businessDesignerPaneProps: ComponentProps<typeof BusinessDesignerPane>
}

function ShellWorkspaceContent({
  activeNavId,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
  businessDesignerPaneProps,
}: ShellWorkspaceContentProps) {
  return (
    <div className="shell-pane-shell shell-main-pane">
      <ShellMainPaneContent
        activeNavId={activeNavId}
        showWorkbenchCanvas={showWorkbenchCanvas}
        workbenchCanvasProps={workbenchCanvasProps}
        fileEditorPaneProps={fileEditorPaneProps}
        gitHistoryPaneProps={gitHistoryPaneProps}
        businessDesignerPaneProps={businessDesignerPaneProps}
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
  businessDesignerPaneProps: ComponentProps<typeof BusinessDesignerPane>
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
  businessDesignerPaneProps,
}: ShellMainAreaProps) {
  return (
    <div ref={shellMainPaneRef} className="shell-main-content">
      <ShellWorkspaceContent
        activeNavId={activeNavId}
        showWorkbenchCanvas={showWorkbenchCanvas}
        workbenchCanvasProps={workbenchCanvasProps}
        fileEditorPaneProps={fileEditorPaneProps}
        gitHistoryPaneProps={gitHistoryPaneProps}
        businessDesignerPaneProps={businessDesignerPaneProps}
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
  gitOperationsPaneProps: ComponentProps<typeof GitOperationsPane>
  communicationChannelsPaneProps: ComponentProps<typeof CommunicationChannelsPane>
  activePaneModel: PaneModel
  showWorkbenchCanvas: boolean
  workbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas>
  pinnedWorkbenchCanvasProps: ComponentProps<typeof WorkbenchCanvas> | null
  fileEditorPaneProps: ComponentProps<typeof FileEditorPane>
  gitHistoryPaneProps: ComponentProps<typeof GitHistoryPane>
  businessDesignerPaneProps: ComponentProps<typeof BusinessDesignerPane>
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
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  businessDesignerPaneProps,
  activePaneModel,
  showWorkbenchCanvas,
  workbenchCanvasProps,
  pinnedWorkbenchCanvasProps,
  fileEditorPaneProps,
  gitHistoryPaneProps,
}: ShellMainLayoutProps) {
  const usesIntegratedLeftPane = activeNavId === 'designer' || activeNavId === 'stations'

  return (
    <>
      <div ref={shellRailRef} className="shell-rail-slot">
        <ActivityRail {...activityRailProps} />
      </div>

      {usesIntegratedLeftPane ? null : (
        <>
          <div
            ref={shellLeftPaneRef}
            className={`shell-pane-shell shell-left-pane ${activeNavId === 'tasks' ? 'is-task-center' : ''} ${!leftPaneVisible ? 'shell-left-pane--collapsed' : 'shell-left-pane--visible'}`}
          >
            <ShellLeftPaneContent
              activeNavId={activeNavId}
              fileTreePaneProps={fileTreePaneProps}
              taskCenterPaneProps={taskCenterPaneProps}
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
        </>
      )}

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
        businessDesignerPaneProps={businessDesignerPaneProps}
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
  gitOperationsPaneProps,
  communicationChannelsPaneProps,
  businessDesignerPaneProps,
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
  workspaceSwitching,
  workspaceSwitchAnimation,
}: ShellRootViewProps) {
  const [stationDockPortalTarget, setStationDockPortalTarget] = useState<HTMLElement | null>(null)
  const switchingClass = workspaceSwitching && workspaceSwitchAnimation !== 'none'
    ? ` workspace-switching workspace-switching--${workspaceSwitchAnimation}`
    : ''
  const workbenchCanvasPropsWithDock = {
    ...workbenchCanvasProps,
    minimizedDockPortalTarget: stationDockPortalTarget,
  }
  const pinnedWorkbenchCanvasPropsWithDock = pinnedWorkbenchCanvasProps
    ? {
        ...pinnedWorkbenchCanvasProps,
        minimizedDockPortalTarget: stationDockPortalTarget,
      }
    : null
  const topmostWorkbenchCanvasPropsWithDock = topmostWorkbenchCanvasProps
    ? {
        ...topmostWorkbenchCanvasProps,
        minimizedDockPortalTarget: stationDockPortalTarget,
      }
    : null

  return (
    <div
      ref={shellContainerRef}
      className={`agent-shell${workspaceSwitching ? ' workspace-switching-active' : ''} ${
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

      <main
        ref={shellMainRef}
        className={`shell-main-layout relative z-10${switchingClass}`}
        data-switch-anim={workspaceSwitchAnimation !== 'none' ? workspaceSwitchAnimation : undefined}
        style={shellMainStyle}
      >
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
          gitOperationsPaneProps={gitOperationsPaneProps}
          communicationChannelsPaneProps={communicationChannelsPaneProps}
          businessDesignerPaneProps={businessDesignerPaneProps}
          activePaneModel={activePaneModel}
          showWorkbenchCanvas={showWorkbenchCanvas}
          workbenchCanvasProps={workbenchCanvasPropsWithDock}
          pinnedWorkbenchCanvasProps={pinnedWorkbenchCanvasPropsWithDock}
          fileEditorPaneProps={fileEditorPaneProps}
          gitHistoryPaneProps={gitHistoryPaneProps}
        />
      </main>

      {topmostWorkbenchCanvasPropsWithDock ? <WorkbenchCanvas {...topmostWorkbenchCanvasPropsWithDock} /> : null}

      <div
        ref={shellStatusRef}
        className={`shell-status-wrapper relative z-10${switchingClass}`}
        data-switch-anim={workspaceSwitchAnimation !== 'none' ? workspaceSwitchAnimation : undefined}
      >
        <StatusBar {...statusBarProps} stationDockRef={setStationDockPortalTarget} />
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
