import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const designerGraphCanvasTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerGraphCanvas.tsx'),
  'utf8',
)
const businessDesignerScss = readFileSync(
  resolve(testDir, '../../src/features/business-designer/BusinessDesignerPane.scss'),
  'utf8',
)

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function blockFor(selector: string, { allowIndent = false } = {}): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const indent = allowIndent ? '\\s*' : ''
  const match = new RegExp(`(^|\\n)${indent}${escapedSelector}\\s*\\{`).exec(businessDesignerScss)
  assert.ok(match, `${selector} should exist`)
  const start = match.index + match[1].length

  const open = businessDesignerScss.indexOf('{', start)
  assert.notEqual(open, -1, `${selector} should have a declaration block`)

  let depth = 0
  for (let index = open; index < businessDesignerScss.length; index += 1) {
    const char = businessDesignerScss[index]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) {
      return businessDesignerScss.slice(start, index + 1)
    }
  }

  assert.fail(`${selector} declaration block should close`)
}

function callbackBlock(name: string): string {
  const marker = `const ${name} = useCallback(`
  const start = designerGraphCanvasTsx.indexOf(marker)
  assert.notEqual(start, -1, `${name} callback should exist`)
  const nextCallback = designerGraphCanvasTsx.indexOf('\n  const ', start + marker.length)
  const end = nextCallback === -1 ? designerGraphCanvasTsx.length : nextCallback
  return designerGraphCanvasTsx.slice(start, end)
}

test('business designer node separates coordinate transform from hover visuals', () => {
  const panMoveBlock = callbackBlock('handleViewportPointerMove')

  assert.match(
    designerGraphCanvasTsx,
    /const shellClassName = \['designer-node-shell', stateClassName\]\.filter\(Boolean\)\.join\(' '\)/,
  )
  assert.match(
    designerGraphCanvasTsx,
    /className=\{shellClassName\}[\s\S]*?left: node\.position\.x,[\s\S]*?top: node\.position\.y,/,
  )
  assert.match(designerGraphCanvasTsx, /if \(zoom !== 1\) \{[\s\S]*?wrapperStyle\.transform = `scale\(\$\{zoom\}\)`/)
  assert.doesNotMatch(designerGraphCanvasTsx, /transform: `scale\(\$\{zoom\}\)`/)
  assert.match(designerGraphCanvasTsx, /node\.style\.transform = `translate3d\(\$\{dx\}px, \$\{dy\}px, 0\)`/)
  assert.match(designerGraphCanvasTsx, /node\.style\.transform = ''/)
  assert.doesNotMatch(designerGraphCanvasTsx, /node\.style\.left =/)
  assert.doesNotMatch(designerGraphCanvasTsx, /node\.style\.top =/)
  assert.match(designerGraphCanvasTsx, /<div className=\{nodeClassName\}>/)
  assert.match(designerGraphCanvasTsx, /const viewport = viewportRef\.current[\s\S]*?if \(!viewport\) return/)
  assert.match(designerGraphCanvasTsx, /!viewport\.contains\(target\)/)
  assert.match(designerGraphCanvasTsx, /tabIndex=\{-1\}/)
  assert.match(designerGraphCanvasTsx, /const isCanvasChrome = target\.closest\(/)
  assert.match(designerGraphCanvasTsx, /const isEditableTarget = target\.closest\('input, textarea, select, \[contenteditable="true"\]'\)/)
  assert.match(designerGraphCanvasTsx, /if \(!isCanvasChrome && !isEditableTarget\) \{[\s\S]*?viewportRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(designerGraphCanvasTsx, /const handleCanvasContextMenu = useCallback\(/)
  assert.match(designerGraphCanvasTsx, /const nodeShell = \(event\.target as HTMLElement\)\.closest<HTMLElement>\('\.designer-node-shell'\)/)
  assert.match(designerGraphCanvasTsx, /event\.preventDefault\(\)[\s\S]*?if \(nodeShell\) \{/)
  assert.match(designerGraphCanvasTsx, /const blockId = nodeShell\.dataset\.blockId/)
  assert.match(designerGraphCanvasTsx, /onSelectBlock\(blockId\)/)
  assert.match(designerGraphCanvasTsx, /setCreateMenu\(null\)[\s\S]*?return/)
  assert.match(designerGraphCanvasTsx, /data-block-id=\{node\.block\.id\}/)
  assert.match(designerGraphCanvasTsx, /const createMenuRef = useRef<HTMLDivElement \| null>\(null\)/)
  assert.match(designerGraphCanvasTsx, /querySelector<HTMLButtonElement>\('\.designer-canvas-create-menu-item'\)[\s\S]*?\.focus\(\)/)
  assert.match(designerGraphCanvasTsx, /const handleCreateMenuKeyDown = useCallback\(\(event: ReactKeyboardEvent<HTMLDivElement>\) => \{/)
  assert.match(designerGraphCanvasTsx, /event\.key !== 'ArrowDown'[\s\S]*?event\.key !== 'ArrowUp'[\s\S]*?event\.key !== 'Home'[\s\S]*?event\.key !== 'End'[\s\S]*?event\.key !== 'Escape'/)
  assert.match(designerGraphCanvasTsx, /if \(event\.key === 'Escape'\) \{[\s\S]*?setCreateMenu\(null\)[\s\S]*?viewportRef\.current\?\.focus\(\{ preventScroll: true \}\)/)
  assert.match(designerGraphCanvasTsx, /querySelectorAll<HTMLButtonElement>\([\s\S]*?'\.designer-canvas-create-menu-item'/)
  assert.match(designerGraphCanvasTsx, /buttons\[nextIndex\]\?\.focus\(\)/)
  assert.match(designerGraphCanvasTsx, /ref=\{createMenuRef\}[\s\S]*?onKeyDown=\{handleCreateMenuKeyDown\}/)
  assert.match(designerGraphCanvasTsx, /event\.code !== 'Space'/)
  assert.match(designerGraphCanvasTsx, /element\.tagName === 'TEXTAREA'/)
  assert.match(designerGraphCanvasTsx, /target\?\.closest\('\.designer-node-shell'\)/)
  assert.match(designerGraphCanvasTsx, /className=\{`designer-canvas-viewport\$\{spacePanArmed \? ' is-space-pan-armed' : ''\}`\}/)
  assert.match(designerGraphCanvasTsx, /viewport\.scrollLeft = state\.startScrollLeft - \(event\.clientX - state\.startPointerX\)/)
  assert.match(designerGraphCanvasTsx, /viewport\.scrollTop = state\.startScrollTop - \(event\.clientY - state\.startPointerY\)/)
  assert.doesNotMatch(panMoveBlock, /onMoveBlock/)
  assert.match(designerGraphCanvasTsx, /onFocus=\{\(\) => onSelectBlock\(node\.block\.id\)\}/)
  assert.match(designerGraphCanvasTsx, /const handleKeyDown = \(event: ReactKeyboardEvent<HTMLDivElement>\) => \{[\s\S]*?event\.key !== 'Enter'[\s\S]*?onDoubleClick\(\)/)
  assert.match(designerGraphCanvasTsx, /onKeyDown=\{handleKeyDown\}/)
  assert.match(designerGraphCanvasTsx, /role="button"[\s\S]*?tabIndex=\{0\}/)

  const shellBlock = blockFor('.designer-node-shell')
  const nodeBlock = blockFor('.designer-node')
  const paneBlock = blockFor('.business-designer-pane')
  const viewportBlock = blockFor('.designer-canvas-viewport')
  const hoverBlock = blockFor('.designer-node-shell:hover > .designer-node::before')

  assert.match(paneBlock, /transform:\s*none;/)
  assert.match(paneBlock, /backface-visibility:\s*visible;/)
  assert.match(paneBlock, /-webkit-touch-callout:\s*none;/)
  assert.match(paneBlock, /user-select:\s*none;/)
  assert.match(paneBlock, /input,\s*[\s\S]*?textarea,\s*[\s\S]*?select,[\s\S]*?user-select:\s*text;/)
  assert.match(shellBlock, /position:\s*absolute;/)
  assert.match(shellBlock, /pointer-events:\s*auto;/)
  assert.match(shellBlock, /will-change:\s*transform;/)
  assert.match(nodeBlock, /pointer-events:\s*none;/)
  assert.match(nodeBlock, /overflow:\s*hidden;/)
  assert.match(nodeBlock, /&::before\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?\}/)
  assert.match(viewportBlock, /&\.is-space-pan-armed,[\s\S]*?&\.is-panning\s*\{[\s\S]*?cursor:\s*grab;/)
  assert.match(viewportBlock, /&\.is-panning\s*\{[\s\S]*?cursor:\s*grabbing;[\s\S]*?user-select:\s*none;/)
  assert.doesNotMatch(hoverBlock, /transform\s*:/)
  assert.doesNotMatch(hoverBlock, /background\s*:/)
  assert.match(hoverBlock, /opacity:\s*1;/)
})

test('business designer native-feel stylesheet avoids web UI tells', () => {
  const scssWithoutComments = stripComments(businessDesignerScss)

  assert.doesNotMatch(scssWithoutComments, /cursor:\s*pointer/)
  assert.doesNotMatch(scssWithoutComments, /cursor-pointer/)
  assert.doesNotMatch(scssWithoutComments, /behavior:\s*['"]smooth['"]/)
  assert.doesNotMatch(scssWithoutComments, /scroll-behavior:\s*smooth/)
  assert.doesNotMatch(scssWithoutComments, /::view-transition/)
  assert.doesNotMatch(scssWithoutComments, /view-transition/)
  assert.doesNotMatch(scssWithoutComments, /\bskeleton\b/i)
  assert.doesNotMatch(scssWithoutComments, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(scssWithoutComments, /\brgba?\(/)
  assert.doesNotMatch(scssWithoutComments, /\bhsla?\(/)

  const sidebarPanel = blockFor('.designer-sidebar-panel')
  const mainPanel = blockFor('.designer-main')
  const linuxOverride = blockFor(":root[data-vb-platform='linux']")
  const allowedBackdropBlocks = [sidebarPanel, mainPanel, linuxOverride].join('\n')
  const withoutAllowedBackdropBlocks = scssWithoutComments
    .replace(sidebarPanel, '')
    .replace(mainPanel, '')
    .replace(linuxOverride, '')

  assert.match(sidebarPanel, /backdrop-filter:\s*blur/)
  assert.match(sidebarPanel, /-webkit-backdrop-filter:\s*blur/)
  assert.match(mainPanel, /backdrop-filter:\s*blur/)
  assert.match(mainPanel, /-webkit-backdrop-filter:\s*blur/)
  assert.match(linuxOverride, /backdrop-filter:\s*none/)
  assert.match(linuxOverride, /-webkit-backdrop-filter:\s*none/)
  assert.doesNotMatch(withoutAllowedBackdropBlocks, /backdrop-filter:/)
  assert.doesNotMatch(allowedBackdropBlocks, /modal|overlay|dialog/)

  assert.match(scssWithoutComments, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
})

test('business designer buttons keep native pressed states by control kind', () => {
  const toolButton = blockFor('.designer-tool-button')
  const iconButton = blockFor('.designer-icon-button')
  const historyModeOption = blockFor('.designer-history-mode-option')
  const briefSelectionAction = blockFor('.designer-brief-selection-action')
  const createConfirm = blockFor('.designer-create-confirm')
  const drillAddRow = blockFor('.designer-drill-add-row')
  const nodeDelete = blockFor('.designer-node-delete-btn')

  assert.match(toolButton, /&:not\(:disabled\):hover\s*\{[\s\S]*?var\(--vb-hover-overlay\)/)
  assert.match(toolButton, /&:not\(:disabled\):active\s*\{[\s\S]*?var\(--vb-active-overlay\)[\s\S]*?transform:\s*scale/)
  assert.match(iconButton, /&:not\(:disabled\):hover\s*\{[\s\S]*?var\(--vb-hover-overlay\)/)
  assert.match(iconButton, /&:not\(:disabled\):active\s*\{[\s\S]*?var\(--vb-active-overlay\)[\s\S]*?transform:\s*scale/)
  assert.match(historyModeOption, /&:hover\s*\{[\s\S]*?color:\s*var\(--vb-text\)/)
  assert.match(historyModeOption, /&:active\s*\{[\s\S]*?var\(--vb-active-overlay\)[\s\S]*?transform:\s*scale/)
  assert.match(briefSelectionAction, /&:not\(:disabled\):active\s*\{[\s\S]*?var\(--vb-active-overlay\)[\s\S]*?transform:\s*scale/)
  assert.match(createConfirm, /align-self:\s*flex-end;/)
  assert.doesNotMatch(createConfirm, /background:/)
  assert.doesNotMatch(createConfirm, /&:disabled/)
  assert.doesNotMatch(createConfirm, /&:not\(:disabled\):active/)
  assert.match(drillAddRow, /&:not\(:disabled\):active\s*\{[\s\S]*?transform:\s*scale/)
  assert.match(nodeDelete, /background:\s*var\(--designer-danger-bg\)/)
  assert.match(nodeDelete, /color:\s*var\(--designer-danger\)/)
  assert.doesNotMatch(businessDesignerScss, /designer-node-shell:hover \.designer-node-delete-btn/)
  assert.doesNotMatch(businessDesignerScss, /designer-node-shell:focus-within \.designer-node-delete-btn/)
  assert.doesNotMatch(businessDesignerScss, /designer-node-shell\.is-selected \.designer-node-delete-btn/)
})
