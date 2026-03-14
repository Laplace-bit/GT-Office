import { AppIcon } from '@shell/ui/icons'

type StatusPillTone = 'success' | 'warning' | 'muted'

interface StatusPillProps {
  tone: StatusPillTone
  label: string
}

export function StatusPill({ tone, label }: StatusPillProps) {
  const iconName = tone === 'success' ? 'check' : tone === 'warning' ? 'info' : 'activity'

  return (
    <span className={`ai-provider-status-pill ai-provider-status-pill--${tone}`}>
      <AppIcon name={iconName} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
