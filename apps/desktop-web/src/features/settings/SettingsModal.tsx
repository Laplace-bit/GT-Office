import { useState } from 'react'
import { DisplayPreferences } from './DisplayPreferences'
import { AgenticOneSection } from './AgenticOneSection'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelManagerPane } from '../tool-adapter/ChannelManagerPane'
import type { AmbientLightingIntensity, MonoFont, ThemeMode, UiFont, UiFontSize } from '@shell/state/ui-preferences'
import './SettingsModal.scss'

interface SettingsModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  ambientLightingEnabled: boolean
  ambientLightingIntensity: AmbientLightingIntensity
  onClose: () => void
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onUiFontSizeChange: (value: UiFontSize) => void
  onAmbientLightingChange: (enabled: boolean) => void
  onAmbientLightingIntensityChange: (value: AmbientLightingIntensity) => void
}

type SettingsTab = 'general' | 'channels' | 'ai' | 'about'

export function SettingsModal({
  open,
  locale,
  workspaceId,
  themeMode,
  uiFont,
  monoFont,
  uiFontSize,
  ambientLightingEnabled,
  ambientLightingIntensity,
  onClose,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onUiFontSizeChange,
  onAmbientLightingChange,
  onAmbientLightingIntensityChange,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  if (!open) {
    return null
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="settings-pane-section">
            <DisplayPreferences
              locale={locale}
              themeMode={themeMode}
              uiFont={uiFont}
              monoFont={monoFont}
              uiFontSize={uiFontSize}
              ambientLightingEnabled={ambientLightingEnabled}
              ambientLightingIntensity={ambientLightingIntensity}
              onLocaleChange={onLocaleChange}
              onThemeModeChange={onThemeModeChange}
              onUiFontChange={onUiFontChange}
              onMonoFontChange={onMonoFontChange}
              onUiFontSizeChange={onUiFontSizeChange}
              onAmbientLightingChange={onAmbientLightingChange}
              onAmbientLightingIntensityChange={onAmbientLightingIntensityChange}
            />
          </div>
        )
      case 'channels':
        return (
          <div className="settings-pane-section">
            <div className="settings-channels-list-wrapper">
              {workspaceId ? (
                <ChannelManagerPane 
                  locale={locale} 
                  workspaceId={workspaceId} 
                  variant="settings"
                  onEnterStudio={() => {
                    (window as any).__GTO_OPEN_CHANNEL_STUDIO__?.()
                  }}
                />
              ) : (
                <p style={{ color: 'var(--vb-text-muted)', padding: '20px 0' }}>
                  {t(locale, '请先打开一个工作区以管理通道。', 'Please open a workspace to manage channels.')}
                </p>
              )}
            </div>
          </div>
        )
      case 'ai':
        return (
          <div className="settings-pane-section">
            <AgenticOneSection locale={locale} />
          </div>
        )
      case 'about':
        return (
          <div className="settings-pane-section">
            <h4>{t(locale, 'settingsModal.nav.about')}</h4>
            <div style={{ padding: '24px 0', color: 'var(--vb-text-muted)' }}>
              <p style={{ marginBottom: 8 }}><strong>GT Office</strong></p>
              <p>v0.1.0-alpha</p>
            </div>
          </div>
        )
    }
  }

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section className="settings-modal app-settings-modal" role="dialog" aria-modal="true">
        {/* Left Sidebar Navigation */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h2>{t(locale, 'settingsModal.title')}</h2>
          </div>
          <nav className="settings-sidebar-nav">
            <button 
              className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <AppIcon name="settings" aria-hidden="true" />
              {t(locale, 'settingsModal.nav.general')}
            </button>
            <button 
              className={`settings-nav-item ${activeTab === 'channels' ? 'active' : ''}`}
              onClick={() => setActiveTab('channels')}
            >
              <AppIcon name="channels" aria-hidden="true" />
              {t(locale, 'settingsModal.nav.channels')}
            </button>
            <button 
              className={`settings-nav-item ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              <AppIcon name="sparkles" aria-hidden="true" />
              {t(locale, 'Agent 供应商', 'Agent Providers')}
            </button>
            <button 
              className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <AppIcon name="info" aria-hidden="true" />
              {t(locale, 'settingsModal.nav.about')}
            </button>
          </nav>
        </aside>

        {/* Right Content Area */}
        <div className="settings-content-area">
          <header className="settings-content-header">
            <h3>
              {activeTab === 'general' && t(locale, 'settingsModal.nav.general')}
              {activeTab === 'channels' && t(locale, 'settingsModal.nav.channels')}
              {activeTab === 'ai' && t(locale, 'Agent 供应商', 'Agent Providers')}
              {activeTab === 'about' && t(locale, 'settingsModal.nav.about')}
            </h3>
            <button 
              type="button" 
              className="settings-content-close" 
              onClick={onClose} 
              aria-label={t(locale, 'settingsModal.close')}
            >
              <AppIcon name="close" width={20} height={20} aria-hidden="true" />
            </button>
          </header>
          <div className="settings-content-body">
            {renderTabContent()}
          </div>
        </div>
      </section>
    </div>
  )
}

