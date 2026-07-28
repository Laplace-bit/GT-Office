const TEXT_ENTRY_SELECTOR =
  'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]), textarea, [contenteditable="true"]'

function applyTextEntryDefaults(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    return
  }

  if (!element.matches(TEXT_ENTRY_SELECTOR)) {
    return
  }

  // Prefer the HTML living standard value "none" so sentence capitalisation
  // after Enter is disabled in WebKit (macOS / iOS) and Chromium.
  if (element.getAttribute('autocapitalize') !== 'none') {
    element.setAttribute('autocapitalize', 'none')
  }

  if (element.getAttribute('autocorrect') !== 'off') {
    element.setAttribute('autocorrect', 'off')
  }
}

export function installInputDefaults(): void {
  if (typeof document === 'undefined') {
    return
  }

  document.querySelectorAll(TEXT_ENTRY_SELECTOR).forEach(applyTextEntryDefaults)

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return
        }

        applyTextEntryDefaults(node)
        node.querySelectorAll(TEXT_ENTRY_SELECTOR).forEach(applyTextEntryDefaults)
      })
    })
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })
}
