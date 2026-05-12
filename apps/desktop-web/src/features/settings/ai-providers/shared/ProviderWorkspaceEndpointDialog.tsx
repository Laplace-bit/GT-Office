import { useEffect, useMemo, useState } from 'react'

import { desktopApi, type AiConfigEndpointTestResult } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

interface ProviderWorkspaceEndpointDialogProps {
  agentId: 'claude' | 'codex' | 'gemini'
  locale: Locale
  currentValue: string
  initialUrls: string[]
  onSelect: (url: string) => void
  onClose: () => void
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function labelForStatus(entry: AiConfigEndpointTestResult): string {
  if (typeof entry.latencyMs === 'number') {
    return `${entry.latencyMs} ms`
  }
  if (typeof entry.statusCode === 'number') {
    return `HTTP ${entry.statusCode}`
  }
  return entry.error ?? 'Unavailable'
}

export function ProviderWorkspaceEndpointDialog({
  agentId,
  locale,
  currentValue,
  initialUrls,
  onSelect,
  onClose,
}: ProviderWorkspaceEndpointDialogProps) {
  const [urls, setUrls] = useState<string[]>([])
  const [newUrl, setNewUrl] = useState('')
  const [results, setResults] = useState<AiConfigEndpointTestResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const normalized = Array.from(
      new Set(
        [currentValue, ...initialUrls]
          .map(normalizeUrl)
          .filter(Boolean),
      ),
    )
    setUrls(normalized)
  }, [currentValue, initialUrls])

  const sortedResults = useMemo(() => {
    const byUrl = new Map(results.map((item) => [normalizeUrl(item.url), item]))
    return urls
      .map((url) => byUrl.get(normalizeUrl(url)) ?? { url, latencyMs: null, statusCode: null, error: null })
      .sort((left, right) => {
        const leftLatency = typeof left.latencyMs === 'number' ? left.latencyMs : Number.POSITIVE_INFINITY
        const rightLatency = typeof right.latencyMs === 'number' ? right.latencyMs : Number.POSITIVE_INFINITY
        if (leftLatency === rightLatency) {
          return left.url.localeCompare(right.url)
        }
        return leftLatency - rightLatency
      })
  }, [results, urls])

  const fastestUrl = useMemo(
    () => sortedResults.find((item) => typeof item.latencyMs === 'number')?.url ?? null,
    [sortedResults],
  )

  const handleAdd = () => {
    const normalized = normalizeUrl(newUrl)
    if (!normalized) {
      setError(t(locale, '请输入端点地址', 'Enter an endpoint URL'))
      return
    }
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError(t(locale, '仅支持 http 或 https 地址', 'Only http or https URLs are supported'))
        return
      }
    } catch {
      setError(t(locale, '端点地址格式无效', 'Invalid endpoint URL'))
      return
    }
    setUrls((current) => (current.includes(normalized) ? current : [...current, normalized]))
    setNewUrl('')
    setError(null)
  }

  const handleRemove = (url: string) => {
    setUrls((current) => current.filter((item) => item !== url))
    setResults((current) => current.filter((item) => normalizeUrl(item.url) !== url))
  }

  const handleTest = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await desktopApi.aiConfigTestEndpoints(
        urls,
        agentId === 'codex' ? 12 : 8,
      )
      setResults(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="provider-workspace__dialog-backdrop" role="presentation">
      <section
        className="provider-workspace__dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, '端点测速', 'Endpoint check')}
      >
        <div className="provider-workspace__dialog-header">
          <div>
            <h5>{t(locale, '端点测速', 'Endpoint check')}</h5>
            <p>{t(locale, '测试候选地址连通性并挑选响应最快的入口。', 'Test candidate endpoints and pick the fastest reachable URL.')}</p>
          </div>
          <button type="button" className="provider-workspace__dialog-close" onClick={onClose}>
            <AppIcon name="x-mark" width={16} height={16} />
          </button>
        </div>

        <div className="provider-workspace__dialog-add">
          <input
            type="text"
            value={newUrl}
            placeholder={t(locale, 'https://api.example.com/v1', 'https://api.example.com/v1')}
            onChange={(event) => setNewUrl(event.target.value)}
          />
          <button type="button" className="nav-btn btn-secondary" onClick={handleAdd}>
            <AppIcon name="plus" width={15} height={15} />
            {t(locale, '添加', 'Add')}
          </button>
          <button type="button" className="nav-btn btn-primary" onClick={() => void handleTest()} disabled={loading || urls.length === 0}>
            <AppIcon name={loading ? 'activity' : 'bolt'} width={15} height={15} />
            {loading ? t(locale, '测试中...', 'Testing...') : t(locale, '开始测速', 'Run test')}
          </button>
        </div>

        {error && <div className="provider-workspace__dialog-feedback is-error">{error}</div>}

        <div className="provider-workspace__dialog-list">
          {sortedResults.map((entry) => {
            const normalizedUrl = normalizeUrl(entry.url)
            const isCurrent = normalizeUrl(currentValue) === normalizedUrl
            const isFastest = fastestUrl === entry.url
            return (
              <article key={entry.url} className={`provider-workspace__endpoint-card ${isCurrent ? 'is-current' : ''}`}>
                <div className="provider-workspace__endpoint-main">
                  <strong>{entry.url}</strong>
                  <div className="provider-workspace__endpoint-meta">
                    {isCurrent && <span>{t(locale, '当前使用', 'Current')}</span>}
                    {isFastest && <span>{t(locale, '最快', 'Fastest')}</span>}
                    <span>{labelForStatus(entry)}</span>
                  </div>
                </div>
                <div className="provider-workspace__endpoint-actions">
                  <button type="button" className="nav-btn btn-secondary" onClick={() => onSelect(entry.url)}>
                    {t(locale, '使用', 'Use')}
                  </button>
                  <button type="button" className="provider-workspace__icon-button is-danger" onClick={() => handleRemove(normalizedUrl)} aria-label={t(locale, '移除', 'Remove')}>
                    <AppIcon name="trash" width={15} height={15} />
                  </button>
                </div>
              </article>
            )
          })}
          {sortedResults.length === 0 && (
            <div className="provider-workspace__dialog-empty">
              {t(locale, '先添加至少一个候选端点。', 'Add at least one endpoint candidate to begin.')}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
