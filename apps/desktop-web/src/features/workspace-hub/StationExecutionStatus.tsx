import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { StationCardStatusMeta } from './station-card-header-model'
import { FLUENT_MOTION_DURATION, FLUENT_MOTION_EASE } from './station-motion-spec'
import './StationExecutionStatus.scss'

interface StationExecutionStatusProps {
  meta: StationCardStatusMeta
  label: string
  title: string
  compact?: boolean
}

function shouldPulse(meta: StationCardStatusMeta): boolean {
  return meta.key === 'launching' || meta.key === 'recovering' || meta.key === 'busy'
}

export function StationExecutionStatus({
  meta,
  label,
  title,
  compact = false,
}: StationExecutionStatusProps) {
  const prefersReducedMotion = useReducedMotion()
  const pulse = shouldPulse(meta) && !prefersReducedMotion

  return (
    <span
      className={[
        'station-execution-status',
        `is-${meta.tone}`,
        compact ? 'compact' : '',
      ].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
      role="status"
      aria-live="polite"
      data-status-key={meta.key}
    >
      <motion.span
        className="station-execution-status-dot"
        aria-hidden="true"
        animate={pulse ? { opacity: [0.62, 1, 0.62], scale: [1, 1.32, 1] } : { opacity: 1, scale: 1 }}
        transition={
          pulse
            ? { duration: 1.2, ease: 'easeInOut', repeat: Infinity }
            : { duration: FLUENT_MOTION_DURATION.fast, ease: FLUENT_MOTION_EASE.decelerate }
        }
      />
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={meta.key}
          className="station-execution-status-label"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -2 }}
          transition={{ duration: FLUENT_MOTION_DURATION.fast, ease: FLUENT_MOTION_EASE.decelerate }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
