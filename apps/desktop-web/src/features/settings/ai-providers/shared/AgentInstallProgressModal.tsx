import { useEffect, useRef, useState } from 'react'
import { desktopApi, type AiConfigAgent } from '@shell/integration/desktop-api'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'

import './AgentInstallProgressModal.scss'

type ProgressPhase = 'running' | 'success' | 'error'

interface AgentInstallProgressModalProps {
  locale: Locale
  agentId: AiConfigAgent
  agentName: string
  operation: 'install' | 'uninstall'
  operationPromise: Promise<void>
  onClose: () => void
  onCompleted: (success: boolean) => void
  onRetry?: () => void
}

const SLOW_THRESHOLD_MS = 60_000

export function AgentInstallProgressModal({
  locale,
  agentId,
  agentName,
  operation,
  operationPromise,
  onClose,
  onCompleted,
  onRetry,
}: AgentInstallProgressModalProps) {
  const [phase, setPhase] = useState<ProgressPhase>('running')
  const [lines, setLines] = useState<string[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showSlowHint, setShowSlowHint] = useState(false)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const startedAtRef = useRef(Date.now())
  const completedRef = useRef(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let cancelled = false

    void desktopApi.listenInstallProgress(agentId, (message) => {
      if (cancelled) {
        return
      }
      setLines((prev) => [...prev, message])
    }).then((fn) => {
      if (cancelled) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [agentId])

  useEffect(() => {
    if (completedRef.current) {
      return
    }

    void operationPromise
      .then(() => {
        if (completedRef.current) {
          return
        }
        completedRef.current = true
        setPhase('success')
        onCompleted(true)
      })
      .catch((err: unknown) => {
        if (completedRef.current) {
          return
        }
        completedRef.current = true
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMessage(msg)
        setPhase('error')
        onCompleted(false)
      })
  }, [operationPromise, onCompleted])

  useEffect(() => {
    if (phase !== 'running') {
      return
    }
    const timer = window.setTimeout(() => {
      if (!completedRef.current) {
        setShowSlowHint(true)
      }
    }, SLOW_THRESHOLD_MS - (Date.now() - startedAtRef.current))
    return () => window.clearTimeout(timer)
  }, [phase])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines])

  const titleKey = operation === 'install'
    ? 'aiConfig.progress.title.install' as const
    : 'aiConfig.progress.title.uninstall' as const

  return (
    <div className="agent-install-progress-overlay" onClick={onClose}>
      <div
        className="agent-install-progress-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t(locale, titleKey, { name: agentName })}
      >
        <header className="agent-install-progress-modal__header">
          <h3>{t(locale, titleKey, { name: agentName })}</h3>
          <button
            type="button"
            className="agent-install-progress-modal__close"
            onClick={onClose}
            aria-label={t(locale, 'aiConfig.progress.close')}
          >
            <AppIcon name="close" width={16} height={16} />
          </button>
        </header>

        <div className="agent-install-progress-modal__status">
          {phase === 'running' && (
            <div className="agent-install-progress-modal__badge is-running">
              <span className="agent-install-progress-modal__spinner" />
              <span>{t(locale, lines.length > 0 ? 'aiConfig.progress.running' : 'aiConfig.progress.waiting')}</span>
            </div>
          )}
          {phase === 'success' && (
            <div className="agent-install-progress-modal__badge is-success">
              <AppIcon name="check" width={14} height={14} />
              <span>{t(locale, 'aiConfig.progress.success')}</span>
            </div>
          )}
          {phase === 'error' && (
            <div className="agent-install-progress-modal__badge is-error">
              <AppIcon name="info" width={14} height={14} />
              <span>{t(locale, 'aiConfig.progress.error')}</span>
            </div>
          )}
        </div>

        <div className="agent-install-progress-modal__log">
          {lines.length === 0 && phase === 'running' && (
            <div className="agent-install-progress-modal__log-empty">
              {t(locale, 'aiConfig.progress.waiting')}
            </div>
          )}
          {lines.map((line, i) => (
            <div key={i} className="agent-install-progress-modal__log-line">{line}</div>
          ))}
          {errorMessage && (
            <div className="agent-install-progress-modal__log-line is-error">{errorMessage}</div>
          )}
          <div ref={logEndRef} />
        </div>

        {showSlowHint && phase === 'running' && (
          <div className="agent-install-progress-modal__slow-hint">
            <AppIcon name="info" width={12} height={12} />
            <span>{t(locale, 'aiConfig.progress.slowHint')}</span>
          </div>
        )}

        <footer className="agent-install-progress-modal__footer">
          {phase === 'error' && onRetry && (
            <button
              type="button"
              className="agent-install-progress-modal__action is-primary"
              onClick={onRetry}
            >
              <AppIcon name="refresh" width={14} height={14} />
              {t(locale, 'aiConfig.progress.retry')}
            </button>
          )}
          <button
            type="button"
            className="agent-install-progress-modal__action is-secondary"
            onClick={onClose}
          >
            {t(locale, 'aiConfig.progress.close')}
          </button>
        </footer>
      </div>
    </div>
  )
}
