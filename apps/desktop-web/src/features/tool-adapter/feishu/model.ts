import type {
  ChannelConnectorAccount,
  ChannelRouteBinding,
} from '@shell/integration/desktop-api'
import { normalizeChannelAccountId, parseChannelBindingTarget } from '../channel-bot-binding-model'

export type FeishuConnectionMode = 'websocket' | 'webhook'
export type FeishuDomain = 'feishu' | 'lark'
export type RoutePeerKind = 'direct' | 'group'

export interface FeishuWizardForm {
  domain: FeishuDomain
  appId: string
  peerKind: RoutePeerKind
  peerPattern: string
  targetAgentId: string
}

export interface FeishuGuideState {
  eyebrow: string
  title: string
  summary: string
  platformLabel: string
  platformUrl: string
  note: string
  checklist: string[]
}

export function normalizeAgentTarget(value: string): string {
  return value.trim()
}

export function describeError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return 'unknown'
}

export async function copyTextToClipboard(value: string): Promise<boolean> {
  if (!value.trim()) return false
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export function buildFeishuDefaultForm(args: {
  editingBinding: ChannelRouteBinding | null
  connectorAccounts: ChannelConnectorAccount[]
  defaultAgentId: string
}): FeishuWizardForm {
  const { editingBinding, connectorAccounts, defaultAgentId } = args
  const accountId = normalizeChannelAccountId(editingBinding?.accountId ?? 'default')
  const account = connectorAccounts.find(
    (item) => item.channel === 'feishu' && normalizeChannelAccountId(item.accountId) === accountId,
  )

  if (editingBinding) {
    const target = parseChannelBindingTarget(editingBinding.targetAgentId)
    return {
      domain: (account?.domain as FeishuDomain | undefined) ?? 'feishu',
      appId: account?.appId ?? '',
      peerKind: editingBinding.peerKind === 'group' ? 'group' : 'direct',
      peerPattern: editingBinding.peerPattern ?? '',
      targetAgentId: target.type === 'agent' ? target.value : defaultAgentId,
    }
  }

  return {
    domain: 'feishu',
    appId: '',
    peerKind: 'direct',
    peerPattern: '',
    targetAgentId: defaultAgentId,
  }
}

export function platformAppUrl(domain: FeishuDomain): string {
  return domain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'
}
