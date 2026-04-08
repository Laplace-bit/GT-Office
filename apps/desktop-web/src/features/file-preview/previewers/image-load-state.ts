export interface ImageLoadSnapshot {
  complete: boolean
  naturalWidth: number
}

export function isImageLoaded(snapshot: ImageLoadSnapshot | null | undefined): boolean {
  if (!snapshot) {
    return false
  }
  return snapshot.complete && snapshot.naturalWidth > 0
}
