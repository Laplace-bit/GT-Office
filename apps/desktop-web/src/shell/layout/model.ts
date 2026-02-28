import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'
import { buildStationWorkdirs, type StationRole } from '@features/workspace'

export type { StationRole } from '@features/workspace'

export type NavItemId =
  | 'stations'
  | 'tasks'
  | 'files'
  | 'git'
  | 'hooks'
  | 'channels'
  | 'policy'
  | 'settings'

export interface NavItem {
  id: NavItemId
  label: string
  short: string
}

export interface PaneModel {
  title: string
  subtitle: string
  items: string[]
}

export interface CreateStationInput {
  name: string
  role: StationRole
  tool: string
  workdir: string
}

export const stationRoleOrder: StationRole[] = ['manager', 'product', 'build', 'quality_release']

export interface AgentStation {
  id: string
  name: string
  role: StationRole
  roleWorkdirRel: string
  agentWorkdirRel: string
  customWorkdir: boolean
  tool: string
  terminalSessionId: string
  state: 'running' | 'idle' | 'blocked'
  workspaceId: string
}

export function getNavItems(locale: Locale): NavItem[] {
  return [
    {
      id: 'stations',
      label: t(locale, 'nav.stations'),
      short: t(locale, 'nav.stationsShort'),
    },
    {
      id: 'tasks',
      label: t(locale, 'nav.tasks'),
      short: t(locale, 'nav.tasksShort'),
    },
    {
      id: 'files',
      label: t(locale, 'nav.files'),
      short: t(locale, 'nav.filesShort'),
    },
    { id: 'git', label: t(locale, 'nav.git'), short: 'Git' },
    {
      id: 'hooks',
      label: t(locale, 'nav.hooks'),
      short: t(locale, 'nav.hooksShort'),
    },
    {
      id: 'channels',
      label: t(locale, 'nav.channels'),
      short: t(locale, 'nav.channelsShort'),
    },
    {
      id: 'policy',
      label: t(locale, 'nav.policy'),
      short: t(locale, 'nav.policyShort'),
    },
    {
      id: 'settings',
      label: t(locale, 'nav.settings'),
      short: t(locale, 'nav.settingsShort'),
    },
  ]
}

export function getPaneModels(locale: Locale): Record<NavItemId, PaneModel> {
  return {
    stations: {
      title: t(locale, 'pane.stations.title'),
      subtitle: t(locale, 'pane.stations.subtitle'),
      items: [
        t(locale, 'pane.stations.managerCount'),
        t(locale, 'pane.stations.productCount'),
        t(locale, 'pane.stations.buildCount'),
        t(locale, 'pane.stations.qualityReleaseCount'),
      ],
    },
    tasks: {
      title: t(locale, 'pane.tasks.title'),
      subtitle: t(locale, 'pane.tasks.subtitle'),
      items: ['READY: 18', 'RUNNING: 37', 'BLOCKED: 4', 'FAILED: 2'],
    },
    files: {
      title: t(locale, 'fileTree.title'),
      subtitle: t(locale, 'pane.files.subtitle'),
      items: ['src/', 'crates/', 'docs/', '.gtoffice/', t(locale, 'pane.files.recentChanges')],
    },
    git: {
      title: t(locale, 'pane.git.title'),
      subtitle: t(locale, 'pane.git.subtitle'),
      items: [
        t(locale, 'pane.git.currentBranch', { branch: 'main' }),
        t(locale, 'pane.git.pendingFiles', { count: 9 }),
        t(locale, 'pane.git.unpushedCommits', { count: 2 }),
      ],
    },
    hooks: {
      title: t(locale, 'pane.hooks.title'),
      subtitle: t(locale, 'pane.hooks.subtitle'),
      items: ['git.commit.succeeded', 'terminal.session.started', 'task.failed'],
    },
    channels: {
      title: t(locale, 'pane.channels.title'),
      subtitle: t(locale, 'pane.channels.subtitle'),
      items: ['direct://product', 'group://build', 'broadcast://quality-release'],
    },
    policy: {
      title: t(locale, 'pane.policy.title'),
      subtitle: t(locale, 'pane.policy.subtitle'),
      items: ['ALLOW: terminal.exec', 'DENY: fs.write(outside workspace)', 'ALLOW: settings.read'],
    },
    settings: {
      title: t(locale, 'pane.settings.title'),
      subtitle: t(locale, 'pane.settings.subtitle'),
      items: [
        t(locale, 'pane.settings.theme'),
        t(locale, 'pane.settings.keymap'),
        t(locale, 'pane.settings.aiAllowlist'),
        'Tool Profiles',
      ],
    },
  }
}

type DefaultStationSeed = Omit<AgentStation, 'roleWorkdirRel' | 'agentWorkdirRel' | 'customWorkdir'>

const defaultStationSeeds: DefaultStationSeed[] = [
  {
    id: 'agent-01',
    name: '管理角色-01',
    role: 'manager',
    tool: 'codex cli',
    terminalSessionId: 'ts_101',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-02',
    name: '产品角色-01',
    role: 'product',
    tool: 'claude code',
    terminalSessionId: 'ts_102',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-03',
    name: '交付角色-01',
    role: 'build',
    tool: 'codex cli',
    terminalSessionId: 'ts_103',
    state: 'running',
    workspaceId: 'ws_gtoffice',
  },
  {
    id: 'agent-04',
    name: '质量发布-01',
    role: 'quality_release',
    tool: 'shell',
    terminalSessionId: 'ts_104',
    state: 'idle',
    workspaceId: 'ws_gtoffice',
  },
]

const defaultStationCards: AgentStation[] = defaultStationSeeds.map((station) => ({
  ...station,
  ...buildStationWorkdirs(station.role, station.id),
  customWorkdir: false,
}))

export function createDefaultStations(): AgentStation[] {
  return defaultStationCards.map((station) => ({ ...station }))
}
