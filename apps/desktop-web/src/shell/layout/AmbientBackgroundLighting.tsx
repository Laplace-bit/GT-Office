import type { AmbientLightingIntensity } from '../state/ui-preferences'

interface AmbientBackgroundLightingProps {
  enabled: boolean
  intensity: AmbientLightingIntensity
}

export function AmbientBackgroundLighting({ enabled, intensity }: AmbientBackgroundLightingProps) {
  if (!enabled) {
    return null
  }

  return (
    <div className={`ambient-background-layer intensity-${intensity}`} aria-hidden="true">
      <span className="ambient-bg-gradient gradient-base" />
      <span className="ambient-bg-gradient gradient-shift" />
      <span className="ambient-bg-vignette" />
    </div>
  )
}
