import type { SVGProps } from 'react'

export type AppIconName =
  | 'stations'
  | 'tasks'
  | 'files'
  | 'git'
  | 'hooks'
  | 'channels'
  | 'policy'
  | 'settings'
  | 'terminal'
  | 'sparkles'
  | 'expand'
  | 'collapse'
  | 'close'
  | 'plus'
  | 'folder-open'
  | 'file-text'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'fullscreen-enter'
  | 'fullscreen-exit'
  | 'refresh'
  | 'command'
  | 'bolt'
  | 'search'
  // Git-specific icons
  | 'arrow-up'
  | 'arrow-down'
  | 'cloud-download'
  | 'check'
  | 'x-mark'
  | 'git-branch'
  | 'git-commit'
  | 'git-merge'
  | 'clock'
  | 'archive'
  | 'trash'
  | 'sync'

interface AppIconProps extends SVGProps<SVGSVGElement> {
  name: AppIconName
}

export function AppIcon({ name, className, ...props }: AppIconProps) {
  switch (name) {
    case 'stations':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M3.8 4.8h5.7v5.7H3.8V4.8Zm6.7 0h5.7v3.8h-5.7V4.8Zm0 4.8h5.7v5.7h-5.7V9.6Zm-6.7 1.9h5.7v3.8H3.8v-3.8Z" />
        </svg>
      )
    case 'tasks':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M4.2 6h11.6M4.2 10h7.3M4.2 14h6.1" />
          <path d="m12.9 13.2 1.8 1.8 2.5-2.5" />
        </svg>
      )
    case 'files':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M3.8 5h4.3l1.5 1.7h6.6v8.3H3.8V5Z" />
        </svg>
      )
    case 'git':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="7.1" cy="6.4" r="1.7" />
          <circle cx="12.9" cy="13.4" r="1.7" />
          <path d="M7.1 8.1V12a2.1 2.1 0 0 0 2.1 2.1h2" />
        </svg>
      )
    case 'hooks':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M7 7a2.7 2.7 0 0 1 2.7-2.7H12A2.7 2.7 0 0 1 12 9.7H9.8" />
          <path d="M13 13a2.7 2.7 0 0 1-2.7 2.7H8A2.7 2.7 0 0 1 8 10.3h2.2" />
        </svg>
      )
    case 'channels':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M3.9 6h5.7v3.8H3.9V6Zm6.5 4.3h5.7V14h-5.7v-3.7Z" />
          <path d="M9.7 8h2.7a2 2 0 0 1 2 2v.3" />
        </svg>
      )
    case 'policy':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10 4.2 15.6 6.3v3.9c0 2.8-2 4.8-5.6 6.1-3.6-1.3-5.6-3.3-5.6-6.1V6.3L10 4.2Z" />
          <path d="m7.7 10.3 1.5 1.5 3-3" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="10" cy="10" r="2.6" />
          <path d="m10 4 .8 1.5 1.8.3 1.2-1.1 1.3 1.3-1.1 1.2.3 1.8L16 10l-1.7.9-.3 1.8 1.1 1.2-1.3 1.3-1.2-1.1-1.8.3L10 16l-.9-1.7-1.8-.3-1.2 1.1-1.3-1.3 1.1-1.2-.3-1.8L4 10l1.7-.9.3-1.8-1.1-1.2 1.3-1.3 1.2 1.1 1.8-.3L10 4Z" />
        </svg>
      )
    case 'terminal':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m5 7.3 2.5 2.4L5 12.1" />
          <path d="M9.4 12.2h5.5" />
          <rect x="3.8" y="4.6" width="12.4" height="10.8" rx="2" />
        </svg>
      )
    case 'sparkles':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10 4.1 11 7l2.9 1-2.9 1L10 11.9 9 9 6.1 8 9 7l1-2.9Z" />
          <path d="M14.7 11.9 15.3 13l1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6.6-1.1Z" />
          <path d="M5.4 11.9 6 13l1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6.6-1.1Z" />
        </svg>
      )
    case 'expand':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M7 3.9H4v3M13 3.9h3v3M7 16.1H4v-3M13 16.1h3v-3" />
        </svg>
      )
    case 'collapse':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M6.4 8.3h-2V4.2h4.1v2M13.6 8.3h2V4.2h-4.1v2M6.4 11.7h-2v4.1h4.1v-2M13.6 11.7h2v4.1h-4.1v-2" />
        </svg>
      )
    case 'close':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m6 6 8 8M14 6l-8 8" />
        </svg>
      )
    case 'plus':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10 4.5v11M4.5 10h11" />
        </svg>
      )
    case 'folder-open':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M3.8 6h4.1l1.4 1.5h7v5.6a1.9 1.9 0 0 1-1.9 1.9H5.7a1.9 1.9 0 0 1-1.9-1.9V6Z" />
        </svg>
      )
    case 'file-text':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M6 4.7h6.2l2.2 2.2v8.4H6V4.7Z" />
          <path d="M8 9.3h4.9M8 11.6h4.9" />
        </svg>
      )
    case 'chevron-right':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m8 6.6 4 3.4-4 3.4" />
        </svg>
      )
    case 'chevron-down':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m6.6 8 3.4 4 3.4-4" />
        </svg>
      )
    case 'chevron-left':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m12 6.6-4 3.4 4 3.4" />
        </svg>
      )
    case 'chevron-up':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="m6.6 12 3.4-4 3.4 4" />
        </svg>
      )
    case 'fullscreen-enter':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M7.3 4.4H4.4v2.9M12.7 4.4h2.9v2.9M7.3 15.6H4.4v-2.9M12.7 15.6h2.9v-2.9" />
        </svg>
      )
    case 'fullscreen-exit':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M8.2 8.2H4.8V4.8h3.4M11.8 8.2h3.4V4.8h-3.4M8.2 11.8H4.8v3.4h3.4M11.8 11.8h3.4v3.4h-3.4" />
        </svg>
      )
    case 'refresh':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M15.7 7.4V4.8h-2.6M4.3 12.6v2.6h2.6" />
          <path d="M6.2 7.2A5.2 5.2 0 0 1 15.7 7M13.8 12.8A5.2 5.2 0 0 1 4.3 13" />
        </svg>
      )
    case 'command':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M7 4.2h.2A2.8 2.8 0 0 1 10 7v.2H7A2.8 2.8 0 0 1 4.2 4.4V4.2H7Zm6 0h2.8v.2A2.8 2.8 0 0 1 13 7.2h-3V7a2.8 2.8 0 0 1 2.8-2.8H13Zm-6 8.6h3v.2A2.8 2.8 0 0 1 7.2 15.8H7a2.8 2.8 0 0 1-2.8-2.8v-.2H7Zm6 0h3v.2a2.8 2.8 0 0 1-2.8 2.8H13a2.8 2.8 0 0 1-2.8-2.8v-.2h2.8Z" />
        </svg>
      )
    case 'bolt':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10.9 3.7 6.2 10h3l-.6 6.3 5.2-7h-3.1l.2-5.6Z" />
        </svg>
      )
    case 'search':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="9" cy="9" r="4.6" />
          <path d="m12.6 12.6 3.1 3.1" />
        </svg>
      )
    case 'arrow-up':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10 16V4M10 4l4 4M10 4 6 8" />
        </svg>
      )
    case 'arrow-down':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M10 4v12M10 16l4-4M10 16l-4-4" />
        </svg>
      )
    case 'cloud-download':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M6.5 14.5H5.5a3.5 3.5 0 1 1 .5-6.97 4.5 4.5 0 0 1 8.5.97 3.5 3.5 0 0 1 0 6H13" />
          <path d="M10 10v6M10 16l-2-2M10 16l2-2" />
        </svg>
      )
    case 'check':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M5 10.5l3 3 7-7" />
        </svg>
      )
    case 'x-mark':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M6 6l8 8M14 6l-8 8" />
        </svg>
      )
    case 'git-branch':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="7" cy="6" r="1.5" />
          <circle cx="7" cy="14" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
          <path d="M7 7.5v5M13 9.5v1a2 2 0 0 1-2 2H9" />
        </svg>
      )
    case 'git-commit':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="10" cy="10" r="2.5" />
          <path d="M10 4v3.5M10 12.5V16" />
        </svg>
      )
    case 'git-merge':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="7" cy="6" r="1.5" />
          <circle cx="7" cy="14" r="1.5" />
          <circle cx="13" cy="14" r="1.5" />
          <path d="M7 7.5v5M13 12.5V9a2 2 0 0 0-2-2H9" />
        </svg>
      )
    case 'clock':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <circle cx="10" cy="10" r="6" />
          <path d="M10 7v3l2 1.5" />
        </svg>
      )
    case 'archive':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M4 6h12v2H4V6ZM4.5 8v7.5h11V8" />
          <path d="M8 11h4" />
        </svg>
      )
    case 'trash':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M5 6h10M8 6V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M6 6v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
        </svg>
      )
    case 'sync':
      return (
        <svg viewBox="0 0 20 20" fill="none" className={className} {...props}>
          <path d="M15 7H5l2-2M5 13h10l-2 2" />
        </svg>
      )
    default:
      return null
  }
}
