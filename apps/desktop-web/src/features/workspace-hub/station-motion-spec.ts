export const FLUENT_MOTION_DURATION_MS = {
  faster: 83,
  fast: 167,
  normal: 250,
} as const

export const FLUENT_MOTION_DURATION = {
  faster: FLUENT_MOTION_DURATION_MS.faster / 1000,
  fast: FLUENT_MOTION_DURATION_MS.fast / 1000,
  normal: FLUENT_MOTION_DURATION_MS.normal / 1000,
} as const

export const FLUENT_MOTION_EASE = {
  decelerate: [0, 0, 0, 1] as [number, number, number, number],
  accelerate: [1, 0, 1, 1] as [number, number, number, number],
} as const

export const STATION_MOTION = {
  roleFilterExitMs: FLUENT_MOTION_DURATION_MS.fast,
  roleFilterEnterMs: FLUENT_MOTION_DURATION_MS.fast,
  taskbarDockExitMs: FLUENT_MOTION_DURATION_MS.fast,
  taskbarRestoreMs: FLUENT_MOTION_DURATION_MS.normal,
  taskbarRestoreRevealMs: FLUENT_MOTION_DURATION_MS.faster,
  taskbarMinimizeMs: FLUENT_MOTION_DURATION_MS.normal,
  slotLayoutTransition: {
    duration: FLUENT_MOTION_DURATION.fast,
    ease: FLUENT_MOTION_EASE.decelerate,
  },
  cardLayoutTransition: {
    layout: {
      duration: FLUENT_MOTION_DURATION.normal,
      ease: FLUENT_MOTION_EASE.decelerate,
    },
  },
  taskAckTransition: {
    duration: FLUENT_MOTION_DURATION.fast,
    ease: FLUENT_MOTION_EASE.decelerate,
  },
} as const
