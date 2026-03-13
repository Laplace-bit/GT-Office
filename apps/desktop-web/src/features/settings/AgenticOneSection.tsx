import React, { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import './AgenticOneSection.scss'

const ClaudeLogo = () => (
  <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.67 5.33c-.63 0-1.2.37-1.46.94l-8 17.33c-.36.78.21 1.67 1.07 1.67h2.93c.44 0 .84-.26 1.02-.66l1.8-3.94h7.94l1.8 3.94c.18.4.58.66 1.02.66h2.93c.86 0 1.43-.89 1.07-1.67l-8-17.33c-.26-.57-.83-.94-1.46-.94h-.66zm-2.13 12.67l2.8-6.07 2.8 6.07h-5.6z" fill="currentColor" />
  </svg>
)

const OpenAILogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.0522v5.5846a4.504 4.504 0 0 1-4.4945 4.4928zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8906a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3387 7.8906zm13.5188-.934l-5.8428 3.3685V7.9928a.071.071 0 0 1 .0332-.0615L14.874 5.1824a4.504 4.504 0 0 1 6.1408 1.6464 4.485 4.485 0 0 1 .5346 3.0137l-.142-.0852-4.783-2.7582a.7712.7712 0 0 0-.7663 0zm3.4993 9.1164V10.4a.7664.7664 0 0 0-.3879-.6765l-5.8144-3.3543 2.0201-1.1685a.0757.0757 0 0 1 .071 0l4.8303 2.7865a4.504 4.504 0 0 1 2.064 6.0567 4.485 4.485 0 0 1-2.3655 1.9728zm-1.8967-11.4455a4.4755 4.4755 0 0 1 2.8764 1.0408l-.1419.0804-4.7783 2.7582a.7948.7948 0 0 0-.3927.6813v6.7369l-2.02-1.1686a.071.071 0 0 1-.038-.0522V9.1298a4.504 4.504 0 0 1 4.4945-4.4928zm-2.8273 4.8702l-1.6259-.9388L12 8.5748l1.6259.9388v1.8776L12 12.33l-1.6259-.9388V9.5019z" fill="currentColor" />
  </svg>
)

const GeminiLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" fill="url(#gemini-grad)" />
    <defs>
      <linearGradient id="gemini-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#4E82EE' }} />
        <stop offset="100%" style={{ stopColor: '#B06AB3' }} />
      </linearGradient>
    </defs>
  </svg>
)

const AGENTS_METADATA = [
  {
    id: 'ClaudeCode',
    eventId: 'claude',
    name: 'Claude Code',
    provider: 'Anthropic',
    description: {
      'zh-CN': '专注于代码理解与自主重构的高性能 Agent。',
      'en-US': 'High-performance agent focused on code understanding and autonomous refactoring.',
    },
    Logo: ClaudeLogo,
    accent: '#D97757',
  },
  {
    id: 'Codex',
    eventId: 'codex',
    name: 'Codex CLI',
    provider: 'OpenAI',
    description: {
      'zh-CN': '集成 GPT-4 能力，快速执行常规编码与任务自动化。',
      'en-US': 'Integrated GPT-4 capabilities for rapid coding and task automation.',
    },
    Logo: OpenAILogo,
    accent: '#10A37F',
  },
  {
    id: 'Gemini',
    eventId: 'gemini',
    name: 'Gemini CLI',
    provider: 'Google',
    description: {
      'zh-CN': '具备 1M 超长上下文，集成实时 Web 搜索增强。',
      'en-US': 'Featuring 1M context window with integrated real-time web search grounding.',
    },
    Logo: GeminiLogo,
    accent: '#4285F4',
  },
] as const

type AgentMetadata = (typeof AGENTS_METADATA)[number]

interface AgentInstallStatus {
  installed: boolean
  executable: string | null
  requiresNode: boolean
  nodeReady: boolean
}

interface AgentCardStyle extends React.CSSProperties {
  '--agent-accent': string
}

async function fetchAgentInstallStatus(agentId: AgentMetadata['id']): Promise<AgentInstallStatus> {
  return invoke<AgentInstallStatus>('agent_install_status', { agent: agentId })
}

const AgentCard: React.FC<{ agent: AgentMetadata; locale: Locale }> = ({ agent, locale }) => {
  const [isInstalling, setIsInstalling] = useState(false)
  const [isCheckingInstalled, setIsCheckingInstalled] = useState(true)
  const [installStatus, setInstallStatus] = useState<AgentInstallStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unlisten = listen(`install-progress:${agent.eventId}`, (event) => {
      setLogs((prev) => [...prev.slice(-100), event.payload as string])
    })
    return () => {
      unlisten.then((dispose) => dispose())
    }
  }, [agent.eventId])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    let cancelled = false

    const loadInstallStatus = async () => {
      setIsCheckingInstalled(true)
      try {
        const nextStatus = await fetchAgentInstallStatus(agent.id)
        if (!cancelled) {
          setInstallStatus(nextStatus)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
        }
      } finally {
        if (!cancelled) {
          setIsCheckingInstalled(false)
        }
      }
    }

    void loadInstallStatus()

    return () => {
      cancelled = true
    }
  }, [agent.id])

  const refreshInstallStatus = async () => {
    setIsCheckingInstalled(true)
    try {
      const nextStatus = await fetchAgentInstallStatus(agent.id)
      setInstallStatus(nextStatus)
      if (nextStatus.installed) {
        setError(null)
      }
      return nextStatus
    } catch (err) {
      setError(String(err))
      return null
    } finally {
      setIsCheckingInstalled(false)
    }
  }

  const handleInstall = async () => {
    setIsInstalling(true)
    setError(null)
    setLogs([t(locale, '正在建立连接...', 'Establishing connection...')])

    try {
      await invoke('install_agent', { agent: agent.id })
      setLogs((prev) => [...prev, t(locale, '正在刷新安装状态...', 'Refreshing install status...')])
      await refreshInstallStatus()
    } catch (err) {
      setError(String(err))
    } finally {
      setIsInstalling(false)
    }
  }

  const cardStyle = { '--agent-accent': agent.accent } as AgentCardStyle
  const isInstalled = Boolean(installStatus?.installed)
  const nodeRequiredButMissing = Boolean(installStatus?.requiresNode && !installStatus.nodeReady)
  const installDisabled = isInstalling || isCheckingInstalled || nodeRequiredButMissing

  let statusVariant: 'checking' | 'installed' | 'warning' | 'available' = 'available'
  let statusLabel = t(locale, '可安装', 'Ready to install')
  let statusDetail = t(locale, '当前环境已满足安装条件。', 'This environment is ready for installation.')

  if (isCheckingInstalled) {
    statusVariant = 'checking'
    statusLabel = t(locale, '检测中', 'Checking')
    statusDetail = t(locale, '正在扫描本机可执行命令。', 'Scanning local executables.')
  } else if (isInstalled) {
    statusVariant = 'installed'
    statusLabel = t(locale, '已安装', 'Installed')
    statusDetail = installStatus?.executable
      ? t(locale, `已检测到命令：${installStatus.executable}`, `Detected executable: ${installStatus.executable}`)
      : t(locale, '本机已存在可用命令。', 'A usable executable is already available.')
  } else if (nodeRequiredButMissing) {
    statusVariant = 'warning'
    statusLabel = t(locale, '缺少 Node.js', 'Node.js required')
    statusDetail = t(
      locale,
      '未检测到 Node.js，当前无法执行全局安装。',
      'Node.js was not detected, so global install is currently unavailable.',
    )
  } else if (installStatus?.requiresNode) {
    statusDetail = t(locale, 'Node.js 环境已就绪，可直接全局安装。', 'Node.js is ready for a global install.')
  } else {
    statusDetail = t(locale, '当前环境可直接执行安装脚本。', 'This environment can run the installer script directly.')
  }

  const actionLabel = isInstalling
    ? t(locale, '安装中...', 'Installing...')
    : nodeRequiredButMissing
      ? t(locale, '需先安装 Node.js', 'Install Node.js first')
      : t(locale, '立即安装', 'Install now')

  return (
    <article className="agent-provider-card" style={cardStyle}>
      <div className="agent-provider-card__header">
        <div className="agent-provider-card__identity">
          <div className="agent-provider-card__logo">
            <agent.Logo />
          </div>
          <div className="agent-provider-card__copy">
            <div className="agent-provider-card__title-row">
              <h4>{agent.name}</h4>
              <span className="agent-provider-card__provider">{agent.provider}</span>
            </div>
            <p className="agent-provider-card__description">{agent.description[locale]}</p>
          </div>
        </div>
        <div className={`agent-provider-card__status agent-provider-card__status--${statusVariant}`}>
          <AppIcon
            name={statusVariant === 'installed' ? 'check' : statusVariant === 'warning' ? 'info' : 'activity'}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
        </div>
      </div>

      <div className="agent-provider-card__body">
        <p className="agent-provider-card__detail">{statusDetail}</p>

        {!isInstalled && !isCheckingInstalled && (
          <button
            type="button"
            className="agent-provider-card__install-button"
            onClick={handleInstall}
            disabled={installDisabled}
          >
            <AppIcon name={nodeRequiredButMissing ? 'info' : 'cloud-download'} aria-hidden="true" />
            <span>{actionLabel}</span>
          </button>
        )}
      </div>

      {(logs.length > 0 || error) && (
        <div className={`agent-provider-card__logs ${error ? 'is-error' : ''}`}>
          {logs.map((log, index) => (
            <div key={`${agent.id}-${index}`} className="agent-provider-card__log-line">
              {log}
            </div>
          ))}
          {error && (
            <div className="agent-provider-card__log-line agent-provider-card__log-line--error">
              {t(locale, '错误：', 'Error: ')}
              {error}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </article>
  )
}

export const AgenticOneSection: React.FC<{ locale: Locale }> = ({ locale }) => {
  return (
    <section className="agent-provider-section">
      <header className="agent-provider-section__header">
        <h3>{t(locale, 'Agent 供应商', 'Agent Providers')}</h3>
        <p>
          {t(
            locale,
            '进入页面即自动检测本机安装状态，仅对未安装的 CLI 显示安装入口。',
            'The page checks local install status on entry and only shows install actions for missing CLIs.',
          )}
        </p>
      </header>

      <div className="agent-provider-section__grid">
        {AGENTS_METADATA.map((agent) => (
          <AgentCard key={agent.id} agent={agent} locale={locale} />
        ))}
      </div>
    </section>
  )
}
