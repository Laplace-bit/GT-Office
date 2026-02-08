import type { AgentStation } from './model'

export type TaskAttachmentCategory =
  | 'code'
  | 'image'
  | 'document'
  | 'archive'
  | 'media'
  | 'data'
  | 'other'

export interface TaskAttachment {
  id: string
  path: string
  name: string
  category: TaskAttachmentCategory
}

export interface TaskDraftState {
  title: string
  markdown: string
  targetStationId: string
  attachmentInput: string
}

export type TaskDispatchStatus = 'sending' | 'sent' | 'failed'

export interface TaskDispatchRecord {
  taskId: string
  title: string
  targetStationId: string
  targetStationName: string
  attachmentCount: number
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
  version: 1
  updatedAtMs: number
  draft: TaskDraftState
  attachments: TaskAttachment[]
  dispatchHistory: TaskDispatchRecord[]
}

export interface BuiltTaskDocument {
  taskId: string
  title: string
  taskFilePath: string
  manifestPath: string
  markdownContent: string
  manifestContent: string
}

export type TaskMarkdownSnippet = 'heading' | 'code' | 'checklist'
const TASK_CENTER_LOCAL_STORAGE_PREFIX = 'gtoffice.task-center'
const TASK_CENTER_DRAFT_FILE_REL = '.gtoffice/tasks/.task-center-draft.json'

function normalizeRelativePath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '')
}

function normalizeFileName(path: string): string {
  const normalized = normalizeRelativePath(path)
  if (!normalized) {
    return ''
  }
  const parts = normalized.split('/')
  return parts[parts.length - 1] ?? normalized
}

function inferAttachmentCategory(path: string): TaskAttachmentCategory {
  const normalized = normalizeRelativePath(path).toLowerCase()
  const ext = normalized.includes('.') ? normalized.slice(normalized.lastIndexOf('.')) : ''
  if (['.rs', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.md', '.toml', '.yaml', '.yml', '.json'].includes(ext)) {
    return 'code'
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) {
    return 'image'
  }
  if (['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt'].includes(ext)) {
    return 'document'
  }
  if (['.zip', '.tar', '.gz', '.rar', '.7z'].includes(ext)) {
    return 'archive'
  }
  if (['.mp3', '.wav', '.flac', '.mp4', '.mov', '.mkv', '.avi'].includes(ext)) {
    return 'media'
  }
  if (['.csv', '.parquet', '.sqlite', '.db'].includes(ext)) {
    return 'data'
  }
  return 'other'
}

export function createInitialTaskDraft(stations: AgentStation[], activeStationId: string): TaskDraftState {
  const hasActive = stations.some((station) => station.id === activeStationId)
  const fallback = stations[0]?.id ?? ''
  return {
    title: '',
    markdown: '',
    targetStationId: hasActive ? activeStationId : fallback,
    attachmentInput: '',
  }
}

export function resolveValidTaskTarget(
  stations: AgentStation[],
  draftTargetStationId: string,
  activeStationId: string,
): string {
  if (stations.some((station) => station.id === draftTargetStationId)) {
    return draftTargetStationId
  }
  if (stations.some((station) => station.id === activeStationId)) {
    return activeStationId
  }
  return stations[0]?.id ?? ''
}

export function buildTaskId(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 6)
  return `task_${compact}_${random}`
}

export function createTaskAttachment(path: string): TaskAttachment | null {
  const normalized = normalizeRelativePath(path)
  if (!normalized) {
    return null
  }
  return {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    path: normalized,
    name: normalizeFileName(normalized),
    category: inferAttachmentCategory(normalized),
  }
}

export function buildAttachmentReferenceMarkdown(attachment: TaskAttachment): string {
  if (attachment.category === 'image') {
    return `![${attachment.name}](${attachment.path})`
  }
  return `[${attachment.name}](${attachment.path})`
}

export function buildTaskStoragePaths(taskId: string): { taskFilePath: string; manifestPath: string } {
  return {
    taskFilePath: `.gtoffice/tasks/${taskId}/task.md`,
    manifestPath: `.gtoffice/tasks/${taskId}/manifest.json`,
  }
}

function sanitizeTaskTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed || '未命名任务'
}

export function buildTaskDocument(input: {
  taskId: string
  draft: TaskDraftState
  targetStation: AgentStation
  attachments: TaskAttachment[]
  createdAt: Date
}): BuiltTaskDocument {
  const { taskFilePath, manifestPath } = buildTaskStoragePaths(input.taskId)
  const title = sanitizeTaskTitle(input.draft.title)
  const createdAtIso = input.createdAt.toISOString()
  const attachmentSection =
    input.attachments.length === 0
      ? '- 无附件'
      : input.attachments.map((item) => `- ${buildAttachmentReferenceMarkdown(item)} (${item.category})`).join('\n')
  const markdownBody = input.draft.markdown.trim()

  const markdownContent = `# ${title}

## 元信息

- task_id: ${input.taskId}
- created_at: ${createdAtIso}
- target_agent_id: ${input.targetStation.id}
- target_agent_name: ${input.targetStation.name}
- target_role: ${input.targetStation.role}
- target_workspace_id: ${input.targetStation.workspaceId}

## 任务内容

${markdownBody}

## 附件

${attachmentSection}
`

  const manifestContent = JSON.stringify(
    {
      taskId: input.taskId,
      title,
      createdAt: createdAtIso,
      target: {
        stationId: input.targetStation.id,
        stationName: input.targetStation.name,
        role: input.targetStation.role,
        workspaceId: input.targetStation.workspaceId,
      },
      attachments: input.attachments,
      taskFilePath,
    },
    null,
    2,
  )

  return {
    taskId: input.taskId,
    title,
    taskFilePath,
    manifestPath,
    markdownContent,
    manifestContent,
  }
}

export function buildDispatchRecord(input: {
  taskId: string
  title: string
  targetStation: AgentStation
  attachmentCount: number
  createdAtMs: number
  status: TaskDispatchStatus
  taskFilePath: string
  detail?: string
}): TaskDispatchRecord {
  return {
    taskId: input.taskId,
    title: input.title,
    targetStationId: input.targetStation.id,
    targetStationName: input.targetStation.name,
    attachmentCount: input.attachmentCount,
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
  return previous.map((record) => (record.taskId === taskId ? { ...record, ...patch } : record))
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

function isTaskAttachment(value: unknown): value is TaskAttachment {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.path === 'string' &&
    typeof record.name === 'string' &&
    typeof record.category === 'string'
  )
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
    typeof record.attachmentCount === 'number' &&
    typeof record.createdAtMs === 'number' &&
    typeof record.status === 'string' &&
    typeof record.taskFilePath === 'string'
  )
}

export function buildTaskCenterWorkspaceSnapshot(input: {
  updatedAtMs: number
  draft: TaskDraftState
  attachments: TaskAttachment[]
  dispatchHistory: TaskDispatchRecord[]
}): TaskCenterWorkspaceSnapshot {
  return {
    version: 1,
    updatedAtMs: input.updatedAtMs,
    draft: {
      title: input.draft.title,
      markdown: input.draft.markdown,
      targetStationId: input.draft.targetStationId,
      attachmentInput: input.draft.attachmentInput,
    },
    attachments: [...input.attachments],
    dispatchHistory: [...input.dispatchHistory],
  }
}

export function serializeTaskCenterWorkspaceSnapshot(snapshot: TaskCenterWorkspaceSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

export function parseTaskCenterWorkspaceSnapshot(raw: string): TaskCenterWorkspaceSnapshot | null {
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
    const attachments = Array.isArray(record.attachments)
      ? record.attachments.filter((item): item is TaskAttachment => isTaskAttachment(item))
      : []
    const dispatchHistory = Array.isArray(record.dispatchHistory)
      ? record.dispatchHistory.filter((item): item is TaskDispatchRecord => isTaskDispatchRecord(item))
      : []
    if (typeof draft.title !== 'string' || typeof draft.markdown !== 'string' || typeof draft.targetStationId !== 'string') {
      return null
    }
    return {
      version: 1,
      updatedAtMs: typeof record.updatedAtMs === 'number' ? record.updatedAtMs : Date.now(),
      draft: {
        title: draft.title,
        markdown: draft.markdown,
        targetStationId: draft.targetStationId,
        attachmentInput: typeof draft.attachmentInput === 'string' ? draft.attachmentInput : '',
      },
      attachments,
      dispatchHistory: dispatchHistory.slice(0, 40),
    }
  } catch {
    return null
  }
}
