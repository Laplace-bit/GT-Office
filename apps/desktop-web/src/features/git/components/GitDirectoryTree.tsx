import { memo, useCallback, useMemo, useState } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import type { GitStatusFile } from '@shell/integration/desktop-api'
import type { GitDiffScope } from '../useGitWorkspaceController'
import { resolveFileVisual, type FileVisual } from '../../file-explorer/file-visuals'
import { GitIconButton } from './GitIconButton'
import { getFileName, resolveDiscardKind, type GitDiscardKind } from './git-helpers'
import './GitDirectoryTree.scss'

interface GitTreeNodeData {
  id: string
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  gitFile?: GitStatusFile
  children: GitTreeNodeData[] | null
}

interface MutableTreeNode {
  id: string
  path: string
  name: string
  kind: 'dir' | 'file'
  visual: FileVisual
  gitFile?: GitStatusFile
  childMap: Map<string, MutableTreeNode> | null
}

function buildTreeData(
  files: GitStatusFile[],
  repositoryPath: string | undefined,
): GitTreeNodeData[] {
  const rootMap: Map<string, MutableTreeNode> = new Map()

  for (const file of files) {
    const relativePath = file.repoRelativePath || file.path
    const segments = relativePath.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let currentMap = rootMap
    let currentPath = ''
    const dirSegments = segments.slice(0, -1)
    for (const segment of dirSegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const existing = currentMap.get(currentPath)
      if (existing?.childMap) {
        currentMap = existing.childMap
      } else {
        const childMap = new Map<string, MutableTreeNode>()
        currentMap.set(currentPath, {
          id: currentPath,
          path: currentPath,
          name: segment,
          kind: 'dir',
          visual: resolveFileVisual(currentPath, 'dir', false),
          childMap,
        })
        currentMap = childMap
      }
    }

    const fileName = segments[segments.length - 1]
    const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
    currentMap.set(filePath, {
      id: filePath,
      path: filePath,
      name: fileName,
      kind: 'file',
      visual: resolveFileVisual(fileName, 'file'),
      gitFile: file,
      childMap: null,
    })
  }

  function mapToSortedArray(map: Map<string, MutableTreeNode>): GitTreeNodeData[] {
    return Array.from(map.values())
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
          kind: 'dir',
          visual: resolveFileVisual(repositoryPath, 'dir', true),
          children,
        },
      ]
    }
  }

  return mapToSortedArray(rootMap)
}

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

interface GitTreeNodeProps {
  node: GitTreeNodeData
  depth: number
  locale: Locale
  actionLoading: string | null
  filter: 'staged' | 'unstaged'
  selectedPath: string | null
  collapsedNodes: Record<string, boolean>
  onToggleNode: (nodeId: string) => void
  onSelect: (path: string, scope: GitDiffScope) => void
  onPreload: (path: string, scope: GitDiffScope) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onDiscard: (path: string, discardKind: GitDiscardKind) => void
}

const GitTreeNode = memo(function GitTreeNode({
  node,
  depth,
  locale,
  actionLoading,
  filter,
  selectedPath,
  collapsedNodes,
  onToggleNode,
  onSelect,
  onPreload,
  onStage,
  onUnstage,
  onDiscard,
}: GitTreeNodeProps) {
  const Icon = node.visual.icon
  const indentStyle = { paddingLeft: `${depth * 14}px` }

  if (node.kind === 'dir') {
    const isExpanded = !collapsedNodes[node.id]
    const children = node.children ?? []
    return (
      <li className="git-directory-tree__item">
        <button
          type="button"
          className={`git-dir-node ${isExpanded ? 'git-dir-node--expanded' : ''}`}
          style={indentStyle}
          onClick={() => onToggleNode(node.id)}
          aria-expanded={isExpanded}
          title={node.path}
        >
          <span className="git-dir-node__toggle" aria-hidden="true">
            <svg
              className="git-dir-node__chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
            >
              <path
                d={isExpanded ? 'M2 4L6 8L10 4' : 'M4 2L8 6L4 10'}
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
          <span className="git-dir-node__name">{node.name}</span>
        </button>
        {isExpanded && children.length > 0 ? (
          <ul className="git-directory-tree__list">
            {children.map((child) => (
              <GitTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                locale={locale}
                actionLoading={actionLoading}
                filter={filter}
                selectedPath={selectedPath}
                collapsedNodes={collapsedNodes}
                onToggleNode={onToggleNode}
                onSelect={onSelect}
                onPreload={onPreload}
                onStage={onStage}
                onUnstage={onUnstage}
                onDiscard={onDiscard}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  const file = node.gitFile
  if (!file) return null
  const isActive = selectedPath === file.path
  const diffScope: GitDiffScope = filter
  const discardKind = resolveDiscardKind(file)

  return (
    <li className="git-directory-tree__item">
      <div
        className={`git-file-node ${isActive ? 'git-file-node--active' : ''}`}
        style={indentStyle}
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
    </li>
  )
})

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
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({})

  const treeData = useMemo(() => buildTreeData(files, repositoryPath), [files, repositoryPath])

  const handleToggleNode = useCallback((nodeId: string) => {
    setCollapsedNodes((current) => ({ ...current, [nodeId]: !current[nodeId] }))
  }, [])

  if (treeData.length === 0) {
    return (
      <div className="git-directory-tree git-directory-tree--empty">
        <p className="git-directory-tree__empty-text">{t(locale, 'git.files.noChanges')}</p>
      </div>
    )
  }

  return (
    <div className="git-directory-tree">
      <ul className="git-directory-tree__list">
        {treeData.map((node) => (
          <GitTreeNode
            key={node.id}
            node={node}
            depth={0}
            locale={locale}
            actionLoading={actionLoading}
            filter={filter}
            selectedPath={selectedPath}
            collapsedNodes={collapsedNodes}
            onToggleNode={handleToggleNode}
            onSelect={onSelect}
            onPreload={onPreload}
            onStage={onStage}
            onUnstage={onUnstage}
            onDiscard={onDiscard}
          />
        ))}
      </ul>
    </div>
  )
})
