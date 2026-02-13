export type ShortcutCommandId =
  | 'shell.search.open_file'
  | 'shell.search.open_content'
  | 'shell.editor.find'
  | 'shell.editor.replace'

export interface ShortcutBinding {
  key: string
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

export interface ShortcutBindings {
  openFileSearch: ShortcutBinding
  openContentSearch: ShortcutBinding
  editorFind: ShortcutBinding
  editorReplace: ShortcutBinding
}

type ShortcutBindingKey = keyof ShortcutBindings

const FALLBACK_OPEN_FILE_SEARCH: ShortcutBinding = {
  key: 'p',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}

const FALLBACK_OPEN_CONTENT_SEARCH: ShortcutBinding = {
  key: 'f',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: true,
}

const FALLBACK_EDITOR_FIND: ShortcutBinding = {
  key: 'f',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}

const FALLBACK_EDITOR_REPLACE: ShortcutBinding = {
  key: 'h',
  mod: true,
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
}

const COMMAND_TO_BINDING_KEY: Record<ShortcutCommandId, ShortcutBindingKey> = {
  'shell.search.open_file': 'openFileSearch',
  'shell.search.open_content': 'openContentSearch',
  'shell.editor.find': 'editorFind',
  'shell.editor.replace': 'editorReplace',
}

const MODIFIER_TOKEN_SET = new Set(['mod', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt', 'option', 'shift'])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function normalizeShortcutKey(value: string): string {
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'space':
      return ' '
    case 'esc':
      return 'escape'
    case 'del':
      return 'delete'
    case 'return':
      return 'enter'
    case 'plus':
      return '+'
    default:
      return normalized
  }
}

function parseShortcutKeystroke(keystroke: string): ShortcutBinding | null {
  const tokens = keystroke
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  if (tokens.length === 0) {
    return null
  }

  const parsed: ShortcutBinding = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  }

  for (const token of tokens) {
    const normalized = token.toLowerCase()
    if (normalized === 'mod') {
      parsed.mod = true
      continue
    }
    if (normalized === 'ctrl' || normalized === 'control') {
      parsed.ctrl = true
      continue
    }
    if (normalized === 'meta' || normalized === 'cmd' || normalized === 'command') {
      parsed.meta = true
      continue
    }
    if (normalized === 'alt' || normalized === 'option') {
      parsed.alt = true
      continue
    }
    if (normalized === 'shift') {
      parsed.shift = true
      continue
    }
    if (MODIFIER_TOKEN_SET.has(normalized)) {
      return null
    }
    if (parsed.key) {
      return null
    }
    parsed.key = normalizeShortcutKey(token)
  }

  if (!parsed.key) {
    return null
  }

  return parsed
}

function parseOrFallback(keystroke: string, fallback: ShortcutBinding): ShortcutBinding {
  return parseShortcutKeystroke(keystroke) ?? fallback
}

function cloneShortcutBinding(binding: ShortcutBinding): ShortcutBinding {
  return {
    key: binding.key,
    mod: binding.mod,
    ctrl: binding.ctrl,
    meta: binding.meta,
    alt: binding.alt,
    shift: binding.shift,
  }
}

function equalsShortcutBinding(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return (
    left.key === right.key &&
    left.mod === right.mod &&
    left.ctrl === right.ctrl &&
    left.meta === right.meta &&
    left.alt === right.alt &&
    left.shift === right.shift
  )
}

function parseOverrideBindings(values: Record<string, unknown>): Partial<ShortcutBindings> {
  const keybindings = asRecord(values.keybindings)
  if (!keybindings) {
    return {}
  }
  const overrides = keybindings.overrides
  if (!Array.isArray(overrides) || overrides.length === 0) {
    return {}
  }

  const parsed: Partial<ShortcutBindings> = {}
  for (const item of overrides) {
    const record = asRecord(item)
    if (!record) {
      continue
    }
    const command = typeof record.command === 'string' ? record.command.trim() : ''
    const keystroke = typeof record.keystroke === 'string' ? record.keystroke.trim() : ''
    if (!command || !keystroke) {
      continue
    }
    if (!(command in COMMAND_TO_BINDING_KEY)) {
      continue
    }
    const parsedBinding = parseShortcutKeystroke(keystroke)
    if (!parsedBinding) {
      continue
    }
    const bindingKey = COMMAND_TO_BINDING_KEY[command as ShortcutCommandId]
    parsed[bindingKey] = parsedBinding
  }
  return parsed
}

export const defaultShortcutBindings: ShortcutBindings = {
  openFileSearch: parseOrFallback('Mod+P', FALLBACK_OPEN_FILE_SEARCH),
  openContentSearch: parseOrFallback('Mod+Shift+F', FALLBACK_OPEN_CONTENT_SEARCH),
  editorFind: parseOrFallback('Mod+F', FALLBACK_EDITOR_FIND),
  editorReplace: parseOrFallback('Mod+H', FALLBACK_EDITOR_REPLACE),
}

export function resolveShortcutBindingsFromSettings(values: Record<string, unknown>): ShortcutBindings {
  const overrides = parseOverrideBindings(values)
  return {
    openFileSearch: cloneShortcutBinding(overrides.openFileSearch ?? defaultShortcutBindings.openFileSearch),
    openContentSearch: cloneShortcutBinding(
      overrides.openContentSearch ?? defaultShortcutBindings.openContentSearch,
    ),
    editorFind: cloneShortcutBinding(overrides.editorFind ?? defaultShortcutBindings.editorFind),
    editorReplace: cloneShortcutBinding(overrides.editorReplace ?? defaultShortcutBindings.editorReplace),
  }
}

export function areShortcutBindingsEqual(left: ShortcutBindings, right: ShortcutBindings): boolean {
  return (
    equalsShortcutBinding(left.openFileSearch, right.openFileSearch) &&
    equalsShortcutBinding(left.openContentSearch, right.openContentSearch) &&
    equalsShortcutBinding(left.editorFind, right.editorFind) &&
    equalsShortcutBinding(left.editorReplace, right.editorReplace)
  )
}

export function matchesShortcutEvent(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  binding: ShortcutBinding,
  isMacOs: boolean,
): boolean {
  if (normalizeShortcutKey(event.key) !== binding.key) {
    return false
  }

  const expectedCtrl = binding.ctrl || (!isMacOs && binding.mod)
  const expectedMeta = binding.meta || (isMacOs && binding.mod)

  if (event.ctrlKey !== expectedCtrl) {
    return false
  }
  if (event.metaKey !== expectedMeta) {
    return false
  }
  if (event.altKey !== binding.alt) {
    return false
  }
  if (event.shiftKey !== binding.shift) {
    return false
  }
  return true
}
