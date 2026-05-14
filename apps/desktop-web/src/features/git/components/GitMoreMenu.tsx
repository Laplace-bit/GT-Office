import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { GitIconButton } from './GitIconButton'

interface GitMoreMenuProps {
  locale: Locale
  onOpenBranches: () => void
  onOpenStash: () => void
  onOpenTags: () => void
}

const MENU_ITEMS = [
  { key: 'branches', icon: 'git-branch' as const, labelKey: 'git.branch.title' },
  { key: 'stash', icon: 'archive' as const, labelKey: 'git.stash.title' },
  { key: 'tags', icon: 'clock' as const, labelKey: 'git.tag.title' },
] as const

export const GitMoreMenu = memo(function GitMoreMenu({
  locale,
  onOpenBranches,
  onOpenStash,
  onOpenTags,
}: GitMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => setOpen((prev) => !prev), [])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const handleItemClick = useCallback(
    (key: string) => {
      setOpen(false)
      if (key === 'branches') onOpenBranches()
      else if (key === 'stash') onOpenStash()
      else if (key === 'tags') onOpenTags()
    },
    [onOpenBranches, onOpenStash, onOpenTags],
  )

  const triggerRect = triggerRef.current?.getBoundingClientRect()
  const dropdown = open && triggerRect
    ? createPortal(
        <div
          ref={menuRef}
          className="git-more-menu__dropdown"
          role="menu"
          style={{
            position: 'fixed',
            top: triggerRect.bottom + 4,
            right: window.innerWidth - triggerRect.right,
          }}
        >
          {MENU_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="git-more-menu__item"
              role="menuitem"
              onClick={() => handleItemClick(item.key)}
            >
              <AppIcon name={item.icon} className="git-more-menu__item-icon" />
              <span>{t(locale, item.labelKey)}</span>
            </button>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={triggerRef} className="git-more-menu">
      <GitIconButton
        icon="ellipsis"
        label={t(locale, 'git.more.title')}
        onClick={toggle}
        size="md"
      />
      {dropdown}
    </div>
  )
})