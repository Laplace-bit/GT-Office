import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { desktopApi } from '@shell/integration/desktop-api'

type QrScanState = 'idle' | 'loading' | 'scanning' | 'success' | 'error'

interface QrScanResult {
  appId: string
  domain: string
  botName?: string | null
  openId?: string | null
}

interface FeishuQrScanProps {
  locale: Locale
  onSuccess: (result: QrScanResult) => void
  onError: (message: string) => void
}

export function FeishuQrScan({ locale, onSuccess, onError }: FeishuQrScanProps) {
  const [scanState, setScanState] = useState<QrScanState>('idle')
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [expireIn, setExpireIn] = useState(0)
  const [remainingSec, setRemainingSec] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (scanState === 'scanning' && expireIn > 0) {
      const start = Date.now()
      timerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000)
        const remaining = Math.max(0, expireIn - elapsed)
        setRemainingSec(remaining)
        if (remaining <= 0) {
          setScanState('error')
          setErrorMessage(t(locale, '二维码已过期，请重新扫码。', 'QR code expired. Please try again.'))
          cleanup()
        }
      }, 1000)
      return () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
      }
    }
  }, [scanState, expireIn, locale])

  function cleanup() {
    unlistenRef.current.forEach((fn) => fn())
    unlistenRef.current = []
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    desktopApi.feishuQrLoginCancel().catch(() => {})
  }

  async function handleStartScan() {
    setScanState('loading')
    setErrorMessage(null)
    setAttempt(0)

    try {
      const response = await desktopApi.feishuQrLoginStart()
      setQrUrl(response.result.qrUrl)
      setExpireIn(response.result.expireIn)
      setRemainingSec(response.result.expireIn)
      setScanState('scanning')

      // Subscribe to Tauri events
      const { listen } = await import('@tauri-apps/api/event')

      const unlistenPolling = await listen<{ attempt: number }>('feishu-qr/polling', (event) => {
        setAttempt(event.payload.attempt)
      })

      const unlistenSuccess = await listen<QrScanResult>('feishu-qr/success', (event) => {
        setScanState('success')
        onSuccess(event.payload)
        // Clean up listeners
        unlistenRef.current.forEach((fn) => fn())
        unlistenRef.current = []
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
      })

      const unlistenError = await listen<{ message: string }>('feishu-qr/error', (event) => {
        setScanState('error')
        setErrorMessage(event.payload.message)
        onError(event.payload.message)
      })

      const unlistenExpired = await listen('feishu-qr/expired', () => {
        setScanState('error')
        setErrorMessage(t(locale, '二维码已过期，请重新扫码。', 'QR code expired. Please try again.'))
      })

      unlistenRef.current = [unlistenPolling, unlistenSuccess, unlistenError, unlistenExpired]
    } catch (error) {
      setScanState('error')
      const msg = error instanceof Error ? error.message : String(error)
      setErrorMessage(msg)
      onError(msg)
    }
  }

  function handleRetry() {
    cleanup()
    handleStartScan()
  }

  const formatRemaining = (sec: number) => {
    const min = Math.floor(sec / 60)
    const s = sec % 60
    return `${min}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div className="feishu-qr-scan">
      {scanState === 'idle' && (
        <div className="feishu-qr-scan-idle">
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleStartScan}
          >
            {t(locale, '扫码连接飞书', 'Scan QR to Connect')}
          </button>
          <p className="feishu-qr-scan-hint">
            {t(
              locale,
              '使用飞书或 Lark 扫描二维码，自动创建应用并连接。',
              'Scan with Feishu or Lark to auto-create an app and connect.',
            )}
          </p>
        </div>
      )}

      {scanState === 'loading' && (
        <div className="feishu-qr-scan-loading">
          <div className="feishu-qr-scan-spinner" />
          <p>{t(locale, '正在生成二维码...', 'Generating QR code...')}</p>
        </div>
      )}

      {scanState === 'scanning' && qrUrl && (
        <div className="feishu-qr-scan-scanning">
          <div className="feishu-qr-code-wrapper">
            <QRCodeSVG
              value={qrUrl}
              size={240}
              level="M"
              bgColor="#ffffff"
              fgColor="#0f172a"
            />
          </div>
          <p className="feishu-qr-scan-instruction">
            {t(
              locale,
              '请使用飞书/Lark 扫描二维码',
              'Scan the QR code with Feishu/Lark',
            )}
          </p>
          {attempt > 0 && (
            <p className="feishu-qr-scan-attempt">
              {t(locale, '等待扫码... (尝试 {n})', 'Waiting for scan... (attempt {n})', { n: attempt })}
            </p>
          )}
          <p className="feishu-qr-scan-timer">
            {t(locale, '剩余 {time}', '{time} remaining', { time: formatRemaining(remainingSec) })}
          </p>
        </div>
      )}

      {scanState === 'success' && (
        <div className="feishu-qr-scan-success">
          <div className="feishu-qr-scan-check">✓</div>
          <p>{t(locale, '连接成功！', 'Connected!')}</p>
        </div>
      )}

      {scanState === 'error' && (
        <div className="feishu-qr-scan-error">
          <p className="settings-channel-error">
            {errorMessage || t(locale, '连接失败，请重试。', 'Connection failed. Please try again.')}
          </p>
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleRetry}
          >
            {t(locale, '重新扫码', 'Retry Scan')}
          </button>
        </div>
      )}
    </div>
  )
}
