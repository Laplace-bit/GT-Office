export {}

import type { DragDropManager } from 'dnd-core'

declare global {
  interface Window {
    __GTO_OPEN_CHANNEL_STUDIO__?: () => void
    __GTO_TERMINAL_FOCUS_DIAGNOSTICS_INSTALLED__?: boolean
    __GTO_FILE_TREE_DND_MANAGER__?: DragDropManager
  }
}
