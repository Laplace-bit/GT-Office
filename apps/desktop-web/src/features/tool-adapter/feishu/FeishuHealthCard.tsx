import { t, type Locale } from '@shell/i18n/ui-locale'
import type { ChannelConnectorHealthResponse } from '@shell/integration/desktop-api'

interface FeishuHealthCardProps {
  locale: Locale
  health: ChannelConnectorHealthResponse['health'] | null
}

export function FeishuHealthCard({ locale, health }: FeishuHealthCardProps) {
  if (!health) {
    return (
      <div className="feishu-health-card">
        <p>{t(locale, '还未执行连接测试。', 'Connection test has not run yet.')}</p>
      </div>
    )
  }

  const identity = health.botName ?? health.botUsername ?? health.accountId
  const detail = health.detail || '-'
  const botActivationHint =
    health.status === 'auth_failed' && detail.includes('bot capability is not activated')
      ? t(
          locale,
          '请前往飞书开放平台，确认已开启 Bot 能力，并完成应用发布后再回到这里重试。',
          'Go to Feishu Open Platform, make sure the Bot capability is enabled, then publish the app before retrying here.',
        )
      : null
  const botActivationChecklist =
    health.status === 'auth_failed' && detail.includes('bot capability is not activated')
      ? [
          t(locale, '确认应用详情页里的 Bot 能力已经开启。', 'Confirm the Bot capability is enabled in the app detail page.'),
          t(locale, '确认最新版本已经发布，而不是只保存在草稿态。', 'Confirm the latest version has been published, not only saved as a draft.'),
          t(locale, '如果刚完成发布，回到 GT Office 再执行一次连接测试。', 'If you just published it, return to GT Office and run the connection test again.'),
        ]
      : []

  return (
    <div className="feishu-health-card">
      <div className="feishu-health-header">
        <div>
          <span className={`feishu-health-pill ${health.ok ? 'ok' : 'error'}`}>{health.status}</span>
          <h5>{identity}</h5>
        </div>
        <p>{detail}</p>
        {botActivationHint && <p>{botActivationHint}</p>}
        {botActivationChecklist.length > 0 && (
          <ul className="feishu-health-help-list">
            {botActivationChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      <dl className="feishu-health-grid">
        <div>
          <dt>{t(locale, '接入方式', 'Connection Type')}</dt>
          <dd>WebSocket</dd>
        </div>
        <div>
          <dt>{t(locale, '平台区域', 'Platform Domain')}</dt>
          <dd>{health.domain ?? '-'}</dd>
        </div>
        <div>
          <dt>{t(locale, 'Bot Open ID', 'Bot Open ID')}</dt>
          <dd>{health.botOpenId ?? '-'}</dd>
        </div>
        <div>
          <dt>{t(locale, 'Runtime 状态', 'Runtime Status')}</dt>
          <dd>
            {health.runtimeConnected
              ? t(locale, '已启动', 'Running')
              : t(locale, '未连接或重连中', 'Disconnected or reconnecting')}
          </dd>
        </div>
      </dl>
    </div>
  )
}
