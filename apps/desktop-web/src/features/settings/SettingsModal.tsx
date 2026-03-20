import { useEffect, useState } from 'react'
import { DisplayPreferences } from './DisplayPreferences'
import { TaskDispatchPreferences } from './TaskDispatchPreferences'
import { AiProvidersSection } from './ai-providers'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelManagerPane } from '../tool-adapter/ChannelManagerPane'
import type { AmbientLightingIntensity, MonoFont, ThemeMode, UiFont, UiFontSize } from '@shell/state/ui-preferences'
import type { ShortcutBinding } from '@features/keybindings'
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
  isMacOs: boolean
  taskQuickDispatchShortcut: ShortcutBinding
  defaultTaskQuickDispatchShortcut: ShortcutBinding
  onClose: () => void
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onUiFontSizeChange: (value: UiFontSize) => void
  onAmbientLightingChange: (enabled: boolean) => void
  onAmbientLightingIntensityChange: (value: AmbientLightingIntensity) => void
  onTaskQuickDispatchShortcutChange: (binding: ShortcutBinding) => void
  onTaskQuickDispatchShortcutReset: () => void
}

type SettingsTab = 'general' | 'shortcuts' | 'channels' | 'ai' | 'about'

function rem14(px: number): string {
  return `${px / 14}rem`
}

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
  isMacOs,
  taskQuickDispatchShortcut,
  defaultTaskQuickDispatchShortcut,
  onClose,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onUiFontSizeChange,
  onAmbientLightingChange,
  onAmbientLightingIntensityChange,
  onTaskQuickDispatchShortcutChange,
  onTaskQuickDispatchShortcutReset,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [visitedTabs, setVisitedTabs] = useState<SettingsTab[]>(['general'])

  useEffect(() => {
    setVisitedTabs((current) => (current.includes(activeTab) ? current : [...current, activeTab]))
  }, [activeTab])

  if (!open) {
    return null
  }

  const renderTabContent = (tab: SettingsTab) => {
    switch (tab) {
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
                    window.__GTO_OPEN_CHANNEL_STUDIO__?.()
                  }}
                />
              ) : (
                <p style={{ color: 'var(--vb-text-muted)', padding: `${rem14(20)} 0` }}>
                  {t(locale, '请先打开一个工作区以管理通道。', 'Please open a workspace to manage channels.')}
                </p>
              )}
            </div>
          </div>
        )
      case 'ai':
        return (
          <div className="settings-pane-section">
            {workspaceId ? (
              <AiProvidersSection locale={locale} workspaceId={workspaceId} />
            ) : (
              <p style={{ padding: `${rem14(24)} 0`, color: 'var(--vb-text-muted)' }}>
                {t(locale, '请先打开一个工作区以管理 AI 配置。', 'Please open a workspace to manage AI configuration.')}
              </p>
            )}
          </div>
        )
      case 'about':
        return (
          <div className="settings-pane-section">
            <h4>{t(locale, 'settingsModal.nav.about')}</h4>
            <div style={{ padding: `${rem14(24)} 0`, color: 'var(--vb-text-muted)' }}>
              <p style={{ marginBottom: rem14(8) }}><strong>GT Office</strong></p>
              <p>v0.1.0-alpha</p>
            </div>
          </div>
        )
      case 'shortcuts':
        return (
          <div className="settings-pane-section">
            <TaskDispatchPreferences
              locale={locale}
              isMacOs={isMacOs}
              shortcut={taskQuickDispatchShortcut}
              defaultShortcut={defaultTaskQuickDispatchShortcut}
              onShortcutChange={onTaskQuickDispatchShortcutChange}
              onShortcutReset={onTaskQuickDispatchShortcutReset}
            />
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
              className={`settings-nav-item ${activeTab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setActiveTab('shortcuts')}
            >
              <AppIcon name="command" aria-hidden="true" />
              {t(locale, '快捷键', 'Keybindings')}
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
              {activeTab === 'shortcuts' && t(locale, '快捷键', 'Keybindings')}
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
            {visitedTabs.map((tab) => (
              <section
                key={tab}
                className={`settings-tab-panel ${activeTab === tab ? 'is-active' : ''}`}
                hidden={activeTab !== tab}
                aria-hidden={activeTab !== tab}
              >
                {renderTabContent(tab)}
              </section>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
