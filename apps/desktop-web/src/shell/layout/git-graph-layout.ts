import type { GitCommitEntry } from '../integration/desktop-api'

// ============================================
// Constants
// ============================================

/** Maximum number of visible lanes */
export const MAX_LANES = 12

// Branch colors (Git Graph inspired palette)
export const BRANCH_COLORS = [
  '#f14e32', // git red-orange
  '#3fb950', // green
  '#58a6ff', // blue
  '#d29922', // yellow
  '#bc8cff', // purple
  '#f778ba', // pink
  '#79c0ff', // light blue
  '#ffa657', // orange
  '#7ee787', // light green
  '#ff7b72', // salmon
  '#d2a8ff', // lavender
  '#a5d6ff', // sky
] as const

// ============================================
// Types
// ============================================

export interface RefLabel {
  name: string
  type: 'head' | 'branch' | 'remote' | 'tag'
}

/** Processed commit with lane/routing info for graph rendering */
export interface GraphRow {
  /** Original commit entry */
  entry: GitCommitEntry
  /** Which lane this commit occupies (0-based) */
  lane: number
  /** Color index for this commit's branch */
  colorIndex: number
  /** Active lanes at this row: each entry is the branch color index occupying that lane */
  activeLanes: number[]
  /** Merge lines: incoming connections from parent commits in other lanes */
  mergeFromLanes: number[]
  /** Parsed ref labels */
  refLabels: RefLabel[]
}

// ============================================
// Utility Functions
// ============================================

/**
 * Sanitize text to handle potential encoding issues from git output.
 * Removes Unicode replacement characters that appear when UTF-8 decoding fails.
 */
function sanitizeGitText(text: string): string {
  // Replace Unicode replacement character (U+FFFD) with empty string
  return text.replace(/\uFFFD/g, '').trim()
}

// ============================================
// Graph Layout Algorithm
// ============================================

function parseRefLabels(refs: string[]): RefLabel[] {
  const labels: RefLabel[] = []
  for (const ref of refs) {
    const trimmed = sanitizeGitText(ref)
    if (!trimmed) continue

    if (trimmed.startsWith('HEAD -> ')) {
      labels.push({
        name: sanitizeGitText(trimmed.slice('HEAD -> '.length)),
        type: 'head',
      })
    } else if (trimmed.startsWith('tag: ')) {
      labels.push({
        name: sanitizeGitText(trimmed.slice('tag: '.length)),
        type: 'tag',
      })
    } else if (trimmed.includes('/')) {
      labels.push({
        name: sanitizeGitText(trimmed),
        type: 'remote',
      })
    } else if (trimmed !== 'HEAD') {
      labels.push({
        name: sanitizeGitText(trimmed),
        type: 'branch',
      })
    }
  }
  return labels
}

/**
 * Build graph layout from commit entries.
 * Assigns lanes and tracks active branch lines for SVG rendering.
 * This is a simplified topological lane assignment algorithm.
 */
export function buildGraphLayout(entries: GitCommitEntry[]): GraphRow[] {
  if (entries.length === 0) return []

  // commitHash -> lane assignment
  const commitLaneMap = new Map<string, number>()
  // commitHash -> colorIndex
  const commitColorMap = new Map<string, number>()
  // Currently active lanes: lane index -> next expected commit hash
  const activeLanes: (string | null)[] = []
  // Track available lanes for reuse
  let nextColorIndex = 0

  const rows: GraphRow[] = []

  for (const entry of entries) {
    let lane: number
    let colorIndex: number

    // Check if this commit was expected in a specific lane
    const expectedLane = activeLanes.indexOf(entry.commit)

    if (expectedLane !== -1) {
      // This commit was expected, use its assigned lane
      lane = expectedLane
      colorIndex = commitColorMap.get(entry.commit) ?? nextColorIndex++
    } else {
      // New commit not expected — find or create a lane
      const freeLane = activeLanes.indexOf(null)
      lane = freeLane !== -1 ? freeLane : activeLanes.length
      colorIndex = nextColorIndex++
    }

    if (lane >= MAX_LANES) {
      lane = MAX_LANES - 1
    }

    commitLaneMap.set(entry.commit, lane)
    commitColorMap.set(entry.commit, colorIndex % BRANCH_COLORS.length)

    // Process parents
    const mergeFromLanes: number[] = []
    const parents = entry.parents

    if (parents.length > 0) {
      // First parent continues in the same lane
      const firstParent = parents[0]
      if (lane < activeLanes.length) {
        activeLanes[lane] = firstParent
      } else {
        while (activeLanes.length <= lane) activeLanes.push(null)
        activeLanes[lane] = firstParent
      }
      commitColorMap.set(firstParent, colorIndex % BRANCH_COLORS.length)

      // Additional parents (merge commits) get their own lanes
      for (let i = 1; i < parents.length; i++) {
        const parentHash = parents[i]
        const existingLane = activeLanes.indexOf(parentHash)

        if (existingLane !== -1) {
          // Parent already occupies a lane — draw merge line
          mergeFromLanes.push(existingLane)
        } else {
          // Assign parent to a new lane
          const freeLane = activeLanes.indexOf(null)
          const parentLane = freeLane !== -1 ? freeLane : activeLanes.length
          if (parentLane < MAX_LANES) {
            while (activeLanes.length <= parentLane) activeLanes.push(null)
            activeLanes[parentLane] = parentHash
            const parentColor = nextColorIndex++ % BRANCH_COLORS.length
            commitColorMap.set(parentHash, parentColor)
            mergeFromLanes.push(parentLane)
          }
        }
      }
    } else {
      // No parents — this is a root commit, clear the lane
      if (lane < activeLanes.length) {
        activeLanes[lane] = null
      }
    }

    // Clean up completed lanes
    if (expectedLane !== -1 && parents.length === 0) {
      activeLanes[expectedLane] = null
    }

    // Build active lanes snapshot (for drawing vertical lines)
    const currentActiveLanes = activeLanes.map((hash) => {
      if (hash === null) return -1
      return commitColorMap.get(hash) ?? -1
    })

    // Parse ref labels
    const refLabels = parseRefLabels(entry.refs)

    rows.push({
      entry,
      lane,
      colorIndex: colorIndex % BRANCH_COLORS.length,
      activeLanes: [...currentActiveLanes],
      mergeFromLanes,
      refLabels,
    })
  }

  return rows
}
