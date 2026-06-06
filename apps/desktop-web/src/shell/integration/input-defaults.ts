const TEXT_ENTRY_SELECTOR = 'input:not([autocapitalize]), textarea:not([autocapitalize]), [contenteditable="true"]:not([autocapitalize])'

function disableAutocapitalize(element: Element): void {
  if (element.matches(TEXT_ENTRY_SELECTOR)) {
    element.setAttribute('autocapitalize', 'off')
  }
}

export function installInputDefaults(): void {
  if (typeof document === 'undefined') {
    return
  }

  document.querySelectorAll(TEXT_ENTRY_SELECTOR).forEach(disableAutocapitalize)

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) {
          return
        }

        disableAutocapitalize(node)
        node.querySelectorAll(TEXT_ENTRY_SELECTOR).forEach(disableAutocapitalize)
      })
    })
  })

  observer.observe(document.documentElement, { childList: true, subtree: true })
}
