export function resolveTerminalDocument(
  host: HTMLElement | null | undefined,
  fallbackDocument: Document,
): Document {
  return host?.ownerDocument ?? fallbackDocument
}
