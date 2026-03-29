import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTerminalHumanLog } from '../src/features/terminal/terminal-human-log.js'
import type { TerminalDebugRecord } from '../src/features/terminal/terminal-debug-model.js'

const baseRecord = {
  stationId: 'station-1',
  sessionId: 'session-1',
  source: 'terminal/output',
} satisfies Partial<TerminalDebugRecord>

test('buildTerminalHumanLog aggregates duplicate xterm redraw content into stable human events', () => {
  const records: TerminalDebugRecord[] = [
    {
      ...baseRecord,
      id: '1',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 11),
      lane: 'xterm',
      kind: 'write',
      summary: 'tip partial',
      body: 'Tip: Did you know you can drag anddrop imagefiles into your',
    },
    {
      ...baseRecord,
      id: '2',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 14),
      lane: 'xterm',
      kind: 'write',
      summary: 'thinking',
      body: '* Cerebrating…',
    },
    {
      ...baseRecord,
      id: '3',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 16),
      lane: 'event',
      kind: 'output',
      summary: 'duplicate event lane reply',
      body: 'Skill(superpowers:using-superpowers)',
    },
    {
      ...baseRecord,
      id: '4',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 16),
      lane: 'xterm',
      kind: 'write',
      summary: 'reply and completed tip',
      body: '• Skill(superpowers:using-superpowers)\nTip: Did you know you can drag and drop image files into your\nterminal?',
    },
    {
      ...baseRecord,
      id: '5',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 22),
      lane: 'xterm',
      kind: 'write',
      summary: 'duplicate reply and tip redraw',
      body: '• Skill(superpowers:using-superpowers)\nTip: Did you know you can drag and drop image files into your\nterminal?',
    },
    {
      ...baseRecord,
      id: '6',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 26),
      lane: 'xterm',
      kind: 'write',
      summary: 'final reply and input state',
      body: '• 现在是 2026-03-28 21:01:23 CST。\n-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
    },
    {
      ...baseRecord,
      id: '7',
      atMs: Date.UTC(2026, 2, 28, 13, 1, 26),
      lane: 'xterm',
      kind: 'write',
      summary: 'final reply redraw',
      body: '• 现在是 2026-03-28 21:01:23 CST。\n-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
    },
  ]

  const log = buildTerminalHumanLog('zh-CN', records)

  assert.equal(log.match(/Skill\(superpowers:using-superpowers\)/g)?.length ?? 0, 1)
  assert.equal(log.match(/现在是 2026-03-28 21:01:23 CST。/g)?.length ?? 0, 1)
  assert.equal(log.match(/正在思考/g)?.length ?? 1, 1)
  assert.equal(log.match(/bypass permissions: on/g)?.length ?? 0, 1)
  assert.match(log, /Tip: Did you know you can drag and drop image files into your\nterminal\?/)
  assert.doesNotMatch(log, /drag anddrop imagefiles/)
})

test('buildTerminalHumanLog prefers backend hydrated rendered screen text over noisy xterm chunks', () => {
  const records: TerminalDebugRecord[] = [
    {
      ...baseRecord,
      id: 'screen-1',
      atMs: Date.UTC(2026, 2, 28, 13, 24, 45),
      lane: 'xterm',
      kind: 'screen',
      source: 'rendered_screen',
      summary: 'rendered screen',
      body:
        '[terminal:running]\n' +
        '%\n' +
        'dzlin@duzenglindeMacBook-Air new-agent % claude\n' +
        '▐▛███▜▌ Claude Code v2.1.86\n' +
        '✳ Infusing…\n' +
        'Skill(superpowers:using-superpowers)\n' +
        'Successfully loaded skill\n' +
        '你好！有什么需要我帮你处理的？\n' +
        '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
      humanText: '你好！有什么需要我帮你处理的？',
    },
    {
      ...baseRecord,
      id: 'write-1',
      atMs: Date.UTC(2026, 2, 28, 13, 24, 36),
      lane: 'xterm',
      kind: 'write',
      source: 'append',
      summary: 'noisy redraw',
      body: '✢\n✳\n✶\nS\nti\nen\nwg\ni…\n--INSERT--⏵⏵bypasspermissionson (shift+tabtocycle)',
    },
  ]

  const log = buildTerminalHumanLog('zh-CN', records)

  assert.match(log, /你好！有什么需要我帮你处理的？/)
  assert.doesNotMatch(
    log,
    /正在思考|Successfully loaded skill|INSERT|bypass permissions|\[terminal:running\]|Claude Code v2\.1\.86|Skill\(superpowers:using-superpowers\)|✳ Infusing…|% claude/,
  )
})

test('buildTerminalHumanLog uses backend extracted human text for Claude screen records', () => {
  const records = [
    {
      ...baseRecord,
      id: 'screen-human-1',
      atMs: Date.UTC(2026, 2, 28, 14, 2, 8),
      lane: 'xterm',
      kind: 'screen',
      source: 'rendered_screen',
      summary: 'claude rendered screen',
      body:
        '[terminal:running]\n' +
        '%\n' +
        'dzlin@duzenglindeMacBook-Air new-agent % claude\n' +
        '▐▛███▜▌ Claude Code v2.1.86\n' +
        '✳ Infusing…\n' +
        'Successfully loaded skill\n' +
        '● 我已经定位到问题根因了。\n' +
        '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
      humanText: '● 我已经定位到问题根因了。',
    },
    {
      ...baseRecord,
      id: 'screen-human-2',
      atMs: Date.UTC(2026, 2, 28, 14, 2, 10),
      lane: 'xterm',
      kind: 'screen',
      source: 'rendered_screen',
      summary: 'claude rendered screen redraw',
      body:
        '[terminal:running]\n' +
        '%\n' +
        'dzlin@duzenglindeMacBook-Air new-agent % claude\n' +
        '✻ Worked for 12s\n' +
        '● 我已经定位到问题根因了。\n' +
        '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
      humanText: '● 我已经定位到问题根因了。',
    },
  ] as unknown as TerminalDebugRecord[]

  const log = buildTerminalHumanLog('zh-CN', records)

  assert.equal(log.match(/我已经定位到问题根因了。/g)?.length ?? 0, 1)
  assert.doesNotMatch(log, /正在思考|Successfully loaded skill|INSERT|bypass permissions/)
})
