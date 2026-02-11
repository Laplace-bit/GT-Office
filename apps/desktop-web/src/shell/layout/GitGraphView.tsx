import { memo, useMemo, useRef, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { GitCommitEntry } from '../integration/desktop-api'
import { formatGitTimestamp } from '@features/git'
import type { Locale } from '../i18n/ui-locale'
import {
  buildGraphLayout,
  BRANCH_COLORS,
  MAX_LANES,
  type GraphRow,
  type RefLabel,
} from '@features/git'

// ============================================
// Constants
// ============================================

/** Row height in pixels for virtual scrolling */
const GRAPH_ROW_HEIGHT = 32
/** Width per lane in pixels */
const LANE_WIDTH = 20
/** Dot radius for commit nodes */
const DOT_RADIUS = 5
/** Dot radius for branch continuation points */
const BRANCH_DOT_RADIUS = 3
/** Overscan rows for smooth scrolling */
const GRAPH_OVERSCAN = 15
/** Minimum graph column width (px) */
const MIN_GRAPH_WIDTH = 80

// ============================================
// Utility Functions
// ============================================

/**
 * Sanitize text to handle potential encoding issues.
 * Removes or replaces invalid Unicode characters that may cause display issues.
 */
function sanitizeText(text: string | undefined | null): string {
  if (!text) return ''
  // Replace Unicode replacement character (U+FFFD) with empty string
  return text.replace(/\uFFFD/g, '').trim()
}



// ============================================
// SVG Graph Cell (per-row) - Enhanced with branch dots
// ============================================

interface GraphCellProps {
  row: GraphRow
  totalLanes: number
  isFirst: boolean
  isLast: boolean
}

const GraphCell = memo(function GraphCell({ row, totalLanes, isFirst, isLast }: GraphCellProps) {
  const width = Math.max(MIN_GRAPH_WIDTH, (totalLanes + 1) * LANE_WIDTH)
  const height = GRAPH_ROW_HEIGHT
  const cx = row.lane * LANE_WIDTH + LANE_WIDTH / 2 + 4
  const cy = height / 2
  const dotColor = BRANCH_COLORS[row.colorIndex]

  return (
    <svg
      className="git-graph-cell"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {/* Vertical lane lines with branch dots */}
      {row.activeLanes.map((colorIdx, laneIdx) => {
        if (colorIdx < 0) return null
        const lx = laneIdx * LANE_WIDTH + LANE_WIDTH / 2 + 4
        const color = BRANCH_COLORS[colorIdx]
        const isCurrentLane = laneIdx === row.lane

        return (
          <g key={`lane-${laneIdx}`}>
            {/* Vertical line */}
            <line
              x1={lx}
              y1={isFirst && isCurrentLane ? cy : 0}
              x2={lx}
              y2={isLast && isCurrentLane ? cy : height}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            {/* Small dot on branch lines (not on current commit lane) */}
            {!isCurrentLane && (
              <circle
                cx={lx}
                cy={cy}
                r={BRANCH_DOT_RADIUS}
                fill={color}
                opacity={0.4}
              />
            )}
          </g>
        )
      })}

      {/* Merge lines (curved connections from other lanes to this commit) */}
      {row.mergeFromLanes.map((fromLane) => {
        const fx = fromLane * LANE_WIDTH + LANE_WIDTH / 2 + 4
        const mergeColor = BRANCH_COLORS[row.activeLanes[fromLane] ?? row.colorIndex]
        return (
          <g key={`merge-${fromLane}`}>
            <path
              d={`M ${fx} 0 Q ${fx} ${cy * 0.6}, ${(fx + cx) / 2} ${cy * 0.8} T ${cx} ${cy}`}
              stroke={mergeColor}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              opacity={0.7}
            />
            {/* Small dot at merge start */}
            <circle
              cx={fx}
              cy={4}
              r={BRANCH_DOT_RADIUS}
              fill={mergeColor}
              opacity={0.6}
            />
          </g>
        )
      })}

      {/* Main commit dot with glow effect */}
      <circle
        cx={cx}
        cy={cy}
        r={DOT_RADIUS + 3}
        fill={dotColor}
        opacity={0.15}
      />
      <circle
        cx={cx}
        cy={cy}
        r={DOT_RADIUS}
        fill={dotColor}
        stroke="var(--vb-surface, #1e1e1e)"
        strokeWidth={2}
      />
    </svg>
  )
})

// ============================================
// Ref Label Badge - Compact and non-overlapping
// ============================================

interface RefBadgeProps {
  label: RefLabel
}

const RefBadge = memo(function RefBadge({ label }: RefBadgeProps) {
  const typeClass = `git-graph-ref--${label.type}`
  const displayName = sanitizeText(label.name)

  return (
    <span className={`git-graph-ref ${typeClass}`} title={displayName}>
      {displayName}
    </span>
  )
})

// ============================================
// Graph Row Component (memoized)
// ============================================

interface GraphRowComponentProps {
  row: GraphRow
  totalLanes: number
  locale: Locale
  style: React.CSSProperties
  isSelected: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: (commitHash: string) => void
}

const GraphRowComponent = memo(function GraphRowComponent({
  row,
  totalLanes,
  locale,
  style,
  isSelected,
  isFirst,
  isLast,
  onSelect,
}: GraphRowComponentProps) {
  const handleClick = useCallback(() => {
    onSelect(row.entry.commit)
  }, [onSelect, row.entry.commit])

  const summary = sanitizeText(row.entry.summary)
  const author = sanitizeText(row.entry.authorName)
  const dateStr = formatGitTimestamp(row.entry.authoredAt, locale)

  return (
    <div
      className={`git-graph-row ${isSelected ? 'git-graph-row--selected' : ''}`}
      style={style}
      onClick={handleClick}
      role="row"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
    >
      {/* Graph column - fixed width based on lanes */}
      <div
        className="git-graph-row__graph"
        role="cell"
        style={{ width: Math.max(MIN_GRAPH_WIDTH, (totalLanes + 1) * LANE_WIDTH) }}
      >
        <GraphCell row={row} totalLanes={totalLanes} isFirst={isFirst} isLast={isLast} />
      </div>

      {/* Description column - flex grow with proper overflow handling */}
      <div className="git-graph-row__desc" role="cell">
        {/* Refs container - inline with proper spacing */}
        {row.refLabels.length > 0 && (
          <span className="git-graph-row__refs">
            {row.refLabels.slice(0, 3).map((label) => (
              <RefBadge key={`${label.type}-${label.name}`} label={label} />
            ))}
            {row.refLabels.length > 3 && (
              <span className="git-graph-ref git-graph-ref--more" title={row.refLabels.slice(3).map(l => l.name).join(', ')}>
                +{row.refLabels.length - 3}
              </span>
            )}
          </span>
        )}
        {/* Summary with proper truncation */}
        <span className="git-graph-row__summary" title={summary}>
          {summary}
        </span>
      </div>

      {/* Date column */}
      <div className="git-graph-row__date" role="cell" title={dateStr}>
        {dateStr}
      </div>

      {/* Author column */}
      <div className="git-graph-row__author" role="cell" title={author}>
        {author}
      </div>

      {/* Commit hash column */}
      <div className="git-graph-row__hash" role="cell" title={row.entry.commit}>
        {row.entry.shortCommit}
      </div>
    </div>
  )
})

// ============================================
// Main Git Graph View Component
// ============================================

export interface GitGraphViewProps {
  entries: GitCommitEntry[]
  locale: Locale
  historyLoading: boolean
  hasMoreHistory: boolean
  selectedCommit: string | null
  onSelectCommit: (hash: string) => void
  onLoadMore: () => void
  onResetToLatest: () => void
}

export const GitGraphView = memo(function GitGraphView({
  entries,
  locale,
  historyLoading,
  hasMoreHistory,
  selectedCommit,
  onSelectCommit,
  onLoadMore,
  onResetToLatest,
}: GitGraphViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Build graph layout (memoized, only recalculates when entries change)
  const graphRows = useMemo(() => buildGraphLayout(entries), [entries])

  // Calculate max lanes needed for any row
  const maxLanes = useMemo(() => {
    let max = 1
    for (const row of graphRows) {
      const activeCount = row.activeLanes.filter((c) => c >= 0).length
      if (activeCount > max) max = activeCount
    }
    return Math.min(max, MAX_LANES)
  }, [graphRows])

  // Calculate dynamic graph column width
  const graphColWidth = useMemo(() => {
    return Math.max(MIN_GRAPH_WIDTH, (maxLanes + 1) * LANE_WIDTH)
  }, [maxLanes])

  const virtualizer = useVirtualizer({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRAPH_ROW_HEIGHT,
    overscan: GRAPH_OVERSCAN,
  })

  return (
    <div className="git-graph-view" role="table" aria-label="Git commit history">
      {/* Table header */}
      <div className="git-graph-header" role="row">
        <div
          className="git-graph-header__cell git-graph-header__graph"
          role="columnheader"
          style={{ width: graphColWidth }}
        >
          Graph
        </div>
        <div className="git-graph-header__cell git-graph-header__desc" role="columnheader">
          Description
        </div>
        <div className="git-graph-header__cell git-graph-header__date" role="columnheader">
          Date
        </div>
        <div className="git-graph-header__cell git-graph-header__author" role="columnheader">
          Author
        </div>
        <div className="git-graph-header__cell git-graph-header__hash" role="columnheader">
          Commit
        </div>
      </div>

      {/* Virtualized body */}
      <div className="git-graph-body" ref={scrollRef}>
        {graphRows.length === 0 ? (
          <div className="git-graph-empty">
            <div className="git-graph-empty__icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
              </svg>
            </div>
            <p>No commits yet</p>
          </div>
        ) : (
          <div
            className="git-graph-body__inner"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = graphRows[virtualItem.index]
              if (!row) return null
              return (
                <GraphRowComponent
                  key={row.entry.commit}
                  row={row}
                  totalLanes={maxLanes}
                  locale={locale}
                  isSelected={selectedCommit === row.entry.commit}
                  isFirst={virtualItem.index === 0}
                  isLast={virtualItem.index === graphRows.length - 1}
                  onSelect={onSelectCommit}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: `${GRAPH_ROW_HEIGHT}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Load more / Reset actions */}
      <div className="git-graph-actions">
        <button
          type="button"
          className="git-graph-btn"
          onClick={onLoadMore}
          disabled={!hasMoreHistory || historyLoading}
        >
          {historyLoading ? (
            <span className="git-graph-btn__spinner" />
          ) : (
            <svg className="git-graph-btn__icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12l-4-4h8l-4 4z" />
            </svg>
          )}
          <span>Load Older</span>
        </button>
        <button
          type="button"
          className="git-graph-btn git-graph-btn--secondary"
          onClick={onResetToLatest}
          disabled={historyLoading}
        >
          <svg className="git-graph-btn__icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4l4 4H4l4-4z" />
          </svg>
          <span>Latest</span>
        </button>
      </div>
    </div>
  )
})
