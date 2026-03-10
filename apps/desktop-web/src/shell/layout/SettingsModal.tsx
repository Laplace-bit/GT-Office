import { useState } from 'react'
import { DisplayPreferences } from './DisplayPreferences'
import { ChannelManagerPane } from './channel-management/ChannelManagerPane'
import { t, type Locale } from '../i18n/ui-locale'
import type { AmbientLightingIntensity, MonoFont, ThemeMode, UiFont, UiFontSize } from '../state/ui-preferences'
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

type SettingsTab = 'general' | 'channels' | 'about'

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
            <h4>{t(locale, 'displayPreferences.title')}</h4>
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
           <ChannelManagerPane 
             locale={locale} 
             workspaceId={workspaceId} 
           />
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              {t(locale, 'settingsModal.nav.general')}
            </button>
            <button 
              className={`settings-nav-item ${activeTab === 'channels' ? 'active' : ''}`}
              onClick={() => setActiveTab('channels')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              {t(locale, 'settingsModal.nav.channels')}
            </button>
            <button 
              className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
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
              {activeTab === 'about' && t(locale, 'settingsModal.nav.about')}
            </h3>
            <button 
              type="button" 
              className="settings-content-close" 
              onClick={onClose} 
              aria-label={t(locale, 'settingsModal.close')}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
