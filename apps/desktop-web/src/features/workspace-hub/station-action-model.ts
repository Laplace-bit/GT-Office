import type { AppIconName } from '@shell/ui/icons'
import type {
  ToolCommandArgument,
  ToolCommandCategory,
  ToolCommandDangerLevel,
  ToolCommandFamily,
  ToolCommandKind,
  ToolCommandPresentation,
  ToolCommandProviderKind,
  ToolCommandScopeKind,
  ToolCommandSummary,
  ToolCommandSurfaceTarget,
} from '@shell/integration/desktop-api'
import type { AgentStation } from './station-model'

export type StationProviderKind = ToolCommandProviderKind
export type StationActionKind = ToolCommandKind
export type StationActionCategory = ToolCommandCategory
export type StationActionFamily = ToolCommandFamily
export type StationActionSurfaceTarget = ToolCommandSurfaceTarget
export type StationActionScopeKind = ToolCommandScopeKind
export type StationActionDangerLevel = ToolCommandDangerLevel
export type StationActionGroupKind =
  | 'launch'
  | 'prompt'
  | 'submit'
  | 'templates'
  | 'advanced'
  | 'workspace'
  | 'profiles'
export type StationActionPresentation = 'button' | 'menu' | ToolCommandPresentation
export type StationActionArgument = ToolCommandArgument
export type StationActionRailSlot = 'primary' | 'all_commands'

export type StationActionExecution =
  | {
      type: 'insert_text'
      text: string
    }
  | {
      type: 'insert_and_submit'
      text: string
    }
  | {
      type: 'submit_terminal'
    }
  | {
      type: 'launch_cli'
    }
  | {
      type: 'open_command_sheet'
      command: string
      submit: boolean
    }
  | {
      type: 'open_settings_modal'
      section: 'general' | 'providers' | 'hooks' | 'mcp'
    }
  | {
      type: 'open_channel_studio'
    }
  | {
      type: 'launch_tool_profile'
      profileId: string
    }

export interface StationActionDescriptor {
  id: string
  label: string
  shortLabel?: string
  slashCommand?: string
  tooltip?: string
  icon: AppIconName
  providerKind: StationProviderKind
  commandFamily: StationActionFamily
  kind: StationActionKind
  category: StationActionCategory
  surfaceTarget: StationActionSurfaceTarget
  scopeKind: StationActionScopeKind
  priority: number
  group: StationActionGroupKind
  requiresLiveSession: boolean
  supportsDetachedWindow: boolean
  supportsParallelTargets: boolean
  presentation?: StationActionPresentation
  dangerLevel?: StationActionDangerLevel
  defaultPinned: boolean
  disabled?: boolean
  disabledReason?: string
  arguments?: StationActionArgument[]
  menuItems?: StationActionDescriptor[]
  execution: StationActionExecution
}

export interface StationActionRailModel {
  primaryActions: StationActionDescriptor[]
  allActions: StationActionDescriptor[]
}

export interface ResolveStationActionOptions {
  station: AgentStation
  hasTerminalSession: boolean
  detachedReadonly?: boolean
  commands?: ToolCommandSummary[]
}

export function getStationActionDisplayLabel(action: StationActionDescriptor): string {
  return action.slashCommand ?? action.label
}

export function isStationActionMenu(action: StationActionDescriptor): boolean {
  return action.presentation === 'menu' && (action.menuItems?.length ?? 0) > 0
}

export function composeStationActionCommand(
  action: StationActionDescriptor,
  values: Record<string, string | boolean>,
): string {
  if (action.execution.type !== 'open_command_sheet') {
    return ''
  }

  const parts = [action.execution.command]
  for (const argument of action.arguments ?? []) {
    const rawValue = values[argument.name]
    if (argument.kind === 'boolean') {
      if (rawValue === true) {
        parts.push(`--${argument.name}`)
      }
      continue
    }

    const normalized = String(rawValue ?? '').replace(/\s+/g, ' ').trim()
    if (!normalized) {
      continue
    }
    if (argument.kind === 'path' && /\s/.test(normalized)) {
      parts.push(`"${normalized.replace(/"/g, '\\"')}"`)
      continue
    }
    parts.push(normalized)
  }
  return parts.join(' ').trim()
}
