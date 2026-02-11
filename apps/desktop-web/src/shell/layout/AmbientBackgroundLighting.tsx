import { memo } from 'react'
import type { AmbientLightingIntensity } from '../state/ui-preferences'

interface AmbientBackgroundLightingProps {
  enabled: boolean
  intensity: AmbientLightingIntensity
}

// 使用 memo 避免不必要的重渲染
export const AmbientBackgroundLighting = memo(function AmbientBackgroundLighting({
  enabled,
  intensity,
}: AmbientBackgroundLightingProps) {
  // 完全禁用时不渲染任何内容
  if (!enabled) {
    return null
  }

  // 使用静态渐变代替动画，大幅降低 GPU 负载
  return (
    <div
      className={`ambient-background-layer-static intensity-${intensity}`}
      aria-hidden="true"
    />
  )
})
