import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelManagerPane } from './ChannelManagerPane'
import './ChannelStudio.scss'

interface ChannelStudioProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  onClose: () => void
}

export function ChannelStudio({ open, locale, workspaceId, onClose }: ChannelStudioProps) {
  if (!open) {
    return null
  }

  return (
    <div
      className="channel-studio-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className="channel-studio-shell"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="channel-studio-header">
          <div className="channel-studio-title-block">
            <div className="channel-studio-eyebrow">
              <AppIcon name="channels" className="vb-icon" aria-hidden="true" />
              <span>{t(locale, 'Channel Studio', 'Channel Studio')}</span>
            </div>
            <h2>{t(locale, '独立外部通道工作台', 'Standalone External Channel Workspace')}</h2>
            <p>
              {t(
                locale,
                '这里专门处理 Telegram / 飞书接入，不再和系统设置混在同一个弹窗里。先把机器人连通，再回到工作流。',
                'This workspace is dedicated to Telegram and Feishu onboarding. It is no longer embedded inside system settings. Connect the bots here, then return to the workflow.',
              )}
            </p>
          </div>
          <button
            type="button"
            className="channel-studio-close"
            onClick={onClose}
            aria-label={t(locale, '关闭通道工作台', 'Close channel studio')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <div className="channel-studio-hero-grid">
          <article className="channel-studio-hero-card primary">
            <span className="channel-studio-card-label">{t(locale, 'First-Time Success Path', 'First-Time Success Path')}</span>
            <strong>{t(locale, '按平台真实顺序完成接入', 'Follow the real platform order')}</strong>
            <p>
              {t(
                locale,
                '飞书长连接必须先让 GT Office runtime 在线，开放平台才能保存订阅。页面里的提示会按这个顺序一步步收口。',
                'Feishu long connection requires the GT Office runtime to be online before Open Platform can save the subscription. The guidance on this page follows that exact order.',
              )}
            </p>
          </article>
          <article className="channel-studio-hero-card">
            <span className="channel-studio-card-label">{t(locale, 'Feishu Checklist', 'Feishu Checklist')}</span>
            <strong>{t(locale, '先看三件事', 'Check these three items first')}</strong>
            <ul>
              <li>{t(locale, 'Bot 能力已开启。', 'Bot capability is enabled.')}</li>
              <li>{t(locale, '最新版本已发布。', 'The latest app version is published.')}</li>
              <li>{t(locale, '事件订阅选择长连接并添加 `im.message.receive_v1`。', 'Event subscription uses long connection and includes `im.message.receive_v1`.')}</li>
            </ul>
          </article>
          <article className="channel-studio-hero-card accent">
            <span className="channel-studio-card-label">{t(locale, 'Workspace Scope', 'Workspace Scope')}</span>
            <strong>{workspaceId ?? t(locale, '未绑定工作区', 'No workspace bound')}</strong>
            <p>
              {t(
                locale,
                '所有 route 绑定都会明确落到当前工作区，避免把通道配置和系统级设置混在一起。',
                'All route bindings are scoped to the current workspace so channel setup stays separate from global system settings.',
              )}
            </p>
          </article>
        </div>

        <div className="channel-studio-body">
          <ChannelManagerPane locale={locale} workspaceId={workspaceId} variant="studio" />
        </div>
      </section>
    </div>
  )
}
