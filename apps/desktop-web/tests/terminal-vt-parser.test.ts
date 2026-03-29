import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTerminalDebugBody,
  parseTerminalDebugHumanEntries,
  parseTerminalDebugScreenEntries,
} from '../src/features/terminal/terminal-vt-parser.js'

test('parseTerminalDebugBody translates common OSC and CSI sequences into readable operations', () => {
  const parsed = parseTerminalDebugBody(
    '\\x1b]0;✳ Initial greeting\\x07\\x1b[38;2;255;255;255mHi\\x1b[39m\\x1b[2D\\x1b[3B\\x1b[?2026h\\x1b[?2026l',
  )

  assert.match(parsed, /OSC 0: Set window title -> ✳ Initial greeting/)
  assert.match(parsed, /SGR: Set foreground RGB\(255,255,255\)/)
  assert.match(parsed, /TEXT: Hi/)
  assert.match(parsed, /CSI 2D: Cursor backward 2/)
  assert.match(parsed, /CSI 3B: Cursor down 3/)
  assert.match(parsed, /DECSET 2026: Enable synchronized output/)
  assert.match(parsed, /DECRST 2026: Disable synchronized output/)
})

test('parseTerminalDebugBody recognizes insert mode and line erase operations', () => {
  const parsed = parseTerminalDebugBody('\\x1b[7m \\x1b[27m\\x1b[2K\\x1b[G')

  assert.match(parsed, /SGR: Enable inverse video/)
  assert.match(parsed, /TEXT:  /)
  assert.match(parsed, /SGR: Disable inverse video/)
  assert.match(parsed, /CSI 2K: Erase entire line/)
  assert.match(parsed, /CSI G: Cursor horizontal absolute 1/)
})

test('parseTerminalDebugHumanEntries extracts human-readable Claude content', () => {
  const entries = parseTerminalDebugHumanEntries(
    '\\x1b[38;2;255;255;255m⏺\\x1b[1C\\x1b[39m你好。\\n' +
      '\\x1b[38;2;215;119;87m*\\x1b[1CCerebrating…\\x1b[39m\\n' +
      '\\x1b[38;2;153;153;153m  ⎿  Tip: Use Plan Mode to prepare for a complex request before \\n' +
      '     making changes. Press shift+tab twice to enable.\\n' +
      '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)\\n' +
      '\\x1b]777;notify;Claude Code;Claude is waiting for your input\\x07',
  )

  assert.deepEqual(entries, [
    { category: 'reply', text: '你好。' },
    { category: 'status', text: 'Thinking' },
    {
      category: 'tip',
      text: 'Tip: Use Plan Mode to prepare for a complex request before\nmaking changes. Press shift+tab twice to enable.',
    },
    { category: 'input', text: 'INSERT' },
    { category: 'input', text: 'bypass permissions: on' },
    { category: 'notice', text: 'Claude is waiting for your input' },
  ])
})

test('parseTerminalDebugHumanEntries falls back to system entry for keyboard mode updates', () => {
  const entries = parseTerminalDebugHumanEntries('\\x1b[<u\\x1b[>1u\\x1b[>4;2m\\x1b[?2026h\\x1b[?2026l')

  assert.deepEqual(entries, [{ category: 'system', text: 'Keyboard/input mode update' }])
})

test('parseTerminalDebugHumanEntries keeps multiline assistant body and list items', () => {
  const entries = parseTerminalDebugHumanEntries(
    '\\x1b[38;2;255;255;255m⏺\\x1b[1C有，当前在线 2 个：\\n' +
      '  - 研究员（当前这个 agent）\\n' +
      '- 测试\\n' +
      '  两者状态都是 ready。\\n' +
      '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
  )

  assert.deepEqual(entries, [
    {
      category: 'reply',
      text: '有，当前在线 2 个：\n- 研究员（当前这个 agent）\n- 测试\n两者状态都是 ready。',
    },
    { category: 'input', text: 'INSERT' },
    { category: 'input', text: 'bypass permissions: on' },
  ])
})

test('parseTerminalDebugHumanEntries ignores tool execution rows while keeping real reply text', () => {
  const entries = parseTerminalDebugHumanEntries(
    'Skill(superpowers:using-superpowers)\\n' +
      'gto-agent-bridge - gto_health (MCP)\\n' +
      '如果你要，我可以直接给另一个 agent 发消息。\\n' +
      '✢ Pondering…',
  )

  assert.deepEqual(entries, [
    { category: 'reply', text: '如果你要，我可以直接给另一个 agent 发消息。' },
    { category: 'status', text: 'Thinking' },
  ])
})

test('parseTerminalDebugHumanEntries drops redraw fragments and keeps meaningful content', () => {
  const entries = parseTerminalDebugHumanEntries(
    '你好你好\\n' +
      '--INSERT--⏵⏵bypasspermissionson (shift+tabtocycle)\\n' +
      '◐medium·/effort\\n' +
      '✢\\n' +
      '✳\\n' +
      '✶\\n' +
      'S\\n' +
      'ti\\n' +
      'en\\n' +
      'wg\\n' +
      'i…\\n' +
      'Successfully loadedskill\\n' +
      '✢Stewing…\\n' +
      '你好！有什么需要我帮你处理的？\\n' +
      '▘▘▝▝~/work/project/.gtoffice/org/custom/new-agent',
  )

  assert.deepEqual(entries, [
    { category: 'reply', text: '你好你好' },
    { category: 'input', text: 'INSERT' },
    { category: 'input', text: 'bypass permissions: on' },
    { category: 'status', text: 'Thinking' },
    { category: 'reply', text: 'Successfully loadedskill' },
    { category: 'status', text: 'Thinking' },
    { category: 'reply', text: '你好！有什么需要我帮你处理的？' },
  ])
})

test('parseTerminalDebugScreenEntries keeps only meaningful Claude screen content', () => {
  const entries = parseTerminalDebugScreenEntries(
    '[terminal:running]\n' +
      '%\n' +
      'dzlin@duzenglindeMacBook-Air new-agent % claude\n' +
      '▐▛███▜▌ Claude Code v2.1.86\n' +
      '✳ Infusing…\n' +
      'Skill(superpowers:using-superpowers)\n' +
      'Successfully loaded skill\n' +
      '你好，有什么我可以帮你的？\n' +
      '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
  )

  assert.deepEqual(entries, [
    { category: 'reply', text: '你好，有什么我可以帮你的？' },
    { category: 'status', text: 'Thinking' },
    { category: 'tip', text: 'Successfully loaded skill' },
    { category: 'input', text: 'INSERT' },
    { category: 'input', text: 'bypass permissions: on' },
  ])
})

test('parseTerminalDebugScreenEntries keeps only meaningful Codex screen content', () => {
  const entries = parseTerminalDebugScreenEntries(
    '$ tool: codex cli\n' +
      '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)\n' +
      '· Harmonizing…\n' +
      '✳ Harmonizing…\n' +
      '✻ Harmonizing…\n' +
      '⏺ Skill(superpowers:using-superpowers)\n' +
      'Successfully loaded skill\n' +
      '⏺ 你好你好，有什么我可以帮你处理的？',
  )

  assert.deepEqual(entries, [
    { category: 'reply', text: '你好你好，有什么我可以帮你处理的？' },
    { category: 'status', text: 'Thinking' },
    { category: 'tip', text: 'Successfully loaded skill' },
    { category: 'input', text: 'INSERT' },
    { category: 'input', text: 'bypass permissions: on' },
  ])
})
