const TASK_ACK_EMOJIS = [
  '👌🏻',
  '👍🏻',
  '✅',
  '🫡',
  '🚀',
  '✨',
  '🎯',
  '🙌🏻',
  '😎',
  '🤝',
  '⚡',
  '🛠️',
] as const

export function listStationTaskAckEmojis() {
  return [...TASK_ACK_EMOJIS]
}

export function resolveStationTaskAckEmoji(nonce: number) {
  const emojis = TASK_ACK_EMOJIS
  const index = Math.abs(Math.trunc(nonce)) % emojis.length
  return emojis[index]
}
