export type FileTreeModalKeyKind = 'prompt' | 'confirm'

export function buildFileTreeModalKey(
  kind: FileTreeModalKeyKind,
  open: boolean,
  title: string,
  detail: string,
): string {
  return `${kind}:${open ? 'open' : 'closed'}:${title}:${detail}`
}
