import type {
  ChannelConnectorAccount,
  ChannelRouteBinding,
  ExternalAccessPolicyMode,
} from '@shell/integration/desktop-api'
import { normalizeChannelAccountId, parseChannelBindingTarget } from '../channel-bot-binding-model'

export type FeishuConnectionMode = 'websocket' | 'webhook'
export type FeishuDomain = 'feishu' | 'lark'
export type RouteTargetBindingType = 'role' | 'agent'
export type RoutePeerKind = 'direct' | 'group'

export interface FeishuWizardForm {
  accountId: string
  domain: FeishuDomain
  appId: string
  appSecret: string
  peerKind: RoutePeerKind
  peerPattern: string
  targetBindingType: RouteTargetBindingType
  targetRoleKey: string
  targetAgentId: string
  priority: number
  policyMode: ExternalAccessPolicyMode
  approveIdentities: string
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

const ROLE_TARGET_PREFIX = 'role:'

export function normalizeRoleTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.startsWith(ROLE_TARGET_PREFIX) ? trimmed : `${ROLE_TARGET_PREFIX}${trimmed}`
}

export function normalizeAgentTarget(value: string): string {
  return value.trim()
}

export function parseIdentities(value: string): string[] {
  return Array.from(new Set(value.split(/[\n,;]/g).map((item) => item.trim()).filter(Boolean)))
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
  defaultRoleKey: string
  defaultAgentId: string
}): FeishuWizardForm {
  const { editingBinding, connectorAccounts, defaultRoleKey, defaultAgentId } = args
  const accountId = normalizeChannelAccountId(editingBinding?.accountId ?? 'default')
  const account = connectorAccounts.find(
    (item) => item.channel === 'feishu' && normalizeChannelAccountId(item.accountId) === accountId,
  )

  if (editingBinding) {
    const target = parseChannelBindingTarget(editingBinding.targetAgentId)
    return {
      accountId,
      domain: (account?.domain as FeishuDomain | undefined) ?? 'feishu',
      appId: account?.appId ?? '',
      appSecret: '',
      peerKind: editingBinding.peerKind === 'group' ? 'group' : 'direct',
      peerPattern: editingBinding.peerPattern ?? '',
      targetBindingType: target.type as RouteTargetBindingType,
      targetRoleKey: target.type === 'role' ? target.value : '',
      targetAgentId: target.type === 'agent' ? target.value : '',
      priority: editingBinding.priority ?? 100,
      policyMode: 'open',
      approveIdentities: '',
    }
  }

  return {
    accountId: '',
    domain: 'feishu',
    appId: '',
    appSecret: '',
    peerKind: 'direct',
    peerPattern: '',
    targetBindingType: 'role',
    targetRoleKey: defaultRoleKey,
    targetAgentId: defaultAgentId,
    priority: 100,
    policyMode: 'open',
    approveIdentities: '',
  }
}

export function platformAppUrl(domain: FeishuDomain): string {
  return domain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app'
}
