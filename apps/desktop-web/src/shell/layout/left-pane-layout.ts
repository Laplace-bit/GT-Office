const LEFT_PANE_SLOT_CLASS_NAME = 'shell-left-pane-slot'
const LEFT_PANE_SLOT_HIDDEN_CLASS_NAME = 'shell-left-pane-slot--hidden'

export function resolveLeftPaneSlotClassName(isVisible: boolean): string {
  return isVisible
    ? LEFT_PANE_SLOT_CLASS_NAME
    : `${LEFT_PANE_SLOT_CLASS_NAME} ${LEFT_PANE_SLOT_HIDDEN_CLASS_NAME}`
}
