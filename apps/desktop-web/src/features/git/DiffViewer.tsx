/**
 * High-Performance Git Diff Viewer
 *
 * Features:
 * - Split and unified view modes
 * - Syntax highlighting via Shiki
 * - Word-level diff highlighting
 * - Virtualized rendering for large files
 * - Dark/light theme support
 */

import { memo, useRef } from 'react'
import '@git-diff-view/react/styles/diff-view.css'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type {
  DiffSegment,
  GitDiffExpansionResponse,
  GitDiffStructuredResponse,
} from '@shell/integration/desktop-api'
import type { GitDiffScope } from './useGitWorkspaceController'

// ============================================
// Types
// ============================================

export interface DiffViewerProps {
  /** Structured diff data from backend */
  diff: GitDiffStructuredResponse | null
  /** View mode: split or unified */
  mode: 'split' | 'unified'
  /** Loading state */
  loading: boolean
  /** File path being viewed */
  path: string | null
  /** Current diff scope */
  diffScope: GitDiffScope
  /** Locale for i18n */
  locale: 'zh-CN' | 'en-US'
  /** Callback when mode changes */
  onModeChange: (mode: 'split' | 'unified') => void
  /** Whether full file comparison is expanded */
  fullFileExpanded: boolean
  /** Expanded full file compare payload */
  fullFile: GitDiffExpansionResponse | null
  /** Expanded full file loading state */
  fullFileLoading: boolean
  /** Expanded full file loading error */
  fullFileError: string | null
  /** Toggle full file comparison */
  onToggleFullFile: () => void
  /** Open current file in editor */
  onOpenInEditor: () => void
  /** Whether editor open action is disabled */
  openInEditorDisabled: boolean
}

// ============================================
// Word-Level Highlight Renderer
// ============================================

interface WordHighlightProps {
  segments: DiffSegment[]
}

const WordHighlight = memo(function WordHighlight({ segments }: WordHighlightProps) {
  return (
    <span className="diff-word-highlight">
      {segments.map((seg, idx) => {
        let className = 'diff-segment'
        if (seg.kind === 'insert') {
          className += ' diff-segment--insert'
        } else if (seg.kind === 'delete') {
          className += ' diff-segment--delete'
        }
        return (
          <span key={idx} className={className}>
            {seg.value}
          </span>
        )
      })}
    </span>
  )
})

// ============================================
// Custom Diff Line Renderer with Word-Level Highlighting
// ============================================

interface CustomDiffLineProps {
  content: string
  segments?: DiffSegment[]
  lineKind: 'add' | 'del' | 'ctx'
}

const CustomDiffLine = memo(function CustomDiffLine({ content, segments, lineKind }: CustomDiffLineProps) {
  // If we have word-level segments, render them
  if (segments && segments.length > 0 && (lineKind === 'add' || lineKind === 'del')) {
    return <WordHighlight segments={segments} />
  }

  // Otherwise render plain content
  return <span>{content}</span>
})

// ============================================
// Fallback Simple Diff View (when git-diff-view fails)
// ============================================

interface SimpleDiffViewProps {
  diff: GitDiffStructuredResponse
  mode: 'split' | 'unified'
}

const SimpleDiffView = memo(function SimpleDiffView({ diff, mode }: SimpleDiffViewProps) {
  if (mode === 'split') {
    return (
      <div className="simple-diff simple-diff--split">
        {diff.hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx} className="simple-diff__hunk">
            <div className="simple-diff__hunk-header">{hunk.header}</div>
            <div className="simple-diff__hunk-content">
              {/* Build paired lines for split view */}
              {(() => {
                const pairs: Array<{
                  left: { lineNum: number | null; content: string; kind: string; segments?: DiffSegment[] } | null
                  right: { lineNum: number | null; content: string; kind: string; segments?: DiffSegment[] } | null
                }> = []

                let i = 0
                const lines = hunk.lines

                while (i < lines.length) {
                  const line = lines[i]

                  if (line.kind === 'ctx') {
                    pairs.push({
                      left: { lineNum: line.oldLine, content: line.content, kind: 'ctx' },
                      right: { lineNum: line.newLine, content: line.content, kind: 'ctx' },
                    })
                    i++
                  } else if (line.kind === 'del') {
                    // Collect consecutive deletions
                    const dels: typeof lines = []
                    while (i < lines.length && lines[i].kind === 'del') {
                      dels.push(lines[i])
                      i++
                    }
                    // Collect consecutive additions
                    const adds: typeof lines = []
                    while (i < lines.length && lines[i].kind === 'add') {
                      adds.push(lines[i])
                      i++
                    }
                    // Pair them
                    const maxLen = Math.max(dels.length, adds.length)
                    for (let j = 0; j < maxLen; j++) {
                      const del = dels[j]
                      const add = adds[j]
                      pairs.push({
                        left: del
                          ? { lineNum: del.oldLine, content: del.content, kind: 'del', segments: del.segments }
                          : null,
                        right: add
                          ? { lineNum: add.newLine, content: add.content, kind: 'add', segments: add.segments }
                          : null,
                      })
                    }
                  } else if (line.kind === 'add') {
                    pairs.push({
                      left: null,
                      right: { lineNum: line.newLine, content: line.content, kind: 'add', segments: line.segments },
                    })
                    i++
                  } else {
                    i++
                  }
                }

                return pairs.map((pair, pairIdx) => (
                  <div key={pairIdx} className="simple-diff__row">
                    <div
                      className={`simple-diff__side simple-diff__side--left simple-diff__side--${pair.left?.kind || 'empty'}`}
                    >
                      <span className="simple-diff__gutter">{pair.left?.lineNum ?? ''}</span>
                      <span className="simple-diff__code">
                        {pair.left ? (
                          <CustomDiffLine
                            content={pair.left.content}
                            segments={pair.left.segments}
                            lineKind={pair.left.kind as 'add' | 'del' | 'ctx'}
                          />
                        ) : null}
                      </span>
                    </div>
                    <div
                      className={`simple-diff__side simple-diff__side--right simple-diff__side--${pair.right?.kind || 'empty'}`}
                    >
                      <span className="simple-diff__gutter">{pair.right?.lineNum ?? ''}</span>
                      <span className="simple-diff__code">
                        {pair.right ? (
                          <CustomDiffLine
                            content={pair.right.content}
                            segments={pair.right.segments}
                            lineKind={pair.right.kind as 'add' | 'del' | 'ctx'}
                          />
                        ) : null}
                      </span>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Unified view
  return (
    <div className="simple-diff simple-diff--unified">
      {diff.hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="simple-diff__hunk">
          <div className="simple-diff__hunk-header">{hunk.header}</div>
          <div className="simple-diff__hunk-content">
            {hunk.lines.map((line, lineIdx) => (
              <div key={lineIdx} className={`simple-diff__line simple-diff__line--${line.kind}`}>
                <span className="simple-diff__gutter simple-diff__gutter--old">{line.oldLine ?? ''}</span>
                <span className="simple-diff__gutter simple-diff__gutter--new">{line.newLine ?? ''}</span>
                <span className="simple-diff__prefix">
                  {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                </span>
                <span className="simple-diff__code">
                  <CustomDiffLine content={line.content} segments={line.segments} lineKind={line.kind} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

// ============================================
// Main DiffViewer Component
// ============================================

export const DiffViewer = memo(function DiffViewer({
  diff,
  mode,
  loading,
  path,
  diffScope,
  locale,
  onModeChange,
  fullFileExpanded,
  fullFile,
  fullFileLoading,
  fullFileError,
  onToggleFullFile,
  onOpenInEditor,
  openInEditorDisabled,
}: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const expandButtonLabel = t(
    locale,
    fullFileExpanded ? 'git.diff.expand.collapse' : 'git.diff.expand.open',
  )
  const activeDiff = fullFileExpanded ? fullFile?.fullDiff ?? null : diff
  const activePath = activeDiff?.path ?? path
  const loadingLabel = fullFileExpanded ? t(locale, 'git.diff.expand.loading') : t(locale, 'git.diff.loading')

  // Render binary file message
  if (diff?.isBinary || (fullFileExpanded && fullFile?.isBinary)) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span>{activePath}</span>
            <span className="diff-viewer__badge diff-viewer__badge--binary">Binary</span>
          </div>
        </header>
        <div className="diff-viewer__empty">
          <AppIcon name="close" className="diff-viewer__empty-icon" />
          <p>{t(locale, 'git.diff.binary')}</p>
        </div>
      </div>
    )
  }

  // Render loading state
  if (loading || (fullFileExpanded && fullFileLoading)) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span>{activePath}</span>
          </div>
        </header>
        <div className="diff-viewer__loading">
          <div className="diff-viewer__spinner" />
          <span>{loadingLabel}</span>
        </div>
      </div>
    )
  }

  // Render empty state
  if (fullFileExpanded && fullFileError) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span>{activePath ?? t(locale, 'git.diff.none')}</span>
          </div>
        </header>
        <div className="diff-viewer__empty">
          <AppIcon name="info" className="diff-viewer__empty-icon" />
          <p>{fullFileError}</p>
        </div>
      </div>
    )
  }

  if (!activeDiff || activeDiff.hunks.length === 0) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span>{activePath ?? t(locale, 'git.diff.none')}</span>
          </div>
        </header>
        <div className="diff-viewer__empty">
          <AppIcon name="file-text" className="diff-viewer__empty-icon" />
          <p>{t(locale, 'git.diff.empty')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="diff-viewer">
      {/* Compact Header */}
      <header className="diff-viewer__header">
        <div className="diff-viewer__path">
          <AppIcon name="file-text" className="diff-viewer__path-icon" />
          <span>{activeDiff.path}</span>
          {activeDiff.isNew && <span className="diff-viewer__badge diff-viewer__badge--new">New</span>}
          {activeDiff.isDeleted && <span className="diff-viewer__badge diff-viewer__badge--deleted">Deleted</span>}
          {activeDiff.isRenamed && (
            <span className="diff-viewer__badge diff-viewer__badge--renamed">← {activeDiff.oldPath}</span>
          )}
          {fullFileExpanded && (
            <span className="diff-viewer__badge diff-viewer__badge--expanded">
              {diffScope === 'staged'
                ? t(locale, 'git.diff.expand.scope.staged')
                : t(locale, 'git.diff.expand.scope.unstaged')}
            </span>
          )}
        </div>
        <div className="diff-viewer__meta">
          <span className="diff-viewer__stat diff-viewer__stat--add">+{activeDiff.additions}</span>
          <span className="diff-viewer__stat diff-viewer__stat--del">-{activeDiff.deletions}</span>
          <span className="diff-viewer__separator">|</span>
          <button
            type="button"
            className="diff-viewer__mode-chip"
            onClick={onOpenInEditor}
            disabled={openInEditorDisabled}
            title={t(locale, 'git.diff.openInEditor')}
          >
            <span>{t(locale, 'git.diff.openInEditor')}</span>
          </button>
          <button
            type="button"
            className={`diff-viewer__mode-chip ${
              fullFileExpanded ? 'diff-viewer__mode-chip--active' : ''
            }`}
            onClick={onToggleFullFile}
            disabled={!path}
            title={expandButtonLabel}
          >
            <span>{expandButtonLabel}</span>
          </button>
          <button
            type="button"
            className={`diff-viewer__mode-chip ${mode === 'split' ? 'diff-viewer__mode-chip--active' : ''}`}
            onClick={() => onModeChange('split')}
            title={locale === 'zh-CN' ? '分栏视图' : 'Split view'}
          >
            {locale === 'zh-CN' ? '分栏' : 'Split'}
          </button>
          <button
            type="button"
            className={`diff-viewer__mode-chip ${mode === 'unified' ? 'diff-viewer__mode-chip--active' : ''}`}
            onClick={() => onModeChange('unified')}
            title={locale === 'zh-CN' ? '统一视图' : 'Unified view'}
          >
            {locale === 'zh-CN' ? '统一' : 'Unified'}
          </button>
        </div>
      </header>

      {/* Diff Body */}
      <div ref={containerRef} className="diff-viewer__body" data-mode={mode}>
        <SimpleDiffView diff={activeDiff} mode={mode} />
      </div>
    </div>
  )
})

export default DiffViewer
