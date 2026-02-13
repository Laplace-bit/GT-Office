import type { AgentStation } from '@shell/layout/model'

export interface TaskDraftState {
  markdown: string
  targetStationIds: string[]
}

export interface TaskCenterNotice {
  kind: 'info' | 'success' | 'error'
  message: string
}

export type TaskDispatchStatus = 'sending' | 'sent' | 'failed'

export interface TaskDispatchRecord {
  batchId: string
  taskId: string
  title: string
  targetStationId: string
  targetStationName: string
  createdAtMs: number
  status: TaskDispatchStatus
  taskFilePath: string
  detail?: string
}

export interface StationTaskSignal {
  nonce: number
  taskId: string
  title: string
  receivedAtMs: number
}

export interface TaskCenterWorkspaceSnapshot {
  version: 2
  updatedAtMs: number
  draft: TaskDraftState
  dispatchHistory: TaskDispatchRecord[]
}

export type TaskMarkdownSnippet = 'heading' | 'code' | 'checklist'

const TASK_CENTER_LOCAL_STORAGE_PREFIX = 'gtoffice.task-center'
const TASK_CENTER_DRAFT_FILE_REL = '.gtoffice/tasks/.task-center-draft.json'

function dedupeStationIds(stationIds: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  stationIds.forEach((stationId) => {
    const normalized = stationId.trim()
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    result.push(normalized)
  })
  return result
}

export function createInitialTaskDraft(
  stations: AgentStation[],
  activeStationId: string,
): TaskDraftState {
  const hasActive = stations.some((station) => station.id === activeStationId)
  const fallback = stations[0]?.id ?? ''
  return {
    markdown: '',
    targetStationIds: hasActive ? [activeStationId] : fallback ? [fallback] : [],
  }
}

export function areTaskTargetsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((item, index) => item === right[index])
}

export function resolveValidTaskTargets(
  stations: AgentStation[],
  draftTargetStationIds: string[],
): string[] {
  const stationIdSet = new Set(stations.map((station) => station.id))
  return dedupeStationIds(draftTargetStationIds).filter((stationId) =>
    stationIdSet.has(stationId),
  )
}

export function toggleTaskTarget(
  previous: string[],
  stationId: string,
  checked: boolean,
): string[] {
  const normalized = stationId.trim()
  if (!normalized) {
    return previous
  }
  if (checked) {
    return dedupeStationIds([...previous, normalized])
  }
  return previous.filter((item) => item !== normalized)
}

export function extractTaskTitleFromMarkdown(markdown: string): string {
  const trimmed = markdown.trim()
  if (!trimmed) {
    return '未命名任务'
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return '未命名任务'
  }

  const firstHeading = lines.find((line) => /^#{1,6}\s+/.test(line))
  const candidate = (firstHeading ?? lines[0]).replace(/^#{1,6}\s+/, '').trim()
  if (!candidate) {
    return '未命名任务'
  }

  const compact = candidate.replace(/\s+/g, ' ')
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact
}

export function buildDispatchRecord(input: {
  batchId: string
  taskId: string
  title: string
  targetStationId: string
  targetStationName: string
  createdAtMs: number
  status: TaskDispatchStatus
  taskFilePath: string
  detail?: string
}): TaskDispatchRecord {
  return {
    batchId: input.batchId,
    taskId: input.taskId,
    title: input.title,
    targetStationId: input.targetStationId,
    targetStationName: input.targetStationName,
    createdAtMs: input.createdAtMs,
    status: input.status,
    taskFilePath: input.taskFilePath,
    detail: input.detail,
  }
}

export function pushTaskDispatchHistory(
  previous: TaskDispatchRecord[],
  nextRecord: TaskDispatchRecord,
  limit = 40,
): TaskDispatchRecord[] {
  return [nextRecord, ...previous].slice(0, limit)
}

export function replaceTaskDispatchRecord(
  previous: TaskDispatchRecord[],
  taskId: string,
  patch: Partial<TaskDispatchRecord>,
): TaskDispatchRecord[] {
  return previous.map((record) =>
    record.taskId === taskId ? { ...record, ...patch } : record,
  )
}

export function buildTaskDispatchCommand(taskId: string, taskFilePath: string): string {
  const escaped = taskFilePath.replace(/'/g, `'\\''`)
  return `echo '[vb-task] assigned ${taskId} from ${escaped}'`
}

export function buildMarkdownSnippet(snippet: TaskMarkdownSnippet): string {
  if (snippet === 'heading') {
    return '\n## 子任务\n- [ ] '
  }
  if (snippet === 'code') {
    return '\n```bash\n# command\n```\n'
  }
  return '\n- [ ] 待办-1\n- [ ] 待办-2\n'
}

export function buildTaskCenterStorageKey(workspaceId: string): string {
  return `${TASK_CENTER_LOCAL_STORAGE_PREFIX}:${workspaceId}`
}

export function buildTaskCenterDraftFilePath(): string {
  return TASK_CENTER_DRAFT_FILE_REL
}

function isTaskDispatchRecord(value: unknown): value is TaskDispatchRecord {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.taskId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.targetStationId === 'string' &&
    typeof record.targetStationName === 'string' &&
    typeof record.createdAtMs === 'number' &&
    typeof record.status === 'string' &&
    typeof record.taskFilePath === 'string'
  )
}

export function buildTaskCenterWorkspaceSnapshot(input: {
  updatedAtMs: number
  draft: TaskDraftState
  dispatchHistory: TaskDispatchRecord[]
}): TaskCenterWorkspaceSnapshot {
  return {
    version: 2,
    updatedAtMs: input.updatedAtMs,
    draft: {
      markdown: input.draft.markdown,
      targetStationIds: dedupeStationIds(input.draft.targetStationIds),
    },
    dispatchHistory: [...input.dispatchHistory],
  }
}

export function serializeTaskCenterWorkspaceSnapshot(
  snapshot: TaskCenterWorkspaceSnapshot,
): string {
  return JSON.stringify(snapshot, null, 2)
}

export function parseTaskCenterWorkspaceSnapshot(
  raw: string,
): TaskCenterWorkspaceSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const record = parsed as Record<string, unknown>
    const draft = record.draft as Record<string, unknown> | undefined
    if (!draft || typeof draft !== 'object') {
      return null
    }

    const dispatchHistoryRaw = Array.isArray(record.dispatchHistory)
      ? record.dispatchHistory.filter((item): item is TaskDispatchRecord =>
          isTaskDispatchRecord(item),
        )
      : []

    const targetStationIdsRaw =
      Array.isArray(draft.targetStationIds) &&
      draft.targetStationIds.every((id) => typeof id === 'string')
        ? (draft.targetStationIds as string[])
        : typeof draft.targetStationId === 'string'
          ? [draft.targetStationId]
          : []

    const markdown =
      typeof draft.markdown === 'string'
        ? draft.markdown
        : typeof draft.title === 'string'
          ? `# ${draft.title.trim()}\n\n`
          : ''

    const dispatchHistory = dispatchHistoryRaw.map((item) => ({
      ...item,
      batchId: typeof item.batchId === 'string' ? item.batchId : item.taskId,
    }))

    return {
      version: 2,
      updatedAtMs:
        typeof record.updatedAtMs === 'number' ? record.updatedAtMs : Date.now(),
      draft: {
        markdown,
        targetStationIds: dedupeStationIds(targetStationIdsRaw),
      },
      dispatchHistory: dispatchHistory.slice(0, 40),
    }
  } catch {
    return null
  }
}
