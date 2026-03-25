import type { AppIconName } from '@shell/ui/icons'
import type { ToolCommandSummary } from '@shell/integration/desktop-api'
import { defaultUiPreferences, type UiPreferences } from '@shell/state/ui-preferences'
import type {
  ResolveStationActionOptions,
  StationActionDescriptor,
  StationActionExecution,
  StationActionGroupKind,
  StationActionRailModel,
} from './station-action-model'

const ICON_MAP: Record<string, AppIconName> = {
  activity: 'activity',
  'at-sign': 'file-text',
  'arrow-up': 'arrow-up',
  'bar-chart-3': 'activity',
  brain: 'file-text',
  'book-open': 'file-text',
  bug: 'info',
  channels: 'channels',
  chrome: 'external',
  'clipboard-list': 'tasks',
  coins: 'activity',
  command: 'command',
  copy: 'copy',
  cpu: 'sparkles',
  eraser: 'trash',
  external: 'external',
  'folder-plus': 'folder-plus',
  'git-diff': 'git-branch',
  info: 'info',
  keyboard: 'command',
  layers: 'files',
  'layers-3': 'tasks',
  link: 'link',
  'git-branch': 'git-branch',
  'log-in': 'external',
  'log-out': 'external',
  'maximize-2': 'expand',
  'minimize-2': 'collapse',
  'message-square': 'channels',
  'monitor-smartphone': 'external',
  palette: 'settings',
  play: 'arrow-up',
  plus: 'plus',
  puzzle: 'sparkles',
  repeat: 'sync',
  rewind: 'rotate-ccw',
  'scan-search': 'tasks',
  settings: 'settings',
  shield: 'policy',
  'shield-check': 'policy',
  'sliders-horizontal': 'settings',
  sparkles: 'sparkles',
  stethoscope: 'info',
  terminal: 'terminal',
  users: 'stations',
  workflow: 'hooks',
  zap: 'sparkles',
  'edit-3': 'file-text',
}

function normalizeGroup(group: string): StationActionGroupKind {
  switch (group) {
    case 'launch':
    case 'prompt':
    case 'submit':
    case 'templates':
    case 'advanced':
    case 'workspace':
    case 'profiles':
      return group
    default:
      return 'templates'
  }
}

function normalizeIcon(icon: string): AppIconName {
  return ICON_MAP[icon] ?? 'sparkles'
}

function normalizeSettingsSection(
  section: string,
): 'general' | 'providers' | 'hooks' | 'mcp' {
  if (section === 'providers' || section === 'hooks' || section === 'mcp') {
    return section
  }
  return 'general'
}

function mapExecution(command: ToolCommandSummary): StationActionExecution {
  if (command.id === 'submit-terminal') {
    return { type: 'submit_terminal' }
  }

  switch (command.execution.type) {
    case 'insert_text':
      return command.execution.submit
        ? { type: 'insert_and_submit', text: command.execution.text }
        : { type: 'insert_text', text: command.execution.text }
    case 'open_command_sheet':
      return {
        type: 'open_command_sheet',
        command: command.execution.command,
        submit: command.execution.submit,
      }
    case 'launch_profile':
      return {
        type: 'launch_tool_profile',
        profileId: command.execution.profileId,
      }
    case 'open_settings_modal':
      return {
        type: 'open_settings_modal',
        section: normalizeSettingsSection(command.execution.section),
      }
    case 'open_channel_studio':
      return { type: 'open_channel_studio' }
    default:
      return { type: 'insert_text', text: '' }
  }
}

function isRailEligibleCommand(command: ToolCommandSummary): boolean {
  if (command.surfaceTarget !== 'terminal') {
    return false
  }

  if (!command.slashCommand?.startsWith('/')) {
    return false
  }

  return command.execution.type === 'insert_text' || command.execution.type === 'open_command_sheet'
}

function mapCommand(
  command: ToolCommandSummary,
  detachedReadonly: boolean,
): StationActionDescriptor {
  const detachedUnsupported =
    detachedReadonly &&
    (!command.supportsDetachedWindow || command.surfaceTarget === 'workspace_ui')
  const disabledReason =
    !command.enabled
      ? command.disabledReason ?? undefined
      : detachedUnsupported
        ? 'Open this action from the main workspace window.'
        : undefined

  return {
    id: command.id,
    label: command.label,
    shortLabel: command.shortLabel ?? undefined,
    slashCommand: command.slashCommand ?? undefined,
    tooltip: command.tooltip ?? undefined,
    icon: normalizeIcon(command.icon),
    providerKind: command.providerKind,
    commandFamily: command.commandFamily,
    kind: command.kind,
    category: command.category,
    surfaceTarget: command.surfaceTarget,
    scopeKind: command.scopeKind,
    priority: command.priority,
    group: normalizeGroup(command.group),
    requiresLiveSession: command.requiresLiveSession,
    supportsDetachedWindow: command.supportsDetachedWindow,
    supportsParallelTargets: command.supportsParallelTargets,
    presentation: command.presentation,
    dangerLevel: command.dangerLevel,
    defaultPinned: command.defaultPinned,
    disabled: Boolean(disabledReason),
    disabledReason,
    arguments: command.arguments,
    execution: mapExecution(command),
  }
}

function getPinnedPreferenceKey(action: StationActionDescriptor): string {
  if (action.slashCommand?.startsWith('/')) {
    return action.slashCommand.slice(1).replace(/\s+/g, '-').toLowerCase()
  }
  return action.id.replace(/^[^-]+-/, '')
}

function getPinnedProviderId(providerKind: StationActionDescriptor['providerKind']): 'claude' | 'codex' | null {
  if (providerKind === 'claude' || providerKind === 'codex') {
    return providerKind
  }
  return null
}

function resolvePinnedPreferenceSet(
  providerKind: StationActionDescriptor['providerKind'],
  uiPreferences?: Pick<UiPreferences, 'pinnedCommandIdsByProvider'>,
): Set<string> {
  const providerId = getPinnedProviderId(providerKind)
  if (!providerId) {
    return new Set()
  }
  const source =
    uiPreferences?.pinnedCommandIdsByProvider[providerId] ??
    defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
    []
  return new Set(source)
}

function buildRailActions(
  actions: StationActionDescriptor[],
  uiPreferences?: Pick<UiPreferences, 'pinnedCommandIdsByProvider'>,
): StationActionDescriptor[] {
  return actions
    .filter((action) => {
      const pinnedSet = resolvePinnedPreferenceSet(action.providerKind, uiPreferences)
      return pinnedSet.has(getPinnedPreferenceKey(action))
    })
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
}

export function buildStationActionRailModel(
  actions: StationActionDescriptor[],
  uiPreferences?: Pick<UiPreferences, 'pinnedCommandIdsByProvider'>,
): StationActionRailModel {
  const eligibleActions = buildRailActions(actions, uiPreferences)

  return {
    primaryActions: eligibleActions,
    allActions: eligibleActions,
  }
}

export function resolveStationActions({
  station,
  hasTerminalSession: _hasTerminalSession,
  detachedReadonly = false,
  commands = [],
}: ResolveStationActionOptions): StationActionDescriptor[] {
  return commands
    .filter((command) => isRailEligibleCommand(command))
    .map((command) => mapCommand(command, detachedReadonly))
    .filter((action) => action.providerKind === 'any' || action.providerKind === station.toolKind)
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
}
