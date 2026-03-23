import type { Locale } from '../i18n/ui-locale'
import { t } from '../i18n/ui-locale'

export type NavItemId =
  | 'stations'
  | 'tasks'
  | 'files'
  | 'git'
  | 'hooks'
  | 'channels'
  | 'policy'

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

export function getNavItems(locale: Locale): NavItem[] {
  return [
    { id: 'files', label: t(locale, 'nav.files'), short: t(locale, 'nav.filesShort') },
    { id: 'git', label: t(locale, 'nav.git'), short: 'Git' },
    { id: 'tasks', label: t(locale, 'nav.tasks'), short: t(locale, 'nav.tasksShort') },
    { id: 'channels', label: t(locale, 'nav.channels'), short: t(locale, 'nav.channelsShort') },
    { id: 'stations', label: t(locale, 'nav.stations'), short: t(locale, 'nav.stationsShort') },
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
  }
}
