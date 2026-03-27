import type { Locale } from '@shell/i18n/ui-locale'
import type { StationActivitySignalLevel } from './station-activity-signal-model.js'
import './StationActivityComet.scss'

interface StationActivityCometProps {
  locale: Locale
  level: StationActivitySignalLevel
  size?: 'default' | 'compact'
  className?: string
}

function resolveStationActivityCometAriaLabel(
  locale: Locale,
  level: StationActivitySignalLevel,
): string {
  if (level === 'high') {
    return locale === 'zh-CN' ? '终端输出速度高' : 'Terminal output speed high'
  }
  if (level === 'medium') {
    return locale === 'zh-CN' ? '终端输出速度中' : 'Terminal output speed medium'
  }
  return locale === 'zh-CN' ? '终端输出速度低' : 'Terminal output speed low'
}

export function StationActivityComet({
  locale,
  level,
  size = 'default',
  className,
}: StationActivityCometProps) {
  return (
    <div
      className={['station-activity-comet', `is-${size}`, `is-${level}`, className]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={resolveStationActivityCometAriaLabel(locale, level)}
    >
      <span className="station-activity-comet-trail trail-3" aria-hidden="true" />
      <span className="station-activity-comet-trail trail-2" aria-hidden="true" />
      <span className="station-activity-comet-trail trail-1" aria-hidden="true" />
      <span className="station-activity-comet-head" aria-hidden="true" />
    </div>
  )
}
