import type { SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Link,
  Scissors,
  CloudDownload,
  Command,
  FileText,
  FolderOpen,
  FolderTree,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Info,
  LayoutGrid,
  Link2,
  ListTodo,
  Maximize,
  Maximize2,
  MessageCircle,
  Minimize,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  Undo2,
  UserPen,
  Workflow,
  X,
  Zap,
} from 'lucide-react'

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
  | 'minus'
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
  | 'arrow-up'
  | 'arrow-down'
  | 'cloud-download'
  | 'check'
  | 'x-mark'
  | 'undo'
  | 'rotate-ccw'
  | 'git-branch'
  | 'git-commit'
  | 'git-merge'
  | 'clock'
  | 'archive'
  | 'trash'
  | 'sync'
  | 'telegram'
  | 'feishu'
  | 'wechat'
  | 'activity'
  | 'pencil'
  | 'user-pen'
  | 'info'
  | 'external'
  | 'file-plus'
  | 'folder-plus'
  | 'scissors'
  | 'copy'
  | 'clipboard-paste'
  | 'link'

const iconMap: Record<AppIconName, LucideIcon> = {
  stations: LayoutGrid,
  tasks: ListTodo,
  files: FolderTree,
  git: GitBranch,
  hooks: Link2,
  channels: Workflow,
  policy: ShieldCheck,
  settings: Settings2,
  terminal: SquareTerminal,
  sparkles: Sparkles,
  minus: Minus,
  expand: Maximize2,
  collapse: Minimize2,
  close: X,
  plus: Plus,
  'folder-open': FolderOpen,
  'file-text': FileText,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'chevron-left': ChevronLeft,
  'fullscreen-enter': Maximize,
  'fullscreen-exit': Minimize,
  refresh: RefreshCw,
  command: Command,
  bolt: Zap,
  search: Search,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'cloud-download': CloudDownload,
  check: Check,
  'x-mark': X,
  undo: Undo2,
  'rotate-ccw': RotateCcw,
  'git-branch': GitBranch,
  'git-commit': GitCommitHorizontal,
  'git-merge': GitMerge,
  clock: Clock3,
  archive: Archive,
  trash: Trash2,
  sync: RefreshCcw,
  telegram: Send,
  feishu: MessageCircle,
  wechat: MessageCircle,
  activity: Activity,
  pencil: Pencil,
  'user-pen': UserPen,
  info: Info,
  external: ExternalLink,
  'file-plus': FilePlus,
  'folder-plus': FolderPlus,
  scissors: Scissors,
  copy: Copy,
  'clipboard-paste': ClipboardPaste,
  link: Link,
}

interface AppIconProps extends SVGProps<SVGSVGElement> {
  name: AppIconName
}

export function AppIcon({ name, className, strokeWidth, ...props }: AppIconProps) {
  const Icon = iconMap[name] ?? Info
  return <Icon className={className} strokeWidth={strokeWidth ?? 1.75} {...props} />
}
