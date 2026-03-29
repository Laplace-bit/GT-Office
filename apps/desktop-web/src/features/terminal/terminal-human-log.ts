import type { TerminalDebugRecord } from './terminal-debug-model.js'
import { parseTerminalDebugHumanEntries } from './terminal-vt-parser.js'

interface HumanEvent {
  atMs: number
  category: string
  text: string
}

export type TerminalHumanLocale = 'zh-CN' | 'en-US'

function textForLocale(locale: TerminalHumanLocale, zhCN: string, enUS: string): string {
  return locale === 'zh-CN' ? zhCN : enUS
}

function formatDebugTime(locale: TerminalHumanLocale, atMs: number): string {
  return new Date(atMs).toLocaleTimeString(locale, {
    hour12: false,
  })
}

function humanCategoryLabel(locale: TerminalHumanLocale, category: string): string {
  switch (category) {
    case 'reply':
      return textForLocale(locale, '回复', 'Reply')
    case 'status':
      return textForLocale(locale, '状态', 'Status')
    case 'tip':
      return textForLocale(locale, '提示', 'Tip')
    case 'input':
      return textForLocale(locale, '输入状态', 'Input')
    case 'notice':
      return textForLocale(locale, '通知', 'Notice')
    default:
      return textForLocale(locale, '系统', 'System')
  }
}

function humanText(locale: TerminalHumanLocale, category: string, text: string): string {
  if (category === 'status' && text === 'Thinking') {
    return textForLocale(locale, '正在思考', 'Thinking')
  }
  if (category === 'system' && text === 'Keyboard/input mode update') {
    return textForLocale(locale, '输入/键盘模式更新', 'Keyboard/input mode update')
  }
  if (category === 'notice' && /waiting for your input/i.test(text)) {
    return textForLocale(locale, 'Claude 正在等待你的输入', 'Claude is waiting for your input')
  }
  return text
}

function buildInputText(parts: string[]): string {
  const mode = parts.find((part) => /^[A-Z]+$/.test(part))
  const bypass = parts.find((part) => part.startsWith('bypass permissions:'))
  if (mode && bypass) {
    return `${mode}\n${bypass}`
  }
  return parts.join('\n')
}

function shouldUseHumanRecord(records: TerminalDebugRecord[], record: TerminalDebugRecord): boolean {
  if (records.some((item) => item.kind === 'screen')) {
    return record.kind === 'screen'
  }
  if (records.some((item) => item.lane === 'xterm')) {
    return record.lane === 'xterm'
  }
  return record.lane === 'event'
}

function looksIncomplete(text: string): boolean {
  return !/[.!?。？！)]$/.test(text.trim())
}

function mergeHumanEventText(category: string, previous: string, next: string): string | null {
  if (previous === next) {
    return previous
  }
  if (next.startsWith(previous) && next.length > previous.length) {
    return next
  }
  if (previous.startsWith(next) && previous.length > next.length) {
    return previous
  }
  if ((category === 'tip' || category === 'reply') && looksIncomplete(previous) && next.length > previous.length) {
    return next
  }
  return null
}

export function buildTerminalHumanLog(locale: TerminalHumanLocale, records: TerminalDebugRecord[]): string {
  const events: HumanEvent[] = []
  const lastTextBySession = new Map<string, Map<string, string>>()
  const lastIndexBySession = new Map<string, Map<string, number>>()

  for (const record of records) {
    if (!shouldUseHumanRecord(records, record)) {
      continue
    }

    const sessionKey = record.sessionId ?? `station:${record.stationId}`
    const parsedEntries =
      record.kind === 'screen'
        ? record.humanText
          ? [{ category: 'reply', text: record.humanText }]
          : []
        : parseTerminalDebugHumanEntries(record.body)
    const inputParts = parsedEntries
      .filter((entry) => entry.category === 'input')
      .map((entry) => humanText(locale, entry.category, entry.text))
    const entries = parsedEntries
      .filter((entry) => entry.category !== 'input')
      .map((entry) => ({
        category: entry.category,
        text: humanText(locale, entry.category, entry.text),
      }))

    if (inputParts.length > 0) {
      entries.push({
        category: 'input',
        text: buildInputText(inputParts),
      })
    }

    let sessionTexts = lastTextBySession.get(sessionKey)
    if (!sessionTexts) {
      sessionTexts = new Map<string, string>()
      lastTextBySession.set(sessionKey, sessionTexts)
    }
    let sessionIndexes = lastIndexBySession.get(sessionKey)
    if (!sessionIndexes) {
      sessionIndexes = new Map<string, number>()
      lastIndexBySession.set(sessionKey, sessionIndexes)
    }

    for (const entry of entries) {
      const previousText = sessionTexts.get(entry.category)
      const previousIndex = sessionIndexes.get(entry.category)
      if (previousText === entry.text) {
        continue
      }

      if (previousText && previousIndex !== undefined) {
        const merged = mergeHumanEventText(entry.category, previousText, entry.text)
        if (merged) {
          if (merged === previousText) {
            continue
          }
          events[previousIndex] = {
            ...events[previousIndex],
            atMs: record.atMs,
            text: merged,
          }
          sessionTexts.set(entry.category, merged)
          continue
        }
      }

      events.push({
        atMs: record.atMs,
        category: entry.category,
        text: entry.text,
      })
      sessionTexts.set(entry.category, entry.text)
      sessionIndexes.set(entry.category, events.length - 1)
    }
  }

  const lines: string[] = []
  for (const event of events) {
    lines.push(`[${formatDebugTime(locale, event.atMs)}] ${humanCategoryLabel(locale, event.category)}`)
    lines.push(event.text)
    lines.push('')
  }

  return lines.join('\n').trim()
}
