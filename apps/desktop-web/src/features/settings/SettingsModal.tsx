import { startTransition, useEffect, useState } from 'react'
import { DisplayPreferences } from './DisplayPreferences'
import { TaskDispatchPreferences } from './TaskDispatchPreferences'
import { WorkspaceResetSection } from './WorkspaceResetSection'
import { AiProvidersSection } from './ai-providers'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { ChannelManagerPane } from '../tool-adapter/ChannelManagerPane'
import type { MonoFont, ThemeMode, UiFont, UiFontSize } from '@shell/state/ui-preferences'
import type { ShortcutBinding } from '@features/keybindings'
import { desktopApi } from '@shell/integration/desktop-api'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'
import {
  buildSettingsAboutCapabilities,
  buildSettingsAboutSections,
  buildSettingsAboutSummary,
  buildSettingsTabItems,
  normalizeSettingsAboutAppInfo,
  type SettingsAboutAppInfo,
  type SettingsTab,
} from './settings-modal-model'
import './SettingsModal.scss'

interface SettingsModalProps {
  open: boolean
  locale: Locale
  workspaceId: string | null
  themeMode: ThemeMode
  uiFont: UiFont
  monoFont: MonoFont
  uiFontSize: UiFontSize
  isMacOs: boolean
  taskQuickDispatchShortcut: ShortcutBinding
  defaultTaskQuickDispatchShortcut: ShortcutBinding
  onClose: () => void
  onLocaleChange: (value: Locale) => void
  onThemeModeChange: (value: ThemeMode) => void
  onUiFontChange: (value: UiFont) => void
  onMonoFontChange: (value: MonoFont) => void
  onUiFontSizeChange: (value: UiFontSize) => void
  onTaskQuickDispatchShortcutChange: (binding: ShortcutBinding) => void
  onTaskQuickDispatchShortcutReset: () => void
  onWorkspaceResetSuccess?: () => void
}

const SETTINGS_TAB_ICONS: Record<SettingsTab, 'settings' | 'command' | 'sparkles' | 'channels' | 'info'> = {
  general: 'settings',
  shortcuts: 'command',
  ai: 'sparkles',
  channels: 'channels',
  about: 'info',
}

function rem14(px: number): string {
  return `${px / 14}rem`
}

function createInitialAboutAppInfo(): SettingsAboutAppInfo {
  return {
    runtime: desktopApi.isTauriRuntime() ? 'tauri' : 'web',
  }
}

export function SettingsModal({
  open,
  locale,
  workspaceId,
  themeMode,
  uiFont,
  monoFont,
  uiFontSize,
  isMacOs,
  taskQuickDispatchShortcut,
  defaultTaskQuickDispatchShortcut,
  onClose,
  onLocaleChange,
  onThemeModeChange,
  onUiFontChange,
  onMonoFontChange,
  onUiFontSizeChange,
  onTaskQuickDispatchShortcutChange,
  onTaskQuickDispatchShortcutReset,
  onWorkspaceResetSuccess,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [visitedTabs, setVisitedTabs] = useState<SettingsTab[]>(['general'])
  const [aboutAppInfo, setAboutAppInfo] = useState<SettingsAboutAppInfo>(createInitialAboutAppInfo)

  useEffect(() => {
    setVisitedTabs((current) => (current.includes(activeTab) ? current : [...current, activeTab]))
  }, [activeTab])

  useEffect(() => {
    let cancelled = false
    const runtime = desktopApi.isTauriRuntime() ? 'tauri' : 'web'

    startTransition(() => {
      setAboutAppInfo((current) => ({ ...current, runtime }))
    })

    if (runtime !== 'tauri') {
      return () => {
        cancelled = true
      }
    }

    void desktopApi.appGetInfo().then((info) => {
      if (cancelled || !info) {
        return
      }
      startTransition(() => {
        setAboutAppInfo({
          ...info,
          runtime: 'tauri',
        })
      })
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!open) {
    return null
  }

  const tabItems = buildSettingsTabItems(locale)
  const activeTabItem = tabItems.find((item) => item.id === activeTab) ?? tabItems[0]
  const normalizedAboutAppInfo = normalizeSettingsAboutAppInfo(aboutAppInfo)
  const aboutSummary = buildSettingsAboutSummary(locale)
  const aboutCapabilities = buildSettingsAboutCapabilities(locale)
  const aboutSections = buildSettingsAboutSections(locale, aboutAppInfo)

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
              onLocaleChange={onLocaleChange}
              onThemeModeChange={onThemeModeChange}
              onUiFontChange={onUiFontChange}
              onMonoFontChange={onMonoFontChange}
              onUiFontSizeChange={onUiFontSizeChange}
            />
            <WorkspaceResetSection locale={locale} workspaceId={workspaceId} onResetSuccess={onWorkspaceResetSuccess} />
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
            <AiProvidersSection locale={locale} workspaceId={workspaceId} />
          </div>
        )
      case 'about':
        return (
          <div className="settings-pane-section settings-about-pane">
            <div className="settings-about-hero">
              <div className="settings-about-eyebrow">{t(locale, 'settingsModal.nav.about')}</div>
              <div className="settings-about-title-row">
                <h4>{normalizedAboutAppInfo.name}</h4>
                <span className="settings-about-pill">{normalizedAboutAppInfo.version}</span>
              </div>
              <p className="settings-about-summary">{aboutSummary}</p>
              <div className="settings-about-capabilities" aria-label={t(locale, 'settingsModal.nav.about')}>
                {aboutCapabilities.map((capability) => (
                  <span key={capability} className="settings-about-capability">
                    {capability}
                  </span>
                ))}
              </div>
            </div>
            <div className="settings-about-grid">
              {aboutSections.map((section) => (
                <section key={section.id} className="settings-about-card">
                  <header className="settings-about-card-header">
                    <h5>{section.title}</h5>
                    <p>{section.description}</p>
                  </header>
                  <dl className="settings-about-meta-list">
                    {section.items.map((item) => (
                      <div key={`${section.id}-${item.label}`} className="settings-about-meta-row">
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
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
          requestStandardModalClose('backdrop', onClose)
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
            {tabItems.map((item) => (
              <button
                key={item.id}
                className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <AppIcon name={SETTINGS_TAB_ICONS[item.id]} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Right Content Area */}
        <div className="settings-content-area">
          <header className="settings-content-header">
            <h3>{activeTabItem?.label ?? t(locale, 'settingsModal.title')}</h3>
            <button
              type="button"
              className="settings-content-close"
              onClick={() => requestStandardModalClose('explicit', onClose)}
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
