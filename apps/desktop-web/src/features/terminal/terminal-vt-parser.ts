function decodeEscapedDebugText(value: string): string {
  return value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\n/g, '\n')
}

export type TerminalHumanCategory = 'reply' | 'status' | 'tip' | 'input' | 'notice' | 'system'

export interface TerminalHumanEntry {
  category: TerminalHumanCategory
  text: string
}

function splitNormalizedLines(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeHumanLine(line))
}

function describeSgr(params: string): string[] {
  if (!params) {
    return ['SGR: Reset rendition']
  }
  const parts = params.split(';')
  if (params === '39') {
    return ['SGR: Reset foreground color']
  }
  if (params === '7') {
    return ['SGR: Enable inverse video']
  }
  if (params === '27') {
    return ['SGR: Disable inverse video']
  }
  if (parts[0] === '38' && parts[1] === '2' && parts.length >= 5) {
    return [`SGR: Set foreground RGB(${parts[2]},${parts[3]},${parts[4]})`]
  }
  return [`SGR: Set graphic rendition (${params})`]
}

function describeCsi(params: string, final: string): string[] {
  const count = params.length > 0 ? Number.parseInt(params, 10) || 1 : 1
  if (final === 'A') {
    return [`CSI ${params || '1'}A: Cursor up ${count}`]
  }
  if (final === 'B') {
    return [`CSI ${params || '1'}B: Cursor down ${count}`]
  }
  if (final === 'C') {
    return [`CSI ${params || '1'}C: Cursor forward ${count}`]
  }
  if (final === 'D') {
    return [`CSI ${params || '1'}D: Cursor backward ${count}`]
  }
  if (final === 'G') {
    return [`CSI G: Cursor horizontal absolute ${count}`]
  }
  if (final === 'K') {
    if (params === '2') {
      return ['CSI 2K: Erase entire line']
    }
    return [`CSI ${params || '0'}K: Erase in line`]
  }
  if (final === 'm') {
    return describeSgr(params)
  }
  if (final === 'h' && params.startsWith('?')) {
    if (params === '?2026') {
      return ['DECSET 2026: Enable synchronized output']
    }
    return [`DECSET ${params.slice(1)}: Enable private mode`]
  }
  if (final === 'l' && params.startsWith('?')) {
    if (params === '?2026') {
      return ['DECRST 2026: Disable synchronized output']
    }
    return [`DECRST ${params.slice(1)}: Disable private mode`]
  }
  return [`CSI ${params}${final}: Control sequence`] 
}

export function parseTerminalDebugBody(value: string): string {
  const input = decodeEscapedDebugText(value)
  const lines: string[] = []
  let index = 0

  while (index < input.length) {
    const char = input[index]
    if (char === '\u001b' && input[index + 1] === ']') {
      const end = input.indexOf('\u0007', index + 2)
      if (end === -1) {
        lines.push('OSC: Unterminated operating system command')
        break
      }
      const payload = input.slice(index + 2, end)
      const separator = payload.indexOf(';')
      const command = separator === -1 ? payload : payload.slice(0, separator)
      const data = separator === -1 ? '' : payload.slice(separator + 1)
      lines.push(`OSC ${command}: Set window title -> ${data}`)
      index = end + 1
      continue
    }

    if (char === '\u001b' && input[index + 1] === '[') {
      let cursor = index + 2
      while (cursor < input.length && !/[\u0040-\u007e]/.test(input[cursor])) {
        cursor += 1
      }
      if (cursor >= input.length) {
        lines.push('CSI: Unterminated control sequence')
        break
      }
      const params = input.slice(index + 2, cursor)
      const final = input[cursor]
      lines.push(...describeCsi(params, final))
      index = cursor + 1
      continue
    }

    if (char === '\n') {
      lines.push('LF: Line feed')
      index += 1
      continue
    }

    let next = index
    while (next < input.length && input[next] !== '\u001b' && input[next] !== '\n') {
      next += 1
    }
    const text = input.slice(index, next)
    if (text.length > 0) {
      lines.push(`TEXT: ${text}`)
    }
    index = next
  }

  return lines.join('\n')
}

function stripTerminalSequences(value: string): { text: string; notices: string[]; hasKeyboardModeUpdate: boolean } {
  const input = decodeEscapedDebugText(value)
  const output: string[] = []
  const notices: string[] = []
  let hasKeyboardModeUpdate = /\u001b\[[<>][0-9;]*u/.test(input) || /\u001b\[[<>][0-9;]*m/.test(input)
  let index = 0

  while (index < input.length) {
    const char = input[index]
    if (char === '\u001b' && input[index + 1] === ']') {
      const end = input.indexOf('\u0007', index + 2)
      if (end === -1) {
        break
      }
      const payload = input.slice(index + 2, end)
      const separator = payload.indexOf(';')
      const command = separator === -1 ? payload : payload.slice(0, separator)
      const data = separator === -1 ? '' : payload.slice(separator + 1)
      if (command === '777' && data.startsWith('notify;')) {
        const parts = data.split(';')
        const message = parts.at(-1)?.trim()
        if (message) {
          notices.push(message)
        }
      }
      index = end + 1
      continue
    }

    if (char === '\u001b' && input[index + 1] === '[') {
      let cursor = index + 2
      while (cursor < input.length && !/[\u0040-\u007e]/.test(input[cursor])) {
        cursor += 1
      }
      if (cursor >= input.length) {
        break
      }
      const params = input.slice(index + 2, cursor)
      const final = input[cursor]
      if (final === 'u' || (final === 'm' && (params.startsWith('<') || params.startsWith('>')))) {
        hasKeyboardModeUpdate = true
      }
      index = cursor + 1
      continue
    }

    output.push(char)
    index += 1
  }

  return { text: output.join(''), notices, hasKeyboardModeUpdate }
}

function normalizeHumanLine(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[ ]+([.,!?;:])/g, '$1')
    .trim()
}

function compactHumanLine(value: string): string {
  return normalizeHumanLine(value).replace(/\s+/g, '')
}

function isHorizontalRule(value: string): boolean {
  return value.length > 0 && /^[─━▪·—╌╍\s]+$/.test(value)
}

function buildTipText(lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const parts = [normalizeHumanLine(lines[startIndex])]
  let nextIndex = startIndex + 1
  while (nextIndex < lines.length) {
    const candidate = normalizeHumanLine(lines[nextIndex])
    if (!candidate || candidate.startsWith('❯') || candidate.startsWith('-- INSERT --') || isHorizontalRule(candidate)) {
      break
    }
    if (/^(⏺|•|✻|\*|⎿|Tip:|提示:)/.test(candidate)) {
      break
    }
    parts.push(candidate)
    nextIndex += 1
  }
  return { text: parts.join('\n'), nextIndex }
}

function isInsertModeLine(line: string): boolean {
  const compact = compactHumanLine(line).toUpperCase()
  return compact.includes('--INSERT--')
}

function extractInputEntries(line: string): string[] {
  const compact = compactHumanLine(line)
  const entries: string[] = []
  if (/--INSERT--/i.test(compact)) {
    entries.push('INSERT')
  }
  const bypassMatch = compact.match(/bypasspermissions(on|off)/i)
  if (bypassMatch?.[1]) {
    entries.push(`bypass permissions: ${bypassMatch[1].toLowerCase()}`)
  }
  return entries
}

function statusTextFromLine(line: string): string | null {
  if (
    /cerebrat/i.test(line) ||
    /thinking/i.test(line) ||
    /reasoning/i.test(line) ||
    /planning/i.test(line) ||
    /brewing/i.test(line) ||
    /infusing/i.test(line) ||
    /pondering/i.test(line) ||
    /stewing/i.test(line) ||
    /whatchamacallit/i.test(line) ||
    /\/effort/i.test(line) ||
    /^running…?$/i.test(line) ||
    /harmonizing/i.test(line) ||
    /^(?:[·*✳✻✶✢◐]\s*)?[A-Z][A-Za-z]+ing…$/u.test(line) ||
    /\(thought for \d+s\)/i.test(line)
  ) {
    return 'Thinking'
  }
  return null
}

function isToolExecutionLine(line: string): boolean {
  return (
    /^(?:⏺|•)\s*[A-Z][A-Za-z0-9_-]*\(/.test(line) ||
    /^[A-Z][A-Za-z0-9_-]*\(/.test(line) ||
    /\(MCP\)/.test(line) ||
    /^[a-z0-9_-]+\s+-\s+.+\(MCP\)$/i.test(line) ||
    /^gto-agent-bridge\b/i.test(line)
  )
}

function isTerminalBootstrapLine(line: string): boolean {
  return (
    line === '[terminal:running]' ||
    line === '%' ||
    /^\$\s*tool:/i.test(line) ||
    /^[^\s@]+@[^\s]+\s+.+[%#$]\s*(claude|codex|gemini)?$/i.test(line) ||
    /Claude Code v\d/i.test(line) ||
    /^[▐▛▜▌█ ]+Claude Code v\d/i.test(line)
  )
}

function isReplyBoundaryLine(line: string): boolean {
  return (
    !line ||
    isHorizontalRule(line) ||
    line === '❯' ||
    line === '⎿' ||
    normalizedStartsWithTip(line) ||
    isInsertModeLine(line) ||
    isToolExecutionLine(line) ||
    Boolean(statusTextFromLine(line))
  )
}

function normalizedStartsWithTip(line: string): boolean {
  return line.startsWith('⎿') || line.startsWith('Tip:') || line.startsWith('提示:')
}

function collectReplyBlock(lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const parts: string[] = []
  let nextIndex = startIndex

  while (nextIndex < lines.length) {
    const candidate = normalizeHumanLine(lines[nextIndex])
    if (isReplyBoundaryLine(candidate)) {
      break
    }
    if (isNoiseReplyText(candidate)) {
      nextIndex += 1
      if (parts.length > 0) {
        break
      }
      continue
    }
    parts.push(candidate)
    nextIndex += 1
  }

  return { text: parts.join('\n'), nextIndex }
}

function isNoiseReplyText(text: string): boolean {
  const normalized = normalizeHumanLine(text)
  const compact = compactHumanLine(text)
  if (!normalized) {
    return true
  }
  if (isInsertModeLine(normalized)) {
    return true
  }
  if (/^[✢✳✶◐◓◑◒▘▝▖▗.…·]+$/u.test(compact)) {
    return true
  }
  if (/^[A-Za-z]{1,4}$/.test(compact) || /^[A-Za-z]{1,3}…$/.test(compact)) {
    return true
  }
  if (/^[A-Za-z]{1,2}$/.test(compact.replace(/[^A-Za-z]/g, ''))) {
    return true
  }
  if (/^[-/A-Za-z0-9_.]+$/.test(compact) && compact.length <= 4) {
    return true
  }
  if (/^[▘▝▖▗]+/.test(compact)) {
    return true
  }
  if (/^[~./\w-]+(?:\/[~./\w-]+)+$/.test(compact)) {
    return true
  }
  return false
}

export function parseTerminalDebugHumanEntries(value: string): TerminalHumanEntry[] {
  const { text, notices, hasKeyboardModeUpdate } = stripTerminalSequences(value)
  const entries: TerminalHumanEntry[] = []
  const lines = splitNormalizedLines(text)

  let index = 0
  while (index < lines.length) {
    const normalized = normalizeHumanLine(lines[index])
    if (!normalized || isHorizontalRule(normalized) || normalized === '❯' || normalized === '⎿') {
      index += 1
      continue
    }

    if (/^(⏺|•)\s*/.test(normalized)) {
      const firstLine = normalizeHumanLine(normalized.replace(/^(⏺|•)\s*/, ''))
      const { text: trailingText, nextIndex } = collectReplyBlock(lines, index + 1)
      const textValue = [firstLine, trailingText].filter(Boolean).join('\n')
      if (textValue) {
        entries.push({ category: 'reply', text: textValue })
      }
      index = nextIndex
      continue
    }

    if (/^(✻|\*)\s*/.test(normalized)) {
      const status = statusTextFromLine(normalized)
      if (status) {
        entries.push({ category: 'status', text: status })
      }
      index += 1
      continue
    }

    if (normalizedStartsWithTip(normalized)) {
      const firstLine = normalizeHumanLine(normalized.replace(/^⎿\s*/, ''))
      const { text: tipText, nextIndex } = buildTipText([firstLine, ...lines.slice(index + 1)], 0)
      entries.push({ category: 'tip', text: tipText })
      index += nextIndex
      continue
    }

    if (isInsertModeLine(normalized)) {
      for (const inputEntry of extractInputEntries(normalized)) {
        entries.push({ category: 'input', text: inputEntry })
      }
      index += 1
      continue
    }

    const status = statusTextFromLine(normalized)
    if (status) {
      entries.push({ category: 'status', text: status })
      index += 1
      continue
    }

    if (!isToolExecutionLine(normalized)) {
      const { text: replyText, nextIndex } = collectReplyBlock(lines, index)
      if (replyText && !isNoiseReplyText(replyText)) {
        entries.push({ category: 'reply', text: replyText })
        index = nextIndex
        continue
      }
    }

    index += 1
  }

  for (const notice of notices) {
    entries.push({ category: 'notice', text: notice })
  }

  if (entries.length === 0 && hasKeyboardModeUpdate) {
    entries.push({ category: 'system', text: 'Keyboard/input mode update' })
  }

  return entries
}

export function parseTerminalDebugScreenEntries(value: string): TerminalHumanEntry[] {
  const entries: TerminalHumanEntry[] = []
  const lines = splitNormalizedLines(value)
  const replyBlocks: string[] = []
  const inputEntries: string[] = []
  let currentReplyParts: string[] = []
  let latestStatus: string | null = null
  let latestTip: string | null = null

  const flushReplyBlock = () => {
    if (currentReplyParts.length === 0) {
      return
    }
    replyBlocks.push(currentReplyParts.join('\n'))
    currentReplyParts = []
  }

  for (const line of lines) {
    if (!line || isHorizontalRule(line) || line === '❯' || line === '⎿' || isTerminalBootstrapLine(line)) {
      flushReplyBlock()
      continue
    }
    if (isInsertModeLine(line)) {
      flushReplyBlock()
      inputEntries.push(...extractInputEntries(line))
      continue
    }
    if (isToolExecutionLine(line)) {
      flushReplyBlock()
      continue
    }
    const status = statusTextFromLine(line)
    if (status) {
      flushReplyBlock()
      latestStatus = status
      continue
    }
    if (normalizedStartsWithTip(line) || /^Successfully loaded skill$/i.test(line)) {
      flushReplyBlock()
      latestTip = line.replace(/^⎿\s*/, '')
      continue
    }
    if (isNoiseReplyText(line)) {
      flushReplyBlock()
      continue
    }
    currentReplyParts.push(line.replace(/^(⏺|•)\s*/, ''))
  }

  flushReplyBlock()

  const latestReply = replyBlocks.at(-1)
  if (latestReply) {
    entries.push({ category: 'reply', text: latestReply })
  }
  if (latestStatus) {
    entries.push({ category: 'status', text: latestStatus })
  }
  if (latestTip) {
    entries.push({ category: 'tip', text: latestTip })
  }
  for (const inputEntry of inputEntries) {
    entries.push({ category: 'input', text: inputEntry })
  }

  return entries
}
