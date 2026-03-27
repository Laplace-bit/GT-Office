import { useEffect, useRef, useState } from 'react'
import {
  resolveStationActivitySignalLevelFromDelta,
  resolveStationActivitySignalTimeoutMs,
  type StationActivitySignalLevel,
} from './station-activity-signal-model.js'

export function useStationActivitySignal(
  unreadCount: number | null | undefined,
): StationActivitySignalLevel | null {
  const previousUnreadCountRef = useRef(unreadCount ?? 0)
  const resetTimerRef = useRef<number | null>(null)
  const [level, setLevel] = useState<StationActivitySignalLevel | null>(null)

  useEffect(() => {
    return () => {
      const timerId = resetTimerRef.current
      if (timerId !== null) {
        window.clearTimeout(timerId)
        resetTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const nextUnreadCount = unreadCount ?? 0
    const previousUnreadCount = previousUnreadCountRef.current
    previousUnreadCountRef.current = nextUnreadCount
    const delta = Math.max(0, nextUnreadCount - previousUnreadCount)

    if (nextUnreadCount === 0) {
      const timerId = resetTimerRef.current
      if (timerId !== null) {
        window.clearTimeout(timerId)
        resetTimerRef.current = null
      }
      setLevel(null)
      return
    }

    const nextLevel = resolveStationActivitySignalLevelFromDelta(delta)
    if (!nextLevel) {
      return
    }

    setLevel(nextLevel)

    const timerId = resetTimerRef.current
    if (timerId !== null) {
      window.clearTimeout(timerId)
    }
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null
      setLevel(null)
    }, resolveStationActivitySignalTimeoutMs(nextLevel))
  }, [unreadCount])

  return level
}
