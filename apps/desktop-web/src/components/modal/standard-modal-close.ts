export type StandardModalCloseSource = 'backdrop' | 'explicit'

export function requestStandardModalClose(source: StandardModalCloseSource, onClose: () => void): void {
  if (source !== 'explicit') {
    return
  }

  onClose()
}
