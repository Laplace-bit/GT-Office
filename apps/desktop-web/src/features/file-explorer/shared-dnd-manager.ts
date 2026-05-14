import { createDragDropManager, type DragDropManager } from 'dnd-core'
import { HTML5Backend } from 'react-dnd-html5-backend'

const REACT_DND_INSTANCE_SYMBOL = Symbol.for('__REACT_DND_CONTEXT_INSTANCE__')

declare global {
  interface Window {
    __GTO_FILE_TREE_DND_MANAGER__?: DragDropManager
  }
}

export function getSharedTreeDndManager(): DragDropManager {
  if (typeof window !== 'undefined') {
    const host = window as unknown as Record<string | symbol, unknown>
    const existingContext = host[REACT_DND_INSTANCE_SYMBOL] as
      | { dragDropManager?: DragDropManager | null }
      | null
      | undefined
    if (existingContext?.dragDropManager) {
      window.__GTO_FILE_TREE_DND_MANAGER__ = existingContext.dragDropManager
      return existingContext.dragDropManager
    }

    const existingManager = window.__GTO_FILE_TREE_DND_MANAGER__
    if (existingManager) {
      host[REACT_DND_INSTANCE_SYMBOL] = { dragDropManager: existingManager }
      return existingManager
    }

    const manager = createDragDropManager(HTML5Backend, window)
    window.__GTO_FILE_TREE_DND_MANAGER__ = manager
    host[REACT_DND_INSTANCE_SYMBOL] = { dragDropManager: manager }
    return manager
  }
  return createDragDropManager(HTML5Backend, globalThis)
}