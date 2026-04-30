import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { t, type Locale } from '../i18n/ui-locale'
import { AppIcon } from '../ui/icons'
import type { WorkspaceTabInfo } from '../state/workspace-tab-model'
import type { WorkspaceSwitchAnimation } from '../state/ui-preferences'
import './WorkspaceTabBar.scss'

export interface WorkspaceTearOffRequest {
  workspaceId: string
  screenX: number
  screenY: number
}

interface WorkspaceTabBarProps {
  locale: Locale
  tabs: WorkspaceTabInfo[]
  activeTabId?: string | null
  pendingTabId?: string | null
  closingTabId?: string | null
  workspaceSwitching?: boolean
  workspaceSwitchAnimation?: WorkspaceSwitchAnimation
  onSwitchTab: (workspaceId: string) => void
  onCloseTab: (workspaceId: string) => void
  onAddTab: () => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onTearOffTab?: (request: WorkspaceTearOffRequest) => void
}

export function WorkspaceTabBar({
  locale,
  tabs,
  activeTabId,
  pendingTabId = null,
  closingTabId = null,
  workspaceSwitching = false,
  workspaceSwitchAnimation = 'crossfade',
  onSwitchTab,
  onCloseTab,
  onAddTab,
  onReorderTabs,
  onTearOffTab,
}: WorkspaceTabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragStartXRef = useRef(0)

  const handleTabMouseDown = useCallback(
    (e: ReactMouseEvent, index: number) => {
      if (e.button !== 0) return
      dragStartXRef.current = e.clientX
      setDragIndex(index)

      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        const dx = moveEvent.clientX - dragStartXRef.current
        if (Math.abs(dx) > 8 && dragIndex !== null) {
          const direction = dx > 0 ? 1 : -1
          const targetIndex = dragIndex + direction
          if (targetIndex >= 0 && targetIndex < tabs.length) {
            onReorderTabs(dragIndex, targetIndex)
            setDragIndex(targetIndex)
            dragStartXRef.current = moveEvent.clientX
          }
        }
      }

      const handleUp = () => {
        setDragIndex(null)
        document.removeEventListener('mousemove', handleMove)
        document.removeEventListener('mouseup', handleUp)
      }

      document.addEventListener('mousemove', handleMove)
      document.addEventListener('mouseup', handleUp)
    },
    [dragIndex, tabs.length, onReorderTabs],
  )

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent, tab: WorkspaceTabInfo) => {
      if (!onTearOffTab) return
      onTearOffTab({
        workspaceId: tab.workspaceId,
        screenX: e.screenX,
        screenY: e.screenY,
      })
    },
    [onTearOffTab],
  )

  const handleTabAuxClick = useCallback(
    (e: ReactMouseEvent, tab: WorkspaceTabInfo) => {
      if (e.button === 1) {
        e.preventDefault()
        onCloseTab(tab.workspaceId)
      }
    },
    [onCloseTab],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent, tab: WorkspaceTabInfo) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSwitchTab(tab.workspaceId)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onCloseTab(tab.workspaceId)
      }
    },
    [onSwitchTab, onCloseTab],
  )

  const switchingClass =
    workspaceSwitching && workspaceSwitchAnimation !== 'none'
      ? ` workspace-switching workspace-switching--${workspaceSwitchAnimation}`
      : ''

  return (
    <div
      className={`vb-workspace-tab-bar${switchingClass}`}
      data-switch-anim={workspaceSwitchAnimation !== 'none' ? workspaceSwitchAnimation : undefined}
      ref={scrollContainerRef}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.workspaceId === activeTabId
        const isPending = tab.workspaceId === pendingTabId && !isActive
        const isClosing = tab.workspaceId === closingTabId
        const tabName = tab.name || tab.root.split('/').pop() || tab.workspaceId
        return (
          <div
            key={tab.workspaceId}
            className={`vb-workspace-tab${isActive ? ' active' : ''}${isPending ? ' pending' : ''}${
              isClosing ? ' closing' : ''
            }${index === dragIndex ? ' dragging' : ''}`}
            onMouseDown={(e) => handleTabMouseDown(e, index)}
            onClick={() => onSwitchTab(tab.workspaceId)}
            onDoubleClick={(e) => handleDoubleClick(e, tab)}
            onAuxClick={(e) => handleTabAuxClick(e, tab)}
            onKeyDown={(e) => handleTabKeyDown(e, tab)}
            role="tab"
            aria-selected={isActive}
            aria-busy={isPending || undefined}
            tabIndex={isActive ? 0 : -1}
            title={tab.root}
          >
            <AppIcon name="folder-open" className="vb-workspace-tab-icon" aria-hidden="true" />
            <span className="vb-workspace-tab-label">{tabName}</span>
            <button
              className="vb-workspace-tab-close"
              onClick={(e) => {
                e.stopPropagation()
                onCloseTab(tab.workspaceId)
              }}
              title={t(locale, 'topControlBar.closeWorkspaceTab')}
              type="button"
              aria-label={t(locale, 'topControlBar.closeWorkspaceTab')}
            >
              <AppIcon name="close" />
            </button>
          </div>
        )
      })}
      <button
        className="vb-workspace-tab-add"
        onClick={onAddTab}
        title={t(locale, 'topControlBar.addWorkspaceTab')}
        type="button"
        aria-label={t(locale, 'topControlBar.addWorkspaceTab')}
      >
        <AppIcon name="plus" />
      </button>
    </div>
  )
}
