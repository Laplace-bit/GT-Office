import { t, type Locale } from '@shell/i18n/ui-locale'
import type { ChannelConnectorAccount } from '@shell/integration/desktop-api'
import type { FeishuDomain, FeishuWizardForm } from './model'

interface FeishuAccountFormProps {
  locale: Locale
  saving: boolean
  editing: boolean
  form: FeishuWizardForm
  accountRecord: ChannelConnectorAccount | null
  onChange: <K extends keyof FeishuWizardForm>(key: K, value: FeishuWizardForm[K]) => void
}

export function FeishuAccountForm({
  locale,
  saving,
  editing,
  form,
  accountRecord,
  onChange,
}: FeishuAccountFormProps) {
  return (
    <div className="settings-pane-section">
      <div className="feishu-websocket-banner">
        <div>
          <strong>{t(locale, '仅支持 WebSocket', 'WebSocket Only')}</strong>
          <p>
            {t(
              locale,
              '当前飞书接入不再暴露 Webhook 选项，无需配置 Verification Token 或 callback 地址。',
              'Feishu onboarding now exposes WebSocket only. No Verification Token or callback URL is required.',
            )}
          </p>
        </div>
      </div>

      <div className="settings-form-group">
        <label>{t(locale, '飞书区域', 'Platform Domain')}</label>
        <div className="segmented-control">
          <button
            type="button"
            className={form.domain === 'feishu' ? 'active' : ''}
            disabled={saving}
            onClick={() => onChange('domain', 'feishu' as FeishuDomain)}
          >
            Feishu
          </button>
          <button
            type="button"
            className={form.domain === 'lark' ? 'active' : ''}
            disabled={saving}
            onClick={() => onChange('domain', 'lark' as FeishuDomain)}
          >
            Lark
          </button>
        </div>
      </div>

      <div className="feishu-form-grid">
        <div className="settings-form-group">
          <label>Account ID</label>
          <input
            className="settings-input"
            value={form.accountId}
            disabled={saving || editing}
            placeholder="default"
            onChange={(event) => onChange('accountId', event.target.value)}
          />
        </div>
        <div className="settings-form-group">
          <label>App ID</label>
          <input
            className="settings-input"
            value={form.appId}
            disabled={saving}
            placeholder="cli_xxx"
            onChange={(event) => onChange('appId', event.target.value)}
          />
        </div>
      </div>

      <div className="settings-form-group">
        <label>App Secret</label>
        <input
          type="password"
          className="settings-input"
          value={form.appSecret}
          disabled={saving}
          placeholder={
            accountRecord?.hasAppSecret
              ? t(locale, '已保存；留空表示不更新', 'Already saved; leave blank to keep current value')
              : t(locale, '粘贴 App Secret', 'Paste App Secret')
          }
          onChange={(event) => onChange('appSecret', event.target.value)}
        />
        <span className="hint">
          {accountRecord?.hasAppSecret
            ? t(locale, 'GT Office 不会回显已保存的 Secret。', 'GT Office never re-displays saved secrets.')
            : t(locale, '首次接入必须填写 App Secret。', 'App Secret is required on first setup.')}
        </span>
      </div>
    </div>
  )
}
