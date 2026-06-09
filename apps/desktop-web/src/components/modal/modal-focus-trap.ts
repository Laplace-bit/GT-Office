const MODAL_TABBABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function resolveModalTabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(MODAL_TABBABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true',
  )
}

export function trapModalTabFocus(
  event: Pick<KeyboardEvent, 'preventDefault' | 'shiftKey'>,
  root: HTMLElement,
): void {
  const tabbableElements = resolveModalTabbableElements(root)
  if (tabbableElements.length === 0) {
    event.preventDefault()
    return
  }

  const activeElement = root.ownerDocument.activeElement
  const firstElement = tabbableElements[0]
  const lastElement = tabbableElements[tabbableElements.length - 1]
  const activeIndex =
    activeElement instanceof HTMLElement ? tabbableElements.indexOf(activeElement) : -1

  if (event.shiftKey && (activeIndex <= 0 || !root.contains(activeElement))) {
    event.preventDefault()
    lastElement?.focus()
    return
  }

  if (!event.shiftKey && (activeIndex === tabbableElements.length - 1 || !root.contains(activeElement))) {
    event.preventDefault()
    firstElement?.focus()
  }
}
