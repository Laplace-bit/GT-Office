import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  desktopApi,
  type SettingsEffectiveResponse,
  type SettingsUpdatedPayload,
} from '../integration/desktop-api'
import { t, type Locale } from '../i18n/ui-locale'

type SettingsScope = 'user' | 'workspace' | 'session'

interface SettingsRuntimePaneProps {
  locale: Locale
  workspaceId: string | null
}

interface RuntimeSettingsForm {
  watcherPollIntervalMs: number
  watcherIgnoredDirs: string
  watcherIgnoredExactFiles: string
  watcherIgnoredSuffixes: string
  previewMaxBytes: number
  previewFullReadDefaultMaxBytes: number
  previewFullReadHardMaxBytes: number
}

const DEFAULT_FORM: RuntimeSettingsForm = {
  watcherPollIntervalMs: 250,
  watcherIgnoredDirs: '.git\nnode_modules\ntarget\ndist\n.next\n.cache',
  watcherIgnoredExactFiles: '.DS_Store\nThumbs.db',
  watcherIgnoredSuffixes: '.swp\n.tmp\n.temp\n~\n.crdownload',
  previewMaxBytes: 262144,
  previewFullReadDefaultMaxBytes: 2097152,
  previewFullReadHardMaxBytes: 16777216,
}

const FS_WATCHER_KEYS = [
  'filesystem.watcher.pollIntervalMs',
  'filesystem.watcher.ignoredDirs',
  'filesystem.watcher.ignoredExactFiles',
  'filesystem.watcher.ignoredSuffixes',
]

const FS_PREVIEW_KEYS = [
  'filesystem.preview.maxBytes',
  'filesystem.preview.fullReadDefaultMaxBytes',
  'filesystem.preview.fullReadHardMaxBytes',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const parsed = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
  return parsed.length > 0 ? parsed : []
}

function asPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const integer = Math.floor(value)
  if (integer <= 0) {
    return fallback
  }
  return integer
}

function parseEffectiveSettings(values: Record<string, unknown>): RuntimeSettingsForm {
  const filesystem = asRecord(values.filesystem)
  const watcher = asRecord(filesystem?.watcher)
  const preview = asRecord(filesystem?.preview)

  const ignoredDirs = asStringArray(watcher?.ignoredDirs)
  const ignoredExactFiles = asStringArray(watcher?.ignoredExactFiles)
  const ignoredSuffixes = asStringArray(watcher?.ignoredSuffixes)

  return {
    watcherPollIntervalMs: asPositiveInteger(
      watcher?.pollIntervalMs,
      DEFAULT_FORM.watcherPollIntervalMs,
    ),
    watcherIgnoredDirs:
      ignoredDirs === null
        ? DEFAULT_FORM.watcherIgnoredDirs
        : ignoredDirs.join('\n'),
    watcherIgnoredExactFiles:
      ignoredExactFiles === null
        ? DEFAULT_FORM.watcherIgnoredExactFiles
        : ignoredExactFiles.join('\n'),
    watcherIgnoredSuffixes:
      ignoredSuffixes === null
        ? DEFAULT_FORM.watcherIgnoredSuffixes
        : ignoredSuffixes.join('\n'),
    previewMaxBytes: asPositiveInteger(preview?.maxBytes, DEFAULT_FORM.previewMaxBytes),
    previewFullReadDefaultMaxBytes: asPositiveInteger(
      preview?.fullReadDefaultMaxBytes,
      DEFAULT_FORM.previewFullReadDefaultMaxBytes,
    ),
    previewFullReadHardMaxBytes: asPositiveInteger(
      preview?.fullReadHardMaxBytes,
      DEFAULT_FORM.previewFullReadHardMaxBytes,
    ),
  }
}

function parseLinesToArray(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function coercePositiveInteger(input: number, fallback: number): number {
  if (!Number.isFinite(input) || input <= 0) {
    return fallback
  }
  return Math.floor(input)
}

function scopeWorkspaceId(scope: SettingsScope, workspaceId: string | null): string | null {
  if (scope === 'workspace' || scope === 'session') {
    return workspaceId
  }
  return null
}

function nowTimeLabel(locale: Locale): string {
  const languageTag = locale === 'zh-CN' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(languageTag, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}

export function SettingsRuntimePane({ locale, workspaceId }: SettingsRuntimePaneProps) {
  const [scope, setScope] = useState<SettingsScope>('workspace')
  const [form, setForm] = useState<RuntimeSettingsForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceText, setSourceText] = useState<string>('')

  const isTauri = desktopApi.isTauriRuntime()
  const workspaceBound = workspaceId !== null

  useEffect(() => {
    if (scope === 'workspace' && !workspaceBound) {
      setScope('user')
    }
  }, [scope, workspaceBound])

  const applyEffective = useCallback((response: SettingsEffectiveResponse) => {
    setForm(parseEffectiveSettings(response.values))
    setSourceText(JSON.stringify(response.sources, null, 2))
  }, [])

  const loadEffective = useCallback(async () => {
    if (!isTauri) {
      setMessage(t(locale, 'settingsRuntime.webPreviewNotice'))
      return
    }

    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const response = await desktopApi.settingsGetEffective(workspaceId)
      applyEffective(response)
      setMessage(t(locale, 'settingsRuntime.loadedAt', { time: nowTimeLabel(locale) }))
    } catch (loadError) {
      setError(
        t(locale, 'settingsRuntime.loadFailed', {
          detail: loadError instanceof Error ? loadError.message : 'unknown',
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [applyEffective, isTauri, locale, workspaceId])

  useEffect(() => {
    void loadEffective()
  }, [loadEffective])

  useEffect(() => {
    if (!isTauri) {
      return
    }

    let active = true
    let cleanup: (() => void) | null = null

    void desktopApi
      .subscribeSettingsUpdated((payload: SettingsUpdatedPayload) => {
        if (!active) {
          return
        }
        if (payload.workspaceId && workspaceId && payload.workspaceId !== workspaceId) {
          return
        }
        if (payload.workspaceId && !workspaceId) {
          return
        }
        void loadEffective()
      })
      .then((unlisten) => {
        cleanup = unlisten
      })

    return () => {
      active = false
      if (cleanup) {
        cleanup()
      }
    }
  }, [isTauri, loadEffective, workspaceId])

  const saveSettings = useCallback(async () => {
    if (!isTauri) {
      setMessage(t(locale, 'settingsRuntime.webPreviewNotice'))
      return
    }

    const targetWorkspaceId = scopeWorkspaceId(scope, workspaceId)
    if ((scope === 'workspace' || scope === 'session') && !targetWorkspaceId) {
      setError(t(locale, 'settingsRuntime.workspaceRequired'))
      return
    }

    const normalizedPreviewMax = coercePositiveInteger(form.previewMaxBytes, DEFAULT_FORM.previewMaxBytes)
    const normalizedPreviewDefault = coercePositiveInteger(
      form.previewFullReadDefaultMaxBytes,
      DEFAULT_FORM.previewFullReadDefaultMaxBytes,
    )
    const normalizedPreviewHard = coercePositiveInteger(
      form.previewFullReadHardMaxBytes,
      DEFAULT_FORM.previewFullReadHardMaxBytes,
    )

    const patch: Record<string, unknown> = {
      filesystem: {
        watcher: {
          pollIntervalMs: coercePositiveInteger(
            form.watcherPollIntervalMs,
            DEFAULT_FORM.watcherPollIntervalMs,
          ),
          ignoredDirs: parseLinesToArray(form.watcherIgnoredDirs),
          ignoredExactFiles: parseLinesToArray(form.watcherIgnoredExactFiles),
          ignoredSuffixes: parseLinesToArray(form.watcherIgnoredSuffixes),
        },
        preview: {
          maxBytes: normalizedPreviewMax,
          fullReadDefaultMaxBytes: Math.max(normalizedPreviewDefault, normalizedPreviewMax),
          fullReadHardMaxBytes: Math.max(normalizedPreviewHard, normalizedPreviewDefault, normalizedPreviewMax),
        },
      },
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await desktopApi.settingsUpdate(scope, patch, targetWorkspaceId)
      await loadEffective()
      setMessage(t(locale, 'settingsRuntime.savedAt', { time: nowTimeLabel(locale) }))
    } catch (saveError) {
      setError(
        t(locale, 'settingsRuntime.saveFailed', {
          detail: saveError instanceof Error ? saveError.message : 'unknown',
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [form, isTauri, loadEffective, locale, scope, workspaceId])

  const resetWatcher = useCallback(async () => {
    if (!isTauri) {
      setMessage(t(locale, 'settingsRuntime.webPreviewNotice'))
      return
    }

    const targetWorkspaceId = scopeWorkspaceId(scope, workspaceId)
    if ((scope === 'workspace' || scope === 'session') && !targetWorkspaceId) {
      setError(t(locale, 'settingsRuntime.workspaceRequired'))
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await desktopApi.settingsReset(scope, FS_WATCHER_KEYS, targetWorkspaceId)
      await loadEffective()
      setMessage(t(locale, 'settingsRuntime.resetWatcherAt', { time: nowTimeLabel(locale) }))
    } catch (resetError) {
      setError(
        t(locale, 'settingsRuntime.resetFailed', {
          detail: resetError instanceof Error ? resetError.message : 'unknown',
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [isTauri, locale, loadEffective, scope, workspaceId])

  const resetPreview = useCallback(async () => {
    if (!isTauri) {
      setMessage(t(locale, 'settingsRuntime.webPreviewNotice'))
      return
    }

    const targetWorkspaceId = scopeWorkspaceId(scope, workspaceId)
    if ((scope === 'workspace' || scope === 'session') && !targetWorkspaceId) {
      setError(t(locale, 'settingsRuntime.workspaceRequired'))
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await desktopApi.settingsReset(scope, FS_PREVIEW_KEYS, targetWorkspaceId)
      await loadEffective()
      setMessage(t(locale, 'settingsRuntime.resetPreviewAt', { time: nowTimeLabel(locale) }))
    } catch (resetError) {
      setError(
        t(locale, 'settingsRuntime.resetFailed', {
          detail: resetError instanceof Error ? resetError.message : 'unknown',
        }),
      )
    } finally {
      setSaving(false)
    }
  }, [isTauri, locale, loadEffective, scope, workspaceId])

  const disabled = loading || saving

  const scopeOptions = useMemo(
    () => [
      { value: 'workspace' as const, label: t(locale, 'settingsRuntime.scopeWorkspace') },
      { value: 'user' as const, label: t(locale, 'settingsRuntime.scopeUser') },
      { value: 'session' as const, label: t(locale, 'settingsRuntime.scopeSession') },
    ],
    [locale],
  )

  return (
    <section className="settings-runtime-pane" aria-label={t(locale, 'settingsRuntime.title')}>
      <header className="settings-runtime-header">
        <div>
          <h3>{t(locale, 'settingsRuntime.title')}</h3>
          <p>{t(locale, 'settingsRuntime.subtitle')}</p>
        </div>
        <div className="settings-runtime-actions">
          <button type="button" onClick={() => void loadEffective()} disabled={disabled}>
            {t(locale, 'settingsRuntime.reload')}
          </button>
          <button type="button" onClick={() => void saveSettings()} disabled={disabled}>
            {t(locale, 'settingsRuntime.save')}
          </button>
        </div>
      </header>

      <div className="settings-runtime-scope-row">
        <label>
          {t(locale, 'settingsRuntime.scope')}
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as SettingsScope)}
            disabled={disabled}
          >
            {scopeOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.value === 'workspace' && !workspaceBound}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          {workspaceBound
            ? t(locale, 'settingsRuntime.workspaceBound', { workspaceId: workspaceId ?? '' })
            : t(locale, 'settingsRuntime.workspaceUnbound')}
        </p>
      </div>

      <section className="settings-runtime-group">
        <header>
          <h4>{t(locale, 'settingsRuntime.watcherGroup')}</h4>
          <button type="button" onClick={() => void resetWatcher()} disabled={disabled}>
            {t(locale, 'settingsRuntime.resetWatcher')}
          </button>
        </header>
        <label>
          {t(locale, 'settingsRuntime.pollIntervalMs')}
          <input
            type="number"
            min={1}
            value={form.watcherPollIntervalMs}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                watcherPollIntervalMs: Number(event.target.value),
              }))
            }
            disabled={disabled}
          />
        </label>
        <label>
          {t(locale, 'settingsRuntime.ignoredDirs')}
          <textarea
            rows={4}
            value={form.watcherIgnoredDirs}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                watcherIgnoredDirs: event.target.value,
              }))
            }
            disabled={disabled}
          />
        </label>
        <label>
          {t(locale, 'settingsRuntime.ignoredExactFiles')}
          <textarea
            rows={3}
            value={form.watcherIgnoredExactFiles}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                watcherIgnoredExactFiles: event.target.value,
              }))
            }
            disabled={disabled}
          />
        </label>
        <label>
          {t(locale, 'settingsRuntime.ignoredSuffixes')}
          <textarea
            rows={3}
            value={form.watcherIgnoredSuffixes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                watcherIgnoredSuffixes: event.target.value,
              }))
            }
            disabled={disabled}
          />
        </label>
        <p className="settings-runtime-hint">{t(locale, 'settingsRuntime.listHint')}</p>
      </section>

      <section className="settings-runtime-group">
        <header>
          <h4>{t(locale, 'settingsRuntime.previewGroup')}</h4>
          <button type="button" onClick={() => void resetPreview()} disabled={disabled}>
            {t(locale, 'settingsRuntime.resetPreview')}
          </button>
        </header>
        <label>
          {t(locale, 'settingsRuntime.previewMaxBytes')}
          <input
            type="number"
            min={1}
            value={form.previewMaxBytes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                previewMaxBytes: Number(event.target.value),
              }))
            }
            disabled={disabled}
          />
        </label>
        <label>
          {t(locale, 'settingsRuntime.previewFullDefault')}
          <input
            type="number"
            min={1}
            value={form.previewFullReadDefaultMaxBytes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                previewFullReadDefaultMaxBytes: Number(event.target.value),
              }))
            }
            disabled={disabled}
          />
        </label>
        <label>
          {t(locale, 'settingsRuntime.previewFullHard')}
          <input
            type="number"
            min={1}
            value={form.previewFullReadHardMaxBytes}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                previewFullReadHardMaxBytes: Number(event.target.value),
              }))
            }
            disabled={disabled}
          />
        </label>
      </section>

      {message ? <p className="settings-runtime-message">{message}</p> : null}
      {error ? <p className="settings-runtime-error">{error}</p> : null}

      <details className="settings-runtime-sources">
        <summary>{t(locale, 'settingsRuntime.sources')}</summary>
        <pre>{sourceText}</pre>
      </details>
    </section>
  )
}
