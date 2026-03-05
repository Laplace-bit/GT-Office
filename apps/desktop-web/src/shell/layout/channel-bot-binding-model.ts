import type { ChannelConnectorAccount, ChannelRouteBinding } from '../integration/desktop-api'

const ROLE_TARGET_PREFIX = 'role:'
const DEFAULT_ACCOUNT_ID = 'default'

export interface ParsedChannelBindingTarget {
  type: 'role' | 'agent'
  value: string
}

export interface ChannelBotRouteSummary {
  binding: ChannelRouteBinding
  target: ParsedChannelBindingTarget
}

export interface ChannelBotBindingGroup {
  channel: string
  accountId: string
  hasBotAccount: boolean
  routes: ChannelBotRouteSummary[]
}

export interface StationChannelBotBindingSummary {
  channel: string
  accountId: string
  routeCount: number
}

interface StationDescriptor {
  id: string
  role: string
}

function normalizeCompareKey(value: string): string {
  return value.trim().toLowerCase()
}

function compareChannelOrder(channel: string): number {
  const normalized = normalizeCompareKey(channel)
  if (normalized === 'telegram') {
    return 0
  }
  if (normalized === 'feishu') {
    return 1
  }
  return 2
}

function compareChannelName(a: string, b: string): number {
  const aOrder = compareChannelOrder(a)
  const bOrder = compareChannelOrder(b)
  if (aOrder !== bOrder) {
    return aOrder - bOrder
  }
  return a.localeCompare(b)
}

export function normalizeChannelAccountId(accountId?: string | null): string {
  const trimmed = typeof accountId === 'string' ? accountId.trim() : ''
  return trimmed.length > 0 ? trimmed : DEFAULT_ACCOUNT_ID
}

export function parseChannelBindingTarget(targetAgentId: string): ParsedChannelBindingTarget {
  const trimmed = targetAgentId.trim()
  if (trimmed.startsWith(ROLE_TARGET_PREFIX)) {
    return {
      type: 'role',
      value: trimmed.slice(ROLE_TARGET_PREFIX.length).trim(),
    }
  }
  return {
    type: 'agent',
    value: trimmed,
  }
}

export function buildChannelBotBindingGroups(input: {
  bindings: ChannelRouteBinding[]
  accounts?: ChannelConnectorAccount[]
  configuredChannels?: string[]
}): ChannelBotBindingGroup[] {
  const groups = new Map<string, ChannelBotBindingGroup>()

  const ensureGroup = (channel: string, accountId: string, hasBotAccount: boolean) => {
    const key = `${channel}::${accountId}`
    const existing = groups.get(key)
    if (existing) {
      existing.hasBotAccount = existing.hasBotAccount || hasBotAccount
      return existing
    }
    const created: ChannelBotBindingGroup = {
      channel,
      accountId,
      hasBotAccount,
      routes: [],
    }
    groups.set(key, created)
    return created
  }

  input.bindings.forEach((binding) => {
    const accountId = normalizeChannelAccountId(binding.accountId)
    const group = ensureGroup(binding.channel, accountId, false)
    group.routes.push({
      binding,
      target: parseChannelBindingTarget(binding.targetAgentId),
    })
  })

  const inputAccounts = input.accounts ?? []
  inputAccounts.forEach((account) => {
    const accountId = normalizeChannelAccountId(account.accountId)
    ensureGroup(account.channel, accountId, true)
  })

  const configuredChannels = input.configuredChannels ?? []
  configuredChannels.forEach((channel) => {
    const normalizedChannel = channel.trim()
    if (!normalizedChannel) {
      return
    }
    ensureGroup(normalizedChannel, DEFAULT_ACCOUNT_ID, false)
  })

  const sortedGroups = Array.from(groups.values())
  sortedGroups.forEach((group) => {
    group.routes.sort((a, b) => (b.binding.priority ?? 0) - (a.binding.priority ?? 0))
  })
  sortedGroups.sort((a, b) => {
    const channelCompare = compareChannelName(a.channel, b.channel)
    if (channelCompare !== 0) {
      return channelCompare
    }
    if (a.accountId === DEFAULT_ACCOUNT_ID && b.accountId !== DEFAULT_ACCOUNT_ID) {
      return -1
    }
    if (a.accountId !== DEFAULT_ACCOUNT_ID && b.accountId === DEFAULT_ACCOUNT_ID) {
      return 1
    }
    return a.accountId.localeCompare(b.accountId)
  })

  return sortedGroups
}

export function buildStationChannelBotBindingMap(
  stations: StationDescriptor[],
  bindings: ChannelRouteBinding[],
): Record<string, StationChannelBotBindingSummary[]> {
  const stationBindingMap = new Map<string, Map<string, StationChannelBotBindingSummary>>()

  stations.forEach((station) => {
    stationBindingMap.set(station.id, new Map())
  })

  bindings.forEach((binding) => {
    const target = parseChannelBindingTarget(binding.targetAgentId)
    const normalizedTarget = normalizeCompareKey(target.value)
    if (!normalizedTarget) {
      return
    }
    const matchedStationIds: string[] = []
    if (target.type === 'agent') {
      stations.forEach((station) => {
        if (normalizeCompareKey(station.id) === normalizedTarget) {
          matchedStationIds.push(station.id)
        }
      })
    } else {
      stations.forEach((station) => {
        if (normalizeCompareKey(station.role) === normalizedTarget) {
          matchedStationIds.push(station.id)
        }
      })
    }

    if (matchedStationIds.length === 0) {
      return
    }

    const accountId = normalizeChannelAccountId(binding.accountId)
    const routeKey = `${binding.channel}::${accountId}`

    matchedStationIds.forEach((stationId) => {
      const summaryByRoute = stationBindingMap.get(stationId)
      if (!summaryByRoute) {
        return
      }
      const existing = summaryByRoute.get(routeKey)
      if (existing) {
        existing.routeCount += 1
        return
      }
      summaryByRoute.set(routeKey, {
        channel: binding.channel,
        accountId,
        routeCount: 1,
      })
    })
  })

  const output: Record<string, StationChannelBotBindingSummary[]> = {}
  stationBindingMap.forEach((summaryByRoute, stationId) => {
    const items = Array.from(summaryByRoute.values())
    items.sort((a, b) => {
      if (a.routeCount !== b.routeCount) {
        return b.routeCount - a.routeCount
      }
      const channelCompare = compareChannelName(a.channel, b.channel)
      if (channelCompare !== 0) {
        return channelCompare
      }
      return a.accountId.localeCompare(b.accountId)
    })
    output[stationId] = items
  })
  return output
}
