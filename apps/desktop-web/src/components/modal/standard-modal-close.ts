export type StandardModalCloseSource = 'backdrop' | 'escape' | 'explicit'

export function requestStandardModalClose(source: StandardModalCloseSource, onClose: () => void): void {
  if (source === 'backdrop') {
    return
  }

  onClose()
}
