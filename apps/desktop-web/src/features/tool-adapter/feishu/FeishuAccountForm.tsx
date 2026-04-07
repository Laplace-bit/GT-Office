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
              ? '••••••••••••••••'
              : t(locale, '粘贴 App Secret', 'Paste App Secret')
          }
          onChange={(event) => onChange('appSecret', event.target.value)}
        />
        <span className="hint">
          {accountRecord?.hasAppSecret
            ? t(locale, '已有凭据记录。如需修改请直接输入，留空则保持原值。', 'Credential exists. Enter a new secret to update, or leave blank to keep current value.')
            : t(locale, '首次接入必须填写 App Secret。', 'App Secret is required on first setup.')}
        </span>
      </div>
    </div>
  )
}
