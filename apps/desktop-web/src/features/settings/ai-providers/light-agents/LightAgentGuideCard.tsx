import type { AiAgentSnapshotCard, LightAgentGuide } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'

import { StatusPill } from '../shared/StatusPill'

interface LightAgentGuideCardProps {
  locale: Locale
  agent: AiAgentSnapshotCard
  guide: LightAgentGuide
  installing: boolean
  onInstall: () => void
}

export function LightAgentGuideCard({
  locale,
  agent,
  guide,
  installing,
  onInstall,
}: LightAgentGuideCardProps) {
  const installDisabled = installing || (agent.installStatus.requiresNode && !agent.installStatus.nodeReady)

  return (
    <section className="ai-light-guide-card">
      <div className="ai-light-guide-card__header">
        <div>
          <h3>{guide.title}</h3>
          <p>{guide.summary}</p>
        </div>
        <StatusPill
          tone={agent.installStatus.installed ? 'success' : 'warning'}
          label={
            agent.installStatus.installed
              ? t(locale, '已安装', 'Installed')
              : t(locale, '未安装', 'Not installed')
          }
        />
      </div>

      <div className="ai-light-guide-card__content">
        <div className="ai-provider-surface-block">
          <span className="ai-provider-surface-block__label">{t(locale, '为什么这里不做复杂配置', 'Why no complex provider form here')}</span>
          <strong>{t(locale, '首版保持官方链路，避免重复配置和用户困惑。', 'v1 stays on the official CLI flow to avoid duplicate setup and user confusion.')}</strong>
        </div>

        {guide.configPath ? (
          <div className="ai-provider-inline-detail">
            <span>{t(locale, '本地配置路径', 'Local config path')}</span>
            <code>{guide.configPath}</code>
          </div>
        ) : null}

        <ul className="ai-provider-list">
          {guide.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>

        <div className="ai-light-guide-card__actions">
          <a href={guide.docsUrl} target="_blank" rel="noreferrer" className="ai-provider-link-button">
            {t(locale, '打开官方文档', 'Open official docs')}
          </a>
          {!agent.installStatus.installed ? (
            <button
              type="button"
              className="ai-provider-primary-button"
              onClick={onInstall}
              disabled={installDisabled}
            >
              {installing
                ? t(locale, '安装中...', 'Installing...')
                : t(locale, '立即安装 CLI', 'Install CLI')}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
