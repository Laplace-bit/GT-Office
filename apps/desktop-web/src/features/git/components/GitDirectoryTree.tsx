import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Tree, type NodeRendererProps, type TreeApi } from 'react-arborist'
import { t, type Locale } from '@shell/i18n/ui-locale'
import type { GitStatusFile } from '@shell/integration/desktop-api'
import type { GitDiffScope } from '../useGitWorkspaceController'
import { resolveFileVisual, type FileVisual } from '../../file-explorer/file-visuals'
import { getSharedTreeDndManager } from '../../file-explorer/shared-dnd-manager'
import { GitIconButton } from './GitIconButton'
import { getFileName, resolveDiscardKind, type GitDiscardKind } from './git-helpers'
import './GitDirectoryTree.scss'

// ============================================
// Tree Data Types
// ============================================

interface GitTreeNodeData {
  id: string
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  gitFile?: GitStatusFile
  children: GitTreeNodeData[] | null
}

// Internal mutable node used during tree construction
interface MutableTreeNode {
  id: string
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  gitFile?: GitStatusFile
  children: MutableTreeNode[] | null
  childMap: Map<string, MutableTreeNode> | null
}

const ROW_HEIGHT = 34
const OVERSCAN_COUNT = 16
const INDENT = 14

// ============================================
// Tree Data Construction
// ============================================

function buildTreeData(
  files: GitStatusFile[],
  repositoryPath: string | undefined,
): GitTreeNodeData[] {
  const rootMap: Map<string, MutableTreeNode> = new Map()

  for (const file of files) {
    const relativePath = file.repoRelativePath || file.path
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length === 0) continue

    // Walk/create directory nodes
    let currentMap = rootMap
    let currentPath = ''
    const dirSegments = segments.slice(0, -1)
    for (const segment of dirSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const existing = currentMap.get(currentPath)
      if (existing && existing.childMap) {
        currentMap = existing.childMap
      } else {
        const childMap = new Map<string, MutableTreeNode>()
        const dirNode: MutableTreeNode = {
          id: currentPath,
          path: currentPath,
          name: segment,
          kind: 'dir',
          visual: resolveFileVisual(currentPath, 'dir', false),
          children: [],
          childMap,
        }
        currentMap.set(currentPath, dirNode)
        currentMap = childMap
      }
    }

    // Create file node
    const fileName = segments[segments.length - 1]
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
    const fileNode: MutableTreeNode = {
      id: filePath,
      path: filePath,
      name: fileName,
      kind: 'file',
      visual: resolveFileVisual(fileName, 'file'),
      gitFile: file,
      children: null,
      childMap: null,
    }
    currentMap.set(filePath, fileNode)
  }

  // Convert mutable nodes to sorted immutable tree data
  function mapToSortedArray(map: Map<string, MutableTreeNode>): GitTreeNodeData[] {
    const items = Array.from(map.values())
    return items
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
      .map((node) => ({
        id: node.id,
        path: node.path,
        name: node.name,
        kind: node.kind,
        visual: node.visual,
        gitFile: node.gitFile,
        children: node.childMap ? mapToSortedArray(node.childMap) : null,
      }))
  }

  // If there's a repository label, wrap in a repo root
  if (repositoryPath) {
    const children = mapToSortedArray(rootMap)
    if (children.length > 0) {
      const repoSegments = repositoryPath.replace(/\\/g, '/').split('/').filter(Boolean)
      const repoName = repoSegments[repoSegments.length - 1] || repositoryPath
      return [
        {
          id: repositoryPath,
          path: repositoryPath,
          name: repoName,
          kind: 'dir' as const,
          visual: resolveFileVisual(repositoryPath, 'dir', true),
          children,
        },
      ]
    }
  }

  return mapToSortedArray(rootMap)
}

// ============================================
// Tree Node Renderer
// ============================================

interface GitTreeNodeProps {
  node: NodeRendererProps<GitTreeNodeData>['node']
  style: NodeRendererProps<GitTreeNodeData>['style']
  locale: Locale
  actionLoading: string | null
  filter: 'staged' | 'unstaged'
  selectedPath: string | null
  onSelect: (path: string, scope: GitDiffScope) => void
  onPreload: (path: string, scope: GitDiffScope) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onDiscard: (path: string, discardKind: GitDiscardKind) => void
}

const GitTreeNodeInner = memo(function GitTreeNodeInner({
  node,
  style,
  locale,
  actionLoading,
  filter,
  selectedPath,
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
}: GitTreeNodeProps) {
  const data = node.data
  const isDir = data.kind === 'dir'
  const isExpanded = node.isOpen
  const Icon = data.visual.icon
  const isActive = !isDir && selectedPath === data.gitFile?.path

  if (isDir) {
    return (
      <div style={style} className={`git-dir-node ${isExpanded ? 'git-dir-node--expanded' : ''}`}>
        <span
          className="git-dir-node__toggle"
          onClick={(e) => {
            e.stopPropagation()
            node.toggle()
          }}
        >
          <svg
            className="git-dir-node__chevron"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d={isExpanded ? 'M3 2L7 6L3 10' : 'M2 3L6 6L2 9'}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="git-dir-node__icon-wrap">
          <Icon className="git-dir-node__icon" width="14" height="14" />
        </span>
        <span className="git-dir-node__name" title={data.path}>
          {data.name}
        </span>
      </div>
    )
  }

  const file = data.gitFile
  if (!file) return null

  const discardKind = resolveDiscardKind(file)
  const diffScope: GitDiffScope = filter

  return (
    <div
      style={style}
      className={`git-file-node ${isActive ? 'git-file-node--active' : ''}`}
      onMouseEnter={() => onPreload(file.path, diffScope)}
    >
      <button
        type="button"
        className="git-file-node__select"
        onClick={() => onSelect(file.path, diffScope)}
        title={file.path}
        aria-label={file.path}
      >
        <span className="git-file-node__icon-wrap">
          <Icon className="git-file-node__icon" width="14" height="14" />
        </span>
        <span className="git-file-node__name">{getFileName(file.path)}</span>
        <span
          className={`git-file-node__status ${file.staged ? 'git-file-node__status--staged' : 'git-file-node__status--unstaged'}`}
        >
          {file.status || '—'}
        </span>
      </button>
      <div className="git-file-node__actions">
        {filter === 'staged' ? (
          <GitIconButton
            icon="undo"
            label={t(locale, 'git.action.unstage')}
            onClick={() => onUnstage(file.path)}
            disabled={Boolean(actionLoading)}
            size="sm"
          />
        ) : (
          <>
            <GitIconButton
              icon="check"
              label={t(locale, 'git.action.stage')}
              onClick={() => onStage(file.path)}
              disabled={Boolean(actionLoading)}
              size="sm"
              variant="success"
            />
            <GitIconButton
              icon="rotate-ccw"
              label={t(locale, 'git.action.discard')}
              onClick={() => onDiscard(file.path, discardKind)}
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

// ============================================
// GitDirectoryTree Component
// ============================================

interface GitDirectoryTreeProps {
  files: GitStatusFile[]
  repositoryPath: string | undefined
  locale: Locale
  actionLoading: string | null
  filter: 'staged' | 'unstaged'
  selectedPath: string | null
  onSelect: (path: string, scope: GitDiffScope) => void
  onPreload: (path: string, scope: GitDiffScope) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onDiscard: (path: string, discardKind: GitDiscardKind) => void
}

export const GitDirectoryTree = memo(function GitDirectoryTree({
  files,
  repositoryPath,
  locale,
  actionLoading,
  filter,
  selectedPath,
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
}: GitDirectoryTreeProps) {
  const treeRef = useRef<TreeApi<GitTreeNodeData>>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [treeSize, setTreeSize] = useState({ width: 0, height: 0 })
  const treeDndManager = useMemo(() => getSharedTreeDndManager(), [])

  const treeData = useMemo(
    () => buildTreeData(files, repositoryPath),
    [files, repositoryPath],
  )

  const handleSelect = useCallback(
    (nodes: { data: GitTreeNodeData }[]) => {
      const node = nodes[0]
      if (node && node.data.kind === 'file' && node.data.gitFile) {
        onSelect(node.data.gitFile.path, filter)
      }
    },
    [onSelect, filter],
  )

  const handleActivate = useCallback(
    (node: { data: GitTreeNodeData; toggle: () => void }) => {
      if (node.data.kind === 'dir') {
        node.toggle()
      } else if (node.data.gitFile) {
        onSelect(node.data.gitFile.path, filter)
      }
    },
    [onSelect, filter],
  )

  // Observe container size for the Tree component
  const measureContainer = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const nextWidth = Math.max(0, Math.round(rect.width))
    const nextHeight = Math.max(0, Math.round(rect.height))
    setTreeSize((current) =>
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight },
    )
  }, [])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    measureContainer()
    const observer = new ResizeObserver(measureContainer)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measureContainer])

  const renderNode = useCallback(
    (props: NodeRendererProps<GitTreeNodeData>) => (
      <GitTreeNodeInner
        node={props.node}
        style={props.style}
        locale={locale}
        actionLoading={actionLoading}
        filter={filter}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onPreload={onPreload}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
      />
    ),
    [locale, actionLoading, filter, selectedPath, onSelect, onPreload, onStage, onUnstage, onDiscard],
  )

  if (treeData.length === 0) {
    return (
      <div className="git-directory-tree git-directory-tree--empty">
        <p className="git-directory-tree__empty-text">{t(locale, 'git.files.noChanges')}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="git-directory-tree">
      {treeSize.width > 0 && treeSize.height > 0 ? (
        <Tree<GitTreeNodeData>
          ref={treeRef}
          dndManager={treeDndManager}
          data={treeData}
          width={treeSize.width}
          height={treeSize.height}
          rowHeight={ROW_HEIGHT}
          indent={INDENT}
          overscanCount={OVERSCAN_COUNT}
          openByDefault
          selectionFollowsFocus
          onSelect={handleSelect}
          onActivate={handleActivate}
        >
          {renderNode}
        </Tree>
      ) : null}
    </div>
  )
})