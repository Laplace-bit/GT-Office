import { memo } from 'react'
import { Edit, Eye, Columns } from 'lucide-react'
import type { Locale, TranslationKey } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'
import type { MarkdownViewMode } from '@/components/editor'
import './MarkdownModeToggle.scss'

interface MarkdownModeToggleProps {
  locale: Locale
  mode: MarkdownViewMode
  onChange: (mode: MarkdownViewMode) => void
}

const MODE_CONFIG: { mode: MarkdownViewMode; icon: typeof Edit; labelKey: TranslationKey }[] = [
  { mode: 'edit', icon: Edit, labelKey: 'preview.mode.edit' },
  { mode: 'preview', icon: Eye, labelKey: 'preview.mode.preview' },
  { mode: 'split', icon: Columns, labelKey: 'preview.mode.split' },
]

export const MarkdownModeToggle = memo(function MarkdownModeToggle({
  locale,
  mode,
  onChange,
}: MarkdownModeToggleProps) {
  return (
    <div className="markdown-mode-toggle" role="tablist">
      {MODE_CONFIG.map(({ mode: m, icon: Icon, labelKey }) => (
        <button
          key={m}
          type="button"
          className={`markdown-mode-btn ${mode === m ? 'active' : ''}`}
          onClick={() => onChange(m)}
          role="tab"
          aria-selected={mode === m}
          aria-label={t(locale, labelKey)}
          title={t(locale, labelKey)}
        >
          <Icon className="markdown-mode-icon" aria-hidden="true" />
          <span className="markdown-mode-label">{t(locale, labelKey)}</span>
        </button>
      ))}
    </div>
  )
})
