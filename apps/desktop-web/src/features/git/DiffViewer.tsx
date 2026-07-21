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

import { memo, useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import '@git-diff-view/react/styles/diff-view.css'
import { t } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type {
  DiffSegment,
  GitDiffExpansionResponse,
  GitDiffHunk,
  GitDiffLine,
  GitDiffStructuredResponse,
} from '@shell/integration/desktop-api'
import type { GitDiffScope } from './useGitWorkspaceController'
import { actualPxToRem, scaleDesignPxToActualPx, useRootFontSizePx } from './git-font-scale'

// ============================================
// Types
// ============================================

const DIFF_LINE_HEIGHT = 22
const DIFF_HUNK_HEADER_HEIGHT = 30
const DIFF_OVERSCAN = 28

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
  /** Current diff scope (staged or unstaged) — enables hunk stage/unstage buttons */
  scope?: GitDiffScope
  /** Callback to stage a hunk */
  onStageHunk?: (path: string, patch: string) => void
  /** Callback to unstage a hunk */
  onUnstageHunk?: (path: string, patch: string) => void
}

// ============================================
// Hunk Patch Builder
// ============================================

/**
 * Construct the selected hunk payload. The backend validates it against the
 * current path-scoped diff and supplies authoritative file headers before apply.
 */
function buildHunkPatch(hunk: GitDiffHunk): string {
  const lines = hunk.lines.map((line) => {
    switch (line.kind) {
      case 'add':
        return `+${line.content}`
      case 'del':
        return `-${line.content}`
      default:
        return ` ${line.content}`
    }
  })

  return [hunk.header, ...lines, ''].join('\n')
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
  locale: 'zh-CN' | 'en-US'
  scope?: GitDiffScope
  onStageHunk?: (path: string, patch: string) => void
  onUnstageHunk?: (path: string, patch: string) => void
}

type SplitDiffSide = {
  lineNum: number | null
  content: string
  kind: GitDiffLine['kind']
  segments?: DiffSegment[]
}

type SplitDiffPair = {
  left: SplitDiffSide | null
  right: SplitDiffSide | null
}

type DiffRenderRow =
  | { type: 'hunk'; key: string; hunk: GitDiffHunk }
  | { type: 'split'; key: string; pair: SplitDiffPair }
  | { type: 'unified'; key: string; line: GitDiffLine }

function buildSplitPairs(lines: GitDiffLine[]): SplitDiffPair[] {
  const pairs: SplitDiffPair[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line) {
      i += 1
      continue
    }

    if (line.kind === 'ctx') {
      pairs.push({
        left: { lineNum: line.oldLine, content: line.content, kind: 'ctx' },
        right: { lineNum: line.newLine, content: line.content, kind: 'ctx' },
      })
      i += 1
      continue
    }

    if (line.kind === 'del') {
      const dels: GitDiffLine[] = []
      while (i < lines.length && lines[i].kind === 'del') {
        dels.push(lines[i])
        i += 1
      }

      const adds: GitDiffLine[] = []
      while (i < lines.length && lines[i].kind === 'add') {
        adds.push(lines[i])
        i += 1
      }

      const maxLen = Math.max(dels.length, adds.length)
      for (let j = 0; j < maxLen; j += 1) {
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
      continue
    }

    if (line.kind === 'add') {
      pairs.push({
        left: null,
        right: { lineNum: line.newLine, content: line.content, kind: 'add', segments: line.segments },
      })
    }
    i += 1
  }

  return pairs
}

function buildDiffRows(diff: GitDiffStructuredResponse, mode: 'split' | 'unified'): DiffRenderRow[] {
  const rows: DiffRenderRow[] = []
  diff.hunks.forEach((hunk, hunkIdx) => {
    rows.push({ type: 'hunk', key: `hunk:${hunkIdx}:${hunk.header}`, hunk })
    if (mode === 'split') {
      buildSplitPairs(hunk.lines).forEach((pair, pairIdx) => {
        rows.push({ type: 'split', key: `split:${hunkIdx}:${pairIdx}`, pair })
      })
      return
    }
    hunk.lines.forEach((line, lineIdx) => {
      rows.push({ type: 'unified', key: `line:${hunkIdx}:${lineIdx}`, line })
    })
  })
  return rows
}

interface HunkHeaderProps {
  diffPath: string
  hunk: GitDiffHunk
  locale: 'zh-CN' | 'en-US'
  scope?: GitDiffScope
  onStageHunk?: (path: string, patch: string) => void
  onUnstageHunk?: (path: string, patch: string) => void
}

const HunkHeader = memo(function HunkHeader({
  diffPath,
  hunk,
  locale,
  scope,
  onStageHunk,
  onUnstageHunk,
}: HunkHeaderProps) {
  return (
    <div className="simple-diff__hunk-header">
      <span>{hunk.header}</span>
      {(scope === 'unstaged' || scope === 'staged') && (
        <div className="simple-diff__hunk-actions">
          {scope === 'unstaged' && onStageHunk && (
            <button
              type="button"
              className="simple-diff__hunk-stage-btn"
              onClick={() => onStageHunk(diffPath, buildHunkPatch(hunk))}
            >
              {t(locale, 'git.hunk.stage')}
            </button>
          )}
          {scope === 'staged' && onUnstageHunk && (
            <button
              type="button"
              className="simple-diff__hunk-unstage-btn"
              onClick={() => onUnstageHunk(diffPath, buildHunkPatch(hunk))}
            >
              {t(locale, 'git.hunk.unstage')}
            </button>
          )}
        </div>
      )}
    </div>
  )
})

const SplitDiffRow = memo(function SplitDiffRow({ pair }: { pair: SplitDiffPair }) {
  return (
    <div className="simple-diff__row">
      <div
        className={`simple-diff__side simple-diff__side--left simple-diff__side--${
          pair.left?.kind || 'empty'
        }`}
      >
        <span className="simple-diff__gutter">{pair.left?.lineNum ?? ''}</span>
        <span className="simple-diff__code">
          {pair.left ? (
            <CustomDiffLine
              content={pair.left.content}
              segments={pair.left.segments}
              lineKind={pair.left.kind}
            />
          ) : null}
        </span>
      </div>
      <div
        className={`simple-diff__side simple-diff__side--right simple-diff__side--${
          pair.right?.kind || 'empty'
        }`}
      >
        <span className="simple-diff__gutter">{pair.right?.lineNum ?? ''}</span>
        <span className="simple-diff__code">
          {pair.right ? (
            <CustomDiffLine
              content={pair.right.content}
              segments={pair.right.segments}
              lineKind={pair.right.kind}
            />
          ) : null}
        </span>
      </div>
    </div>
  )
})

const UnifiedDiffLine = memo(function UnifiedDiffLine({ line }: { line: GitDiffLine }) {
  return (
    <div className={`simple-diff__line simple-diff__line--${line.kind}`}>
      <span className="simple-diff__gutter simple-diff__gutter--old">{line.oldLine ?? ''}</span>
      <span className="simple-diff__gutter simple-diff__gutter--new">{line.newLine ?? ''}</span>
      <span className="simple-diff__prefix">
        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
      </span>
      <span className="simple-diff__code">
        <CustomDiffLine content={line.content} segments={line.segments} lineKind={line.kind} />
      </span>
    </div>
  )
})

const SimpleDiffView = memo(function SimpleDiffView({
  diff,
  mode,
  locale,
  scope,
  onStageHunk,
  onUnstageHunk,
}: SimpleDiffViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rootFontSizePx = useRootFontSizePx()
  const rows = useMemo(() => buildDiffRows(diff, mode), [diff, mode])
  const lineHeight = scaleDesignPxToActualPx(DIFF_LINE_HEIGHT, rootFontSizePx)
  const hunkHeaderHeight = scaleDesignPxToActualPx(DIFF_HUNK_HEADER_HEIGHT, rootFontSizePx)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'hunk' ? hunkHeaderHeight : lineHeight),
    overscan: DIFF_OVERSCAN,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [hunkHeaderHeight, lineHeight, mode, rows.length, virtualizer])

  return (
    <div ref={scrollRef} className={`simple-diff simple-diff--${mode}`}>
      <div
        className="simple-diff__virtual-inner"
        style={{ height: actualPxToRem(virtualizer.getTotalSize(), rootFontSizePx) }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = rows[virtualItem.index]
          if (!row) {
            return null
          }
          const style = {
            height: actualPxToRem(virtualItem.size, rootFontSizePx),
            transform: `translateY(${actualPxToRem(virtualItem.start, rootFontSizePx)})`,
          }
          return (
            <div key={row.key} className="simple-diff__virtual-row" style={style}>
              {row.type === 'hunk' ? (
                <HunkHeader
                  diffPath={diff.path}
                  hunk={row.hunk}
                  locale={locale}
                  scope={scope}
                  onStageHunk={onStageHunk}
                  onUnstageHunk={onUnstageHunk}
                />
              ) : row.type === 'split' ? (
                <SplitDiffRow pair={row.pair} />
              ) : (
                <UnifiedDiffLine line={row.line} />
              )}
            </div>
          )
        })}
      </div>
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
  scope,
  onStageHunk,
  onUnstageHunk,
}: DiffViewerProps) {
  const expandButtonLabel = t(
    locale,
    fullFileExpanded ? 'git.diff.expand.collapse' : 'git.diff.expand.open',
  )
  const activeDiff = fullFileExpanded ? fullFile?.fullDiff ?? null : diff
  const activePath = activeDiff?.path ?? path
  const activeTooLarge = fullFileExpanded
    ? Boolean(fullFile?.tooLarge || fullFile?.fullDiff?.tooLarge)
    : Boolean(diff?.tooLarge)
  const loadingLabel = fullFileExpanded ? t(locale, 'git.diff.expand.loading') : t(locale, 'git.diff.loading')

  // Render binary file message
  if (diff?.isBinary || (fullFileExpanded && fullFile?.isBinary)) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span className="diff-viewer__path-text">{activePath}</span>
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
            <span className="diff-viewer__path-text">{activePath}</span>
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
            <span className="diff-viewer__path-text">{activePath ?? t(locale, 'git.diff.none')}</span>
          </div>
        </header>
        <div className="diff-viewer__empty">
          <AppIcon name="info" className="diff-viewer__empty-icon" />
          <p>{fullFileError}</p>
        </div>
      </div>
    )
  }

  if (activeTooLarge) {
    return (
      <div className="diff-viewer">
        <header className="diff-viewer__header">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span className="diff-viewer__path-text">{activePath ?? t(locale, 'git.diff.none')}</span>
          </div>
        </header>
        <div className="diff-viewer__empty">
          <AppIcon name="info" className="diff-viewer__empty-icon" />
          <p>{t(locale, 'git.diff.tooLarge')}</p>
          {!openInEditorDisabled && (
            <button
              type="button"
              className="diff-viewer__mode-chip diff-viewer__mode-chip--action"
              onClick={onOpenInEditor}
            >
              <span>{t(locale, 'git.diff.openInEditor')}</span>
            </button>
          )}
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
            <span className="diff-viewer__path-text">{activePath ?? t(locale, 'git.diff.none')}</span>
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
        <div className="diff-viewer__summary">
          <div className="diff-viewer__path">
            <AppIcon name="file-text" className="diff-viewer__path-icon" />
            <span className="diff-viewer__path-text">{activeDiff.path}</span>
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
          <div className="diff-viewer__stats">
            <span className="diff-viewer__stat diff-viewer__stat--add">+{activeDiff.additions}</span>
            <span className="diff-viewer__stat diff-viewer__stat--del">-{activeDiff.deletions}</span>
            <span className="diff-viewer__separator">|</span>
          </div>
        </div>
        <div className="diff-viewer__actions">
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
      <div className="diff-viewer__body" data-mode={mode}>
        <SimpleDiffView diff={activeDiff} mode={mode} locale={locale} scope={scope} onStageHunk={onStageHunk} onUnstageHunk={onUnstageHunk} />
      </div>
    </div>
  )
})

export default DiffViewer
