import { memo } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitStatusFile } from '@shell/integration/desktop-api'
import { GitIconButton } from './GitIconButton'
import { getFileName } from './git-helpers'

interface GitFileRowProps {
  file: GitStatusFile
  isActive: boolean
  locale: 'zh-CN' | 'en-US'
  actionLoading: string | null
  actionMode: 'staged' | 'unstaged' | 'mixed'
  onSelect: () => void
  onPreload: () => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  style: React.CSSProperties
}

export const GitFileRow = memo(function GitFileRow({
  file,
  isActive,
  locale,
  actionLoading,
  actionMode,
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
  style,
}: GitFileRowProps) {
  const fileName = getFileName(file.path)
  return (
    <div
      className={`git-file-row ${isActive ? 'git-file-row--active' : ''}`}
      style={style}
    >
      <button
        type="button"
        className="git-file-row__select"
        onClick={onSelect}
        onMouseEnter={onPreload}
        title={file.path}
        aria-label={file.path}
      >
        <span
          className={`git-file-row__status ${file.staged ? 'git-file-row__status--staged' : 'git-file-row__status--unstaged'}`}
        >
          {file.status || '—'}
        </span>
        <span className="git-file-row__path">{fileName}</span>
      </button>
      <div className="git-file-row__actions">
        {actionMode === 'staged' ? (
          <GitIconButton
            icon="undo"
            label={t(locale, 'git.action.unstage')}
            onClick={onUnstage}
            disabled={Boolean(actionLoading)}
            size="sm"
          />
        ) : actionMode === 'mixed' ? (
          <>
            <GitIconButton
              icon="check"
              label={t(locale, 'git.action.stage')}
              onClick={onStage}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="success"
            />
            <GitIconButton
              icon="undo"
              label={t(locale, 'git.action.unstage')}
              onClick={onUnstage}
              disabled={Boolean(actionLoading)}
              size="sm"
            />
            <GitIconButton
              icon="rotate-ccw"
              label={t(locale, 'git.action.discard')}
              onClick={() => onDiscard()}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="danger"
            />
          </>
        ) : (
          <>
            <GitIconButton
              icon="check"
              label={t(locale, 'git.action.stage')}
              onClick={onStage}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="success"
            />
            <GitIconButton
              icon="rotate-ccw"
              label={t(locale, 'git.action.discard')}
              onClick={() => onDiscard()}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="danger"
            />
          </>
        )}
      </div>
    </div>
  )
})
