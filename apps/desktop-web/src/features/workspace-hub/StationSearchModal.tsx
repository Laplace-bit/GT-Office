import { useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { trapModalTabFocus } from '@/components/modal/modal-focus-trap'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'
import type { AgentStation } from './station-model'
import './StationSearchModal.scss'

interface StationSearchModalProps {
  open: boolean
  locale: Locale
  query: string
  stations: AgentStation[]
  onClose: () => void
  onQueryChange: (value: string) => void
  onSelectStation: (stationId: string) => void
}

export function StationSearchModal({
  open,
  locale,
  query,
  stations,
  onClose,
  onQueryChange,
  onSelectStation,
}: StationSearchModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null)

  if (!open) {
    return null
  }

  const handleSearchModalKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' && event.key !== 'Tab') {
      return
    }
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestStandardModalClose('escape', onClose)
      return
    }

    const dialog = dialogRef.current
    if (!dialog) {
      return
    }
    event.stopPropagation()
    trapModalTabFocus(event.nativeEvent, dialog)
  }

  return (
    <div
      className="settings-modal-backdrop"
      onKeyDown={handleSearchModalKeyDown}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestStandardModalClose('backdrop', onClose)
        }
      }}
    >
      <section
        ref={dialogRef}
        className="settings-modal panel station-search-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="station-search-modal-title"
      >
        <header className="settings-modal-header">
          <div>
            <h2 id="station-search-modal-title">{locale === 'zh-CN' ? '搜索角色' : 'Search Roles'}</h2>
            <p>{locale === 'zh-CN' ? '输入关键字实时过滤中央角色。' : 'Type to filter roles in real time.'}</p>
          </div>
          <button
            type="button"
            onClick={() => requestStandardModalClose('explicit', onClose)}
            aria-label={t(locale, 'settingsModal.close')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <label className="station-search-input-wrap">
          <span>{t(locale, 'station.filter.search')}</span>
          <input
            type="search"
            value={query}
            placeholder={t(locale, 'station.filter.searchPlaceholder')}
            onChange={(event) => onQueryChange(event.target.value)}
            autoFocus
          />
        </label>

        <ul className="station-search-result-list">
          {stations.length === 0 ? (
            <li className="station-search-empty">{locale === 'zh-CN' ? '没有匹配角色' : 'No matched roles'}</li>
          ) : (
            stations.map((station) => (
              <li key={station.id}>
                <button
                  type="button"
                  className="station-search-result-btn"
                  onClick={() => {
                    onSelectStation(station.id)
                    onClose()
                  }}
                >
                  <strong>{station.name}</strong>
                  <span>{station.agentWorkdirRel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  )
}
