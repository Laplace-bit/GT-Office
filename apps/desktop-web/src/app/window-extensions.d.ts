export {}

declare global {
  interface Window {
    __GTO_OPEN_CHANNEL_STUDIO__?: () => void
    __GTO_TERMINAL_FOCUS_DIAGNOSTICS_INSTALLED__?: boolean
  }
}
