import type {
  ChannelAdapterStatusResponse,
  ChannelConnectorAccount,
  ChannelConnectorAccountListResponse,
} from '@shell/integration/desktop-api'
import { normalizeChannelAccountId } from './channel-bot-binding-model'

type ChannelConnectorAccountListFetcher = (
  channel: string,
) => Promise<ChannelConnectorAccountListResponse>

function buildAccountKey(account: ChannelConnectorAccount): string {
  return `${account.channel.trim().toLowerCase()}::${normalizeChannelAccountId(account.accountId).toLowerCase()}`
}

function mergeAccounts(
  targetMap: Map<string, ChannelConnectorAccount>,
  accounts: ChannelConnectorAccount[],
) {
  accounts.forEach((account) => {
    targetMap.set(buildAccountKey(account), account)
  })
}

export function collectInlineConnectorAccounts(
  status: ChannelAdapterStatusResponse,
): ChannelConnectorAccount[] {
  const map = new Map<string, ChannelConnectorAccount>()
  status.adapters.forEach((adapter) => {
    mergeAccounts(map, adapter.accounts ?? [])
  })
  return Array.from(map.values())
}

export function collectAdapterChannels(status: ChannelAdapterStatusResponse): string[] {
  const channels = new Set<string>()
  status.adapters.forEach((adapter) => {
    const normalizedAdapterId = adapter.id.trim()
    if (normalizedAdapterId) {
      channels.add(normalizedAdapterId)
    }
    const adapterAccounts = adapter.accounts ?? []
    adapterAccounts.forEach((account) => {
      const normalizedChannel = account.channel.trim()
      if (normalizedChannel) {
        channels.add(normalizedChannel)
      }
    })
  })
  return Array.from(channels)
}

export async function resolveConnectorAccounts(
  status: ChannelAdapterStatusResponse,
  fetchAccountList: ChannelConnectorAccountListFetcher,
): Promise<ChannelConnectorAccount[]> {
  const accountMap = new Map<string, ChannelConnectorAccount>()
  const inlineAccounts = collectInlineConnectorAccounts(status)
  mergeAccounts(accountMap, inlineAccounts)

  const channels = collectAdapterChannels(status)
  await Promise.all(
    channels.map(async (channel) => {
      try {
        const response = await fetchAccountList(channel)
        mergeAccounts(accountMap, response.accounts)
      } catch {
        // Keep status load resilient when some connector is unavailable.
      }
    }),
  )

  return Array.from(accountMap.values()).sort((a, b) => {
    const channelCompare = a.channel.localeCompare(b.channel)
    if (channelCompare !== 0) {
      return channelCompare
    }
    return normalizeChannelAccountId(a.accountId).localeCompare(normalizeChannelAccountId(b.accountId))
  })
}
