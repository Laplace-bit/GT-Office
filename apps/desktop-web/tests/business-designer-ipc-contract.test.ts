import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const controllerTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/controllers/useDesignerDocumentState.ts'),
  'utf8',
)
const historyControllerTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/controllers/useDesignerHistory.ts'),
  'utf8',
)
const freeformControllerTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/controllers/useDesignerFreeformCompletion.ts'),
  'utf8',
)
const ipcTraceTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/controllers/designerIpcTrace.ts'),
  'utf8',
)
const paneTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/BusinessDesignerPane.tsx'),
  'utf8',
)
const toolbarTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerToolbar.tsx'),
  'utf8',
)
const sidebarTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerSidebar.tsx'),
  'utf8',
)
const graphCanvasTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerGraphCanvas.tsx'),
  'utf8',
)
const drillSheetTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerBlockDrillSheet.tsx'),
  'utf8',
)
const patchSheetTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerPatchSheet.tsx'),
  'utf8',
)
const historySheetTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerHistorySheet.tsx'),
  'utf8',
)
const statusbarTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerStatusbar.tsx'),
  'utf8',
)
const inspectorTsx = readFileSync(
  resolve(testDir, '../../src/features/business-designer/components/DesignerInspector.tsx'),
  'utf8',
)
const designerPatchTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/model/designer-patch.ts'),
  'utf8',
)
const designerFreeformCompletionTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/model/designer-freeform-completion.ts'),
  'utf8',
)
const designerValidationTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/model/designer-validation.ts'),
  'utf8',
)
const designerGraphTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/model/designer-graph.ts'),
  'utf8',
)
const designerBlockLabelsTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/model/designer-block-labels.ts'),
  'utf8',
)
const desktopApiTs = readFileSync(
  resolve(testDir, '../../src/shell/integration/desktop-api.ts'),
  'utf8',
)
const designerDesktopApiTs = readFileSync(
  resolve(testDir, '../../src/features/business-designer/controllers/designerDesktopApi.ts'),
  'utf8',
)
const sharedTypesTs = readFileSync(
  resolve(testDir, '../../../../packages/shared-types/src/business-designer.ts'),
  'utf8',
)
const tauriLibRs = readFileSync(
  resolve(testDir, '../../../../apps/desktop-tauri/src-tauri/src/lib.rs'),
  'utf8',
)
const tauriBusinessDesignerRs = readFileSync(
  resolve(testDir, '../../../../apps/desktop-tauri/src-tauri/src/commands/business_designer/mod.rs'),
  'utf8',
)
const designerScss = readFileSync(
  resolve(testDir, '../../src/features/business-designer/BusinessDesignerPane.scss'),
  'utf8',
)
const appIconsTsx = readFileSync(resolve(testDir, '../../src/shell/ui/icons.tsx'), 'utf8')
const messagesTs = readFileSync(resolve(testDir, '../../src/shell/i18n/messages.ts'), 'utf8')

function functionBlock(name: string): string {
  const match = new RegExp(`const ${name} = useCallback\\(`).exec(controllerTs)
  assert.ok(match, `${name} callback should exist`)
  const start = match.index
  const nextCallback = controllerTs.indexOf('\n  const ', start + 1)
  const end = nextCallback === -1 ? controllerTs.length : nextCallback
  return controllerTs.slice(start, end)
}

function exportedFunctionBlock(source: string, name: string): string {
  const marker = `export function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} export should exist`)
  const nextExport = source.indexOf('\nexport function ', start + marker.length)
  const end = nextExport === -1 ? source.length : nextExport
  return source.slice(start, end)
}

function localFunctionBlock(source: string, name: string): string {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} function should exist`)
  const nextFunction = source.indexOf('\nfunction ', start + marker.length)
  const end = nextFunction === -1 ? source.length : nextFunction
  return source.slice(start, end)
}

function interfaceBlock(source: string, name: string): string {
  const exportMarker = `export interface ${name} {`
  const localMarker = `interface ${name} {`
  const marker = source.includes(exportMarker) ? exportMarker : localMarker
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${name} interface should exist`)
  const nextInterface = source.indexOf('\nexport interface ', start + marker.length)
  const nextLocalInterface = source.indexOf('\ninterface ', start + marker.length)
  const nextType = source.indexOf('\nexport type ', start + marker.length)
  const endCandidates = [nextInterface, nextLocalInterface, nextType]
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)
  const end = endCandidates[0] ?? source.length
  return source.slice(start, end)
}

test('business designer autosave IPC is debounced and save owns validation', () => {
  assert.match(controllerTs, /const DESIGNER_AUTOSAVE_DEBOUNCE_MS = 1500/)
  assert.match(
    controllerTs,
    /window\.setTimeout\(\(\) => \{[\s\S]*?void save\(\)[\s\S]*?\}, DESIGNER_AUTOSAVE_DEBOUNCE_MS\)/,
  )

  const saveBlock = functionBlock('save')
  assert.match(saveBlock, /traceDesignerIpc\('business_designer\.save_document'/)
  assert.match(saveBlock, /traceDesignerIpc\('business_designer\.validate_document\.after_save'/)
})

test('business designer IPC tracing is shared across document and history commands', () => {
  assert.match(ipcTraceTs, /export function traceDesignerIpc/)
  assert.match(ipcTraceTs, /export function nextDesignerIpcTraceId\(\): string/)
  assert.match(ipcTraceTs, /return `designer-ipc-\$\{\+\+designerIpcTraceSequence\}`/)
  assert.match(ipcTraceTs, /run\(traceId\)/)
  assert.match(ipcTraceTs, /console\.warn\('designer\.ipc\.frequency'/)
  assert.match(ipcTraceTs, /console\.debug\('designer\.ipc'/)
  assert.match(controllerTs, /import \{ traceDesignerIpc \} from '\.\/designerIpcTrace'/)
  assert.doesNotMatch(controllerTs, /function traceDesignerIpc<T>/)
  assert.match(historyControllerTs, /import \{ traceDesignerIpc \} from '\.\/designerIpcTrace'/)
  assert.match(historyControllerTs, /traceDesignerIpc\('business_designer\.list_checkpoints\.history'/)
  assert.match(historyControllerTs, /traceDesignerIpc\('business_designer\.compare_checkpoints\.history'/)
  assert.match(historyControllerTs, /traceDesignerIpc\('business_designer\.diff_checkpoint\.history'/)

  assert.match(controllerTs, /readDesignerDocument\(workspaceId, selectedDocumentId, traceId\)/)
  assert.match(controllerTs, /saveDesignerDocument\(workspaceId, detail, traceId\)/)
  assert.match(controllerTs, /validateDesignerDocument\(workspaceId, ready\.manifest\.documentId, traceId\)/)
  assert.match(controllerTs, /validateDesignerDocument\(workspaceId, detail\.manifest\.documentId, traceId\)/)
  assert.match(controllerTs, /compileDesignerDocument\(workspaceId, detail\.manifest\.documentId, traceId\)/)
  assert.match(controllerTs, /createDesignerCheckpoint\([\s\S]*?message\.trim\(\) \|\| detail\.manifest\.title,[\s\S]*?traceId,/)
  assert.match(controllerTs, /saveDesignerDocument\(workspaceId, detailRef\.current!, traceId\)/)
  assert.match(controllerTs, /validateDesignerDocument\(workspaceId, result\.documentId, traceId\)/)
  assert.match(controllerTs, /exportDesignerDocumentToFile\([\s\S]*?format,[\s\S]*?traceId,/)
  assert.match(historyControllerTs, /listDesignerCheckpoints\(workspaceId, documentId, traceId\)/)
  assert.match(historyControllerTs, /compareDesignerCheckpoints\(workspaceId, documentId, baseCommit, headCommit, traceId\)/)
  assert.match(historyControllerTs, /diffDesignerWorkingTree\(workspaceId, documentId, baseCommit, traceId\)/)
  assert.match(desktopApiTs, /businessDesignerReadDocument\(workspaceId: string, documentId: string, traceId\?: string\)[\s\S]*?traceId,/)
  assert.match(desktopApiTs, /businessDesignerSaveDocument\(workspaceId: string, detail: BusinessDesignerDocumentDetail, traceId\?: string\)[\s\S]*?traceId,/)
  assert.match(desktopApiTs, /businessDesignerValidateDocument\(workspaceId: string, documentId: string, traceId\?: string\)[\s\S]*?traceId,/)
  assert.match(desktopApiTs, /businessDesignerListCheckpoints\([\s\S]*?traceId\?: string,[\s\S]*?traceId,/)
})

test('business designer edit and drag hot paths stay local until debounce', () => {
  const updateBlock = functionBlock('updateBlock')
  const setBlockPosition = functionBlock('setBlockPosition')

  for (const block of [updateBlock, setBlockPosition]) {
    assert.match(block, /setDirty\(true\)/)
    assert.doesNotMatch(block, /saveDesignerDocument/)
    assert.doesNotMatch(block, /validateDesignerDocument/)
    assert.doesNotMatch(block, /traceDesignerIpc/)
  }

  assert.match(graphCanvasTsx, /node\.style\.transform = `translate3d\(\$\{dx\}px, \$\{dy\}px, 0\)`/)
  assert.match(graphCanvasTsx, /onMoveBlock\(state\.blockId, finalPosition\)/)
  assert.doesNotMatch(graphCanvasTsx, /node\.style\.left =/)
  assert.doesNotMatch(graphCanvasTsx, /node\.style\.top =/)
})

test('business designer graph canvas culls only large viewports with pinned context kept', () => {
  assert.match(graphCanvasTsx, /const VIEWPORT_CULLING_NODE_THRESHOLD = 50/)
  assert.match(graphCanvasTsx, /interface CanvasViewportWindow/)
  assert.match(graphCanvasTsx, /requestAnimationFrame\(updateViewportWindow\)/)
  assert.match(graphCanvasTsx, /const activeViewport = viewport/)
  assert.match(graphCanvasTsx, /activeViewport\.addEventListener\('scroll', scheduleViewportWindowUpdate, \{ passive: true \}\)/)
  assert.match(graphCanvasTsx, /new ResizeObserver\(scheduleViewportWindowUpdate\)/)
  assert.match(graphCanvasTsx, /resizeObserver\.observe\(activeViewport\)/)
  assert.match(graphCanvasTsx, /activeViewport\.removeEventListener\('scroll', scheduleViewportWindowUpdate\)/)
  assert.match(
    graphCanvasTsx,
    /if \(view\.nodes\.length <= VIEWPORT_CULLING_NODE_THRESHOLD \|\| !viewportWindow\) \{[\s\S]*?return view/,
  )
  assert.match(graphCanvasTsx, /const bufferX = viewportWindow\.width/)
  assert.match(graphCanvasTsx, /const bufferY = viewportWindow\.height/)
  assert.match(graphCanvasTsx, /const pinnedNodeIds = new Set\(\[selectedBlockId, drillBlockId\]\.filter\(Boolean\)\)/)
  assert.match(graphCanvasTsx, /if \(pinnedNodeIds\.has\(node\.block\.id\)\) \{[\s\S]*?return true/)
  assert.match(
    graphCanvasTsx,
    /view\.edges\.filter\([\s\S]*?visibleNodeIds\.has\(edge\.from\.id\) && visibleNodeIds\.has\(edge\.to\.id\)/,
  )
  assert.match(graphCanvasTsx, /\{visibleGraph\.edges\.map/)
  assert.match(graphCanvasTsx, /\{visibleGraph\.nodes\.map/)
})

test('business designer document replacement keeps phase 6 brief continuity', () => {
  const replaceDetail = functionBlock('replaceDetail')
  const loadDocument = functionBlock('loadDocument')

  assert.match(replaceDetail, /ensureBriefBlock\(next\)/)
  assert.match(replaceDetail, /isSameDocument[\s\S]*?preserveBlockFocus\(ready\)/)
  assert.match(replaceDetail, /setSelectedBlockId\(ready \? BRIEF_BLOCK_ID : null\)/)
  assert.match(replaceDetail, /setDrillBlockId\(null\)/)
  assert.match(loadDocument, /setSelectedBlockId\(BRIEF_BLOCK_ID\)/)
  assert.match(loadDocument, /isSameDocument[\s\S]*?preserveBlockFocus\(ready\)/)
  assert.doesNotMatch(loadDocument, /setDrillBlockId\(BRIEF_BLOCK_ID\)/)
  assert.match(controllerTs, /function hasBlock\(detail: DesignerDocumentDetail \| null, blockId: string \| null\): boolean/)
  assert.match(controllerTs, /const preserveBlockFocus = useCallback/)
  assert.match(controllerTs, /hasBlock\(ready, current\)/)
})

test('business designer keeps phase 6 export checkpoint and history continuity', () => {
  assert.match(appIconsTsx, /\|\s*'database'/)
  assert.match(appIconsTsx, /\|\s*'route'/)
  assert.match(appIconsTsx, /\|\s*'braces'/)
  assert.match(appIconsTsx, /database:\s*Database/)
  assert.match(appIconsTsx, /route:\s*Route/)
  assert.match(appIconsTsx, /braces:\s*Braces/)
  assert.match(messagesTs, /'designer\.create\.entity': \{ 'zh-CN': '实体', 'en-US': 'Entity' \}/)
  assert.match(messagesTs, /'designer\.create\.flow': \{ 'zh-CN': '流程', 'en-US': 'Flow' \}/)
  assert.match(messagesTs, /'designer\.create\.api': \{ 'zh-CN': '契约', 'en-US': 'Contract' \}/)
  assert.doesNotMatch(messagesTs, /'designer\.create\.(entity|flow|api)': \{[^}]*'\+ /)
  assert.match(toolbarTsx, /onExport: \(format: DesignerExportFormat\) => void/)
  assert.match(toolbarTsx, /onCheckpoint: \(\) => void/)
  assert.match(toolbarTsx, /onOpenHistory: \(\) => void/)
  assert.match(toolbarTsx, /<AppIcon name="database" aria-hidden="true" \/>[\s\S]*?designer\.create\.entity/)
  assert.match(toolbarTsx, /<AppIcon name="route" aria-hidden="true" \/>[\s\S]*?designer\.create\.flow/)
  assert.match(toolbarTsx, /<AppIcon name="braces" aria-hidden="true" \/>[\s\S]*?designer\.create\.api/)
  assert.match(toolbarTsx, /DESIGNER_EXPORT_FORMATS\.map\(\(format\) =>/)
  assert.match(toolbarTsx, /onExport\(format\)/)
  assert.match(toolbarTsx, /onClick=\{onCheckpoint\}/)
  assert.match(toolbarTsx, /onClick=\{onOpenHistory\}/)
  assert.match(paneTsx, /void state\.exportDocument\(format\)/)
  assert.match(paneTsx, /void state\.createCheckpoint\(''\)\.then\(\(\) => history\.refresh\(\)\)/)
  assert.match(paneTsx, /onOpenHistory=\{\(\) => history\.open\(\)\}/)
})

test('business designer history mode keeps native radio keyboard navigation', () => {
  assert.match(historySheetTsx, /type KeyboardEvent as ReactKeyboardEvent/)
  assert.match(historySheetTsx, /const modeGroupRef = useRef<HTMLDivElement>\(null\)/)
  assert.match(historySheetTsx, /const setHistoryMode = \(mode: UseDesignerHistoryResult\['mode'\]\) => \{/)
  assert.match(historySheetTsx, /history\.setMode\(mode\)/)
  assert.match(historySheetTsx, /window\.requestAnimationFrame\(\(\) => \{/)
  assert.match(historySheetTsx, /querySelector<HTMLButtonElement>\(`\[data-history-mode="\$\{mode\}"\]`\)/)
  assert.match(historySheetTsx, /const handleModeKeyDown = \(event: ReactKeyboardEvent<HTMLDivElement>\) => \{/)
  assert.match(historySheetTsx, /event\.key !== 'ArrowLeft'/)
  assert.match(historySheetTsx, /event\.key !== 'ArrowRight'/)
  assert.match(historySheetTsx, /event\.key !== 'Home'/)
  assert.match(historySheetTsx, /event\.key !== 'End'/)
  assert.match(historySheetTsx, /event\.preventDefault\(\)/)
  assert.match(historySheetTsx, /event\.key === 'ArrowLeft' \|\| event\.key === 'Home'[\s\S]*\? 'workingTree'[\s\S]*: 'checkpoints'/)
  assert.match(historySheetTsx, /ref=\{modeGroupRef\}/)
  assert.match(historySheetTsx, /onKeyDown=\{handleModeKeyDown\}/)
  assert.match(historySheetTsx, /data-history-mode="workingTree"/)
  assert.match(historySheetTsx, /data-history-mode="checkpoints"/)
  assert.match(historySheetTsx, /onClick=\{\(\) => setHistoryMode\('workingTree'\)\}/)
  assert.match(historySheetTsx, /onClick=\{\(\) => setHistoryMode\('checkpoints'\)\}/)
})

test('business designer export menu keeps native keyboard navigation', () => {
  assert.match(toolbarTsx, /type KeyboardEvent as ReactKeyboardEvent/)
  assert.match(toolbarTsx, /const exportButtonRef = useRef<HTMLButtonElement>\(null\)/)
  assert.match(
    toolbarTsx,
    /querySelector<HTMLButtonElement>\('\.designer-export-option'\)\?\.focus\(\)/,
  )
  assert.match(
    toolbarTsx,
    /const handleExportMenuKeyDown = \(event: ReactKeyboardEvent<HTMLDivElement>\)/,
  )
  assert.match(toolbarTsx, /event\.key !== 'ArrowDown'/)
  assert.match(toolbarTsx, /event\.key !== 'ArrowUp'/)
  assert.match(toolbarTsx, /event\.key !== 'Home'/)
  assert.match(toolbarTsx, /event\.key !== 'End'/)
  assert.match(toolbarTsx, /event\.key !== 'Escape'/)
  assert.match(
    toolbarTsx,
    /if \(event\.key === 'Escape'\) \{[\s\S]*?setExportOpen\(false\)[\s\S]*?exportButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  )
  assert.match(
    toolbarTsx,
    /querySelectorAll<HTMLButtonElement>\('\.designer-export-option'\)/,
  )
  assert.match(toolbarTsx, /ref=\{exportButtonRef\}/)
  assert.match(toolbarTsx, /onKeyDown=\{handleExportMenuKeyDown\}/)
})

test('business designer preserves phase 6 save shortcut across v1 forms', () => {
  assert.match(paneTsx, /const saveDesignerDocument = useCallback\(\(\) => \{/)
  assert.match(paneTsx, /if \(!state\.detail \|\| state\.operation === 'save'\) \{[\s\S]*?return/)
  assert.match(paneTsx, /void state\.save\(\)\.then\(\(\) => documents\.refresh\(\)\)/)
  assert.match(paneTsx, /window\.addEventListener\('keydown', onKeyDown\)/)
  assert.match(paneTsx, /window\.removeEventListener\('keydown', onKeyDown\)/)
  assert.match(paneTsx, /!\(event\.metaKey \|\| event\.ctrlKey\) \|\| event\.key\.toLowerCase\(\) !== 's'/)
  assert.match(paneTsx, /event\.preventDefault\(\)[\s\S]*?saveDesignerDocument\(\)/)
  assert.match(paneTsx, /onSave=\{saveDesignerDocument\}/)
})

test('business designer sidebar create action uses native icon button semantics', () => {
  assert.match(sidebarTsx, /className="designer-tool-button designer-create-confirm"/)
  assert.match(
    sidebarTsx,
    /className="designer-tool-button designer-create-confirm"[\s\S]*?<AppIcon name="plus" aria-hidden="true" \/>[\s\S]*?designer\.create/,
  )
})

test('business designer drill forms keep visual styling in scss', () => {
  assert.doesNotMatch(drillSheetTsx, /style=\{\{/)
  assert.doesNotMatch(drillSheetTsx, /style=\{\s*\{/)
  assert.match(drillSheetTsx, /className="designer-drill-text-input"/)
  assert.match(drillSheetTsx, /className="designer-drill-json"/)
  assert.match(drillSheetTsx, /designer-brief-textarea--drill/)
  assert.match(messagesTs, /'designer\.drill\.addRow': \{ 'zh-CN': '添加', 'en-US': 'Add' \}/)
  assert.match(
    messagesTs,
    /'designer\.inspector\.createEntityFromGap': \{[\s\S]*?'zh-CN': '建 \{name\} 实体',[\s\S]*?'en-US': 'Create \{name\} entity'/,
  )
  assert.doesNotMatch(messagesTs, /'designer\.drill\.addRow': \{[^}]*'\+ /)
  assert.doesNotMatch(messagesTs, /'designer\.inspector\.createEntityFromGap': \{[\s\S]*?'\+ /)
  assert.match(
    drillSheetTsx,
    /className="designer-drill-add-row"[\s\S]*?<AppIcon name="plus" aria-hidden="true" \/>[\s\S]*?designer\.drill\.addRow/,
  )
  assert.match(
    inspectorTsx,
    /onClick=\{\(\) => onCreateEntityFromGap\(gap\)\}[\s\S]*?<AppIcon name="plus" aria-hidden="true" \/>[\s\S]*?designer\.inspector\.createEntityFromGap/,
  )
})

test('business designer drill panel closes from native desktop exits', () => {
  assert.match(drillSheetTsx, /if \(event\.key === 'Escape'\) \{[\s\S]*?onClose\(\)/)
  assert.match(drillSheetTsx, /className="designer-icon-button"[\s\S]*?onClick=\{onClose\}/)
  assert.match(graphCanvasTsx, /onCloseDrill: \(\) => void/)
  assert.match(
    graphCanvasTsx,
    /if \(event\.target === event\.currentTarget\) \{[\s\S]*?onSelectBlock\(null\)[\s\S]*?onCloseDrill\(\)/,
  )
  assert.match(paneTsx, /onCloseDrill=\{\(\) => state\.openDrill\(null\)\}/)
})

test('business designer patch sheet keeps native keyboard review flow', () => {
  assert.match(patchSheetTsx, /useRef<HTMLElement \| null>\(null\)/)
  assert.match(
    patchSheetTsx,
    /querySelector<HTMLInputElement>\('\.designer-patch-change input'\)[\s\S]*?querySelector<HTMLButtonElement>\('button'\)/,
  )
  assert.match(patchSheetTsx, /firstControl\?\.focus\(\)/)
  assert.match(patchSheetTsx, /if \(event\.key !== 'Escape'\)/)
  assert.match(patchSheetTsx, /event\.preventDefault\(\)[\s\S]*?onDismiss\(\)/)
  assert.match(patchSheetTsx, /window\.addEventListener\('keydown', onKeyDown\)/)
  assert.match(patchSheetTsx, /change\.destructive \? null : index/)
  assert.match(patchSheetTsx, /type="checkbox"[\s\S]*?checked=\{accepted\.includes\(index\)\}/)
})

test('business designer patch sheet shows full gap resolution verdict', () => {
  assert.match(patchSheetTsx, /gapResolution\.resolved\.length > 0/)
  assert.match(patchSheetTsx, /gapResolution\.unresolved\.length > 0/)
  assert.match(patchSheetTsx, /gapResolution\.incidentalResolved\.length > 0/)
  assert.match(patchSheetTsx, /gapResolution\.introduced\.length > 0/)
  assert.match(
    patchSheetTsx,
    /className="designer-patch-resolution-row is-incidental-resolved"[\s\S]*?designer\.patch\.resolution\.incidentalResolved[\s\S]*?count: gapResolution\.incidentalResolved\.length/,
  )
  assert.match(
    messagesTs,
    /'designer\.patch\.resolution\.incidentalResolved': \{[\s\S]*?'zh-CN': '顺带修复 \{count\} 个缺口',[\s\S]*?'en-US': 'Incidentally resolved \{count\} gap\{plural\}'/,
  )
  assert.match(designerScss, /\.designer-patch-resolution-row \{[\s\S]*&\.is-incidental-resolved \{ color: var\(--designer-gap-resolved\); \}/)
})

test('business designer patch sheet offers checkpoint after verification', () => {
  assert.match(patchSheetTsx, /onCheckpoint\?: \(\) => void/)
  assert.match(
    patchSheetTsx,
    /className="designer-tool-button designer-patch-resolution-checkpoint"[\s\S]*?onClick=\{onCheckpoint\}[\s\S]*?designer\.patch\.resolution\.checkpoint/,
  )
  assert.match(
    paneTsx,
    /<DesignerPatchSheet[\s\S]*?onCheckpoint=\{\(\) => \{[\s\S]*?void state\.createCheckpoint\(''\)\.then\(\(\) => history\.refresh\(\)\)/,
  )
  assert.match(
    messagesTs,
    /'designer\.patch\.resolution\.checkpoint': \{ 'zh-CN': '创建 checkpoint', 'en-US': 'Create checkpoint' \}/,
  )
  assert.match(designerScss, /\.designer-patch-resolution-checkpoint \{[\s\S]*align-self: flex-start;/)
})

test('business designer delete removes block document state and derived graph state', () => {
  const deleteBlock = functionBlock('deleteBlock')

  assert.match(graphCanvasTsx, /onDeleteBlock\(node\.block\)/)
  assert.match(graphCanvasTsx, /designer\.canvas\.deleteBlock/)
  assert.match(
    graphCanvasTsx,
    /className="designer-node-delete-btn"[\s\S]*?title=\{t\(locale, 'designer\.canvas\.deleteBlock'\)\}[\s\S]*?aria-label=\{t\(locale, 'designer\.canvas\.deleteBlock'\)\}[\s\S]*?<AppIcon name="trash" aria-hidden="true" \/>/,
  )
  assert.doesNotMatch(graphCanvasTsx, /designer-node-delete-btn[\s\S]*?<span>/)
  assert.doesNotMatch(inspectorTsx, /designer-inspector-delete-btn/)
  assert.doesNotMatch(inspectorTsx, /onDeleteBlock/)
  assert.doesNotMatch(paneTsx, /<DesignerInspector[\s\S]*?onDeleteBlock=\{onDeleteBlock\}/)
  assert.match(deleteBlock, /next\.design\.blocks = next\.design\.blocks\.filter/)
  assert.match(deleteBlock, /delete layout\[blockId\]/)
  assert.match(deleteBlock, /links: block\.links\.filter\(\(link\) => link\.targetBlockId !== blockId\)/)
  assert.match(deleteBlock, /next\.diagnostics = next\.diagnostics\.filter/)
  assert.match(deleteBlock, /setValidation\(\(current\) =>/)
  assert.match(deleteBlock, /gaps: current\.gaps\.filter\(\(gap\) => gap\.blockId !== blockId\)/)
  assert.match(
    deleteBlock,
    /rulesRun: current\.rulesRun\.filter\(\(rule\) => rule\.blockId !== blockId\)/,
  )
  assert.match(
    deleteBlock,
    /link\.fromBlockId !== blockId && link\.toBlockId !== blockId/,
  )
  assert.match(deleteBlock, /setSelectedBlockId\(\(current\) => \(current === blockId \? null : current\)\)/)
  assert.match(deleteBlock, /setDrillBlockId\(\(current\) => \(current === blockId \? null : current\)\)/)
  assert.match(deleteBlock, /setAgentPreview\(null\)/)
  assert.match(deleteBlock, /setPatchValidation\(null\)/)
  assert.match(deleteBlock, /setDirty\(true\)/)
})

test('business designer inspector scrolls without clipping freeform controls', () => {
  assert.match(
    designerScss,
    /\.designer-inspector \{[\s\S]*?max-height: 100%;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/,
  )
  assert.match(
    designerScss,
    /\.designer-inspector-header \{[\s\S]*?flex: 0 0 auto;/,
  )
  assert.match(
    designerScss,
    /\.designer-inspector-section \{[\s\S]*?flex: 0 0 auto;[\s\S]*?min-width: 0;/,
  )
  assert.match(designerScss, /\.designer-freeform-run-log \{[\s\S]*?overflow: auto;/)
  assert.doesNotMatch(designerScss, /\.designer-inspector \{[\s\S]*?overflow: hidden;/)
})

test('business designer graph canvas localizes accessibility copy', () => {
  assert.match(
    messagesTs,
    /'designer\.canvas\.gapCount': \{ 'zh-CN': '\{count\} 个缺口', 'en-US': '\{count\} gap\{plural\}' \}/,
  )
  assert.match(
    messagesTs,
    /'designer\.canvas\.nodeLabel': \{ 'zh-CN': '\{kind\}：\{title\}', 'en-US': '\{kind\}: \{title\}' \}/,
  )
  assert.match(designerBlockLabelsTs, /export function designerBlockKindLabel/)
  assert.match(designerBlockLabelsTs, /entityModel: 'designer\.section\.entityModel'/)
  assert.match(graphCanvasTsx, /const kindLabel = designerBlockKindLabel\(locale, node\.block\.kind\)/)
  assert.match(graphCanvasTsx, /const nodeTitle = node\.block\.title \|\| node\.block\.id/)
  assert.match(graphCanvasTsx, /\{designerBlockKindLabel\(locale, kind\)\}/)
  assert.match(
    graphCanvasTsx,
    /aria-label=\{t\(locale, 'designer\.canvas\.nodeLabel', \{[\s\S]*?kind: kindLabel,[\s\S]*?title: nodeTitle,[\s\S]*?\}\)\}/,
  )
  assert.match(graphCanvasTsx, /<span className="designer-node-kind">\{kindLabel\}<\/span>/)
  assert.match(
    graphCanvasTsx,
    /aria-label=\{t\(locale, 'designer\.canvas\.gapCount', \{[\s\S]*?count: node\.gapCount,[\s\S]*?plural: node\.gapCount === 1 \? '' : 's',[\s\S]*?\}\)\}/,
  )
  assert.doesNotMatch(graphCanvasTsx, /aria-label=\{`\$\{node\.block\.kind\}: /)
  assert.doesNotMatch(graphCanvasTsx, /aria-label=\{`\$\{node\.gapCount\} gaps`\}/)
})

test('business designer inspector localizes accessibility landmarks', () => {
  assert.match(
    messagesTs,
    /'designer\.inspector\.label': \{ 'zh-CN': '检查器', 'en-US': 'Inspector' \}/,
  )
  assert.match(inspectorTsx, /aria-label=\{t\(locale, 'designer\.inspector\.label'\)\}/)
  assert.doesNotMatch(inspectorTsx, /aria-label="Inspector"/)
})

test('business designer agent preview requires concrete target gaps before dispatch', () => {
  assert.match(inspectorTsx, /const hasTargetGaps = preview\.targetGaps\.length > 0/)
  assert.match(inspectorTsx, /const ready = preview\.status === 'ready' && hasTargetGaps/)
  assert.match(inspectorTsx, /const canConfirm = ready && !busy/)
  assert.match(inspectorTsx, /disabled=\{!canConfirm\}/)
  assert.match(inspectorTsx, /designer\.agentPreview\.noTargetGaps/)
})

test('business designer agent preview keeps native keyboard operation', () => {
  assert.match(inspectorTsx, /useRef<HTMLDivElement \| null>\(null\)/)
  assert.match(
    inspectorTsx,
    /querySelector<HTMLSelectElement>\('select:not\(:disabled\)'\)[\s\S]*?querySelector<HTMLButtonElement>\('button:not\(:disabled\)'\)/,
  )
  assert.match(inspectorTsx, /firstControl\?\.focus\(\)/)
  assert.match(inspectorTsx, /if \(event\.key !== 'Escape'\) \{[\s\S]*?return/)
  assert.match(inspectorTsx, /event\.preventDefault\(\)[\s\S]*?onCancel\(\)/)
  assert.match(inspectorTsx, /ref=\{previewRef\}[\s\S]*?onKeyDown=\{handleKeyDown\}/)
})

test('business designer public agent patch contract only exposes host updates', () => {
  for (const source of [designerPatchTs, desktopApiTs, sharedTypesTs]) {
    assert.match(source, /op: ['"]updateBlock['"]/)
    assert.doesNotMatch(source, /op: ['"]addBlock['"]/)
    assert.doesNotMatch(source, /op: ['"]deleteBlock['"]/)
  }
  assert.doesNotMatch(designerPatchTs, /interface DesignerAgentPatchBlock \{[\s\S]*links\?:/)
  assert.doesNotMatch(sharedTypesTs, /interface BusinessDesignerAgentPatchBlock \{[\s\S]*links\?:/)
})

test('business designer graph projection relation vocabulary is closed', () => {
  const desktopEdge = interfaceBlock(desktopApiTs, 'BusinessDesignerDerivedEdge')
  assert.match(designerValidationTs, /export type DesignerEdgeRelation =[\s\S]*'dependsOn'[\s\S]*'produces'[\s\S]*'consumes'[\s\S]*'uses'[\s\S]*'extends'/)
  assert.match(designerValidationTs, /relation: DesignerEdgeRelation/)
  assert.doesNotMatch(designerValidationTs, /relation: DesignerEdgeRelation \| string/)
  assert.match(designerGraphTs, /relation: DesignerEdgeRelation/)
  assert.doesNotMatch(designerGraphTs, /relation: string/)
  assert.match(sharedTypesTs, /relation: "dependsOn" \| "produces" \| "consumes" \| "uses" \| "extends";/)
  assert.doesNotMatch(sharedTypesTs, /relation: "dependsOn" \| "produces" \| "consumes" \| "uses" \| "extends" \| string/)
  assert.match(desktopEdge, /relation: 'dependsOn' \| 'produces' \| 'consumes' \| 'uses' \| 'extends'/)
  assert.doesNotMatch(desktopEdge, /relation: 'dependsOn' \| 'produces' \| 'consumes' \| 'uses' \| 'extends' \| string/)
})

test('business designer gap layer and severity vocabularies are closed', () => {
  const designerGap = interfaceBlock(designerValidationTs, 'DesignerGap')
  const sharedGap = interfaceBlock(sharedTypesTs, 'BusinessDesignerGap')
  const desktopGap = interfaceBlock(desktopApiTs, 'BusinessDesignerGap')
  assert.match(designerGap, /layer: 'intra' \| 'inter'/)
  assert.match(designerGap, /severity: 'warning' \| 'error'/)
  assert.doesNotMatch(designerGap, /layer: 'intra' \| 'inter' \| string/)
  assert.doesNotMatch(designerGap, /severity: DesignerDiagnosticSeverity \| string/)
  assert.match(sharedGap, /layer: "intra" \| "inter";/)
  assert.match(sharedGap, /severity: "warning" \| "error";/)
  assert.doesNotMatch(sharedGap, /layer: "intra" \| "inter" \| string/)
  assert.doesNotMatch(sharedGap, /severity: "info" \| "warning" \| "error" \| string/)
  assert.match(desktopGap, /layer: 'intra' \| 'inter'/)
  assert.match(desktopGap, /severity: 'warning' \| 'error'/)
  assert.doesNotMatch(desktopGap, /layer: 'intra' \| 'inter' \| string/)
  assert.doesNotMatch(desktopGap, /severity: 'info' \| 'warning' \| 'error' \| string/)
})

test('business designer validation result carries required schema identity', () => {
  const featureValidation = interfaceBlock(designerValidationTs, 'DesignerValidationResult')
  const desktopValidation = interfaceBlock(desktopApiTs, 'BusinessDesignerValidationResult')

  for (const source of [featureValidation, desktopValidation]) {
    assert.match(source, /schemaVersion: number/)
    assert.match(source, /workspaceId: string/)
    assert.doesNotMatch(source, /schemaVersion\?: number/)
    assert.doesNotMatch(source, /workspaceId\?: string/)
  }

  assert.match(desktopApiTs, /export interface BusinessDesignerValidationResult \{[\s\S]*schemaVersion: number[\s\S]*workspaceId: string/)
  assert.match(sharedTypesTs, /export interface BusinessDesignerAgentTaskPreview \{[\s\S]*schemaVersion: number/)
  assert.match(desktopApiTs, /export interface BusinessDesignerAgentTaskPreview \{[\s\S]*schemaVersion: number/)
})

test('business designer shared request objects carry audit trace ids', () => {
  for (const name of [
    'BusinessDesignerAgentTaskPreviewRequest',
    'BusinessDesignerAgentCompletionRequest',
    'BusinessDesignerFreeformCompletionRequest',
    'BusinessDesignerMockAgentCompletionRequest',
    'BusinessDesignerValidateAgentPatchRequest',
    'BusinessDesignerRecoverAgentPatchRequest',
    'BusinessDesignerApplyAgentPatchRequest',
  ]) {
    const request = interfaceBlock(sharedTypesTs, name)
    assert.match(request, /traceId\?: string \| null/)
    assert.match(request, /workspaceId: string/)
    assert.match(request, /documentId: string/)
  }

  const completionRequest = interfaceBlock(sharedTypesTs, 'BusinessDesignerAgentCompletionRequest')
  assert.match(completionRequest, /targetAgentIds: string\[\]/)
  assert.doesNotMatch(completionRequest, /targetAgentIds\?:/)
  assert.doesNotMatch(completionRequest, /selectedBlockIds/)
})

test('business designer freeform completion has separate request-object IPC', () => {
  const sharedRequest = interfaceBlock(sharedTypesTs, 'BusinessDesignerFreeformCompletionRequest')
  const sharedRunStatusRequest = interfaceBlock(sharedTypesTs, 'BusinessDesignerFreeformCompletionRunStatusRequest')
  const sharedRevertRequest = interfaceBlock(sharedTypesTs, 'BusinessDesignerRevertToCheckpointRequest')
  const sharedRun = interfaceBlock(sharedTypesTs, 'BusinessDesignerFreeformCompletionRun')
  const featureRequest = interfaceBlock(designerFreeformCompletionTs, 'DesignerFreeformCompletionRequest')
  const featureRunStatusRequest = interfaceBlock(designerFreeformCompletionTs, 'DesignerFreeformCompletionRunStatusRequest')
  const featureRevertRequest = interfaceBlock(designerFreeformCompletionTs, 'DesignerRevertToCheckpointRequest')
  const featureRun = interfaceBlock(designerFreeformCompletionTs, 'DesignerFreeformCompletionRun')
  const startApi = exportedFunctionBlock(designerDesktopApiTs, 'startDesignerFreeformCompletion')
  const listApi = exportedFunctionBlock(designerDesktopApiTs, 'listDesignerFreeformCompletionRuns')
  const updateStatusApi = exportedFunctionBlock(designerDesktopApiTs, 'updateDesignerFreeformCompletionRunStatus')
  const revertApi = exportedFunctionBlock(designerDesktopApiTs, 'revertDesignerToCheckpoint')

  for (const source of [sharedRequest, featureRequest]) {
    assert.match(source, /scenario: .*FreeformCompletionScenario/)
    assert.match(source, /hostBlockId\?: string \| null/)
    assert.match(source, /userPrompt\?: string \| null/)
    assert.match(source, /provider\?: .*FreeformCompletionProvider \| null/)
    assert.doesNotMatch(source, /gapCodes/)
    assert.doesNotMatch(source, /baseRevision/)
    assert.doesNotMatch(source, /targetAgentIds/)
  }
  for (const source of [sharedRun, featureRun]) {
    assert.match(source, /requestId: string/)
    assert.match(source, /sessionId: string/)
    assert.match(source, /documentRoot: string/)
    assert.match(source, /checkpointBefore: string/)
    assert.match(source, /status: .*FreeformCompletionRunStatus/)
  }
  for (const source of [sharedRunStatusRequest, featureRunStatusRequest]) {
    assert.match(source, /requestId: string/)
    assert.match(source, /status: .*FreeformCompletionRunStatus/)
  }
  for (const source of [sharedRevertRequest, featureRevertRequest]) {
    assert.match(source, /checkpoint: string/)
    assert.doesNotMatch(source, /path/)
  }
  assert.match(
    desktopApiTs,
    /businessDesignerStartFreeformCompletion\([\s\S]*?business_designer_start_freeform_completion'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerListFreeformCompletionRuns\([\s\S]*?business_designer_list_freeform_completion_runs'/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerUpdateFreeformCompletionRunStatus\([\s\S]*?business_designer_update_freeform_completion_run_status'/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerRevertToCheckpoint\([\s\S]*?business_designer_revert_to_checkpoint'/,
  )
  assert.match(startApi, /Promise<DesignerFreeformCompletionRun>/)
  assert.match(listApi, /Promise<DesignerFreeformCompletionRunsResult>/)
  assert.match(updateStatusApi, /Promise<DesignerFreeformCompletionRun>/)
  assert.match(revertApi, /Promise<DesignerDocumentDetail>/)
  assert.match(freeformControllerTs, /traceDesignerIpc\('business_designer\.list_freeform_completion_runs'/)
  assert.match(freeformControllerTs, /startDesignerFreeformCompletion\(workspaceId, \{[\s\S]*?traceId: nextDesignerIpcTraceId\(\)/)
  assert.match(freeformControllerTs, /desktopApi\.subscribeTerminalEvents\(/)
  assert.match(freeformControllerTs, /updateDesignerFreeformCompletionRunStatus\(workspaceId, \{/)
  assert.match(freeformControllerTs, /payload\.to === 'killed' \? 'cancelled' : payload\.to === 'failed' \? 'failed' : 'completed'/)
  assert.match(freeformControllerTs, /terminalReadSnapshot\(workspaceId, run\.sessionId, 48_000\)/)
  assert.match(freeformControllerTs, /createTerminalChunkDecoder\(\)/)
  assert.match(freeformControllerTs, /decodeTerminalBase64Chunk\(decoder, snapshot\.chunk, false\)/)
  assert.match(freeformControllerTs, /desktopApi\.terminalKill\(workspaceId, run\.sessionId, 'TERM'\)/)
  assert.match(freeformControllerTs, /status: 'cancelled'/)
  assert.match(historyControllerTs, /function useDesignerHistory/)
  assert.match(historyControllerTs, /openDiffFromCheckpoint[\s\S]*?diffDesignerWorkingTree\(workspaceId, documentId, checkpoint, traceId\)/)
  assert.match(controllerTs, /revertDesignerToCheckpoint\(workspaceId, \{/)
  assert.match(controllerTs, /setNotice\(\{ kind: 'success', text: 'checkpointReverted' \}\)/)
  assert.match(tauriLibRs, /business_designer::business_designer_update_freeform_completion_run_status/)
  assert.match(tauriLibRs, /business_designer::business_designer_revert_to_checkpoint/)
  assert.match(tauriBusinessDesignerRs, /pub fn business_designer_update_freeform_completion_run_status/)
  assert.match(tauriBusinessDesignerRs, /pub fn business_designer_revert_to_checkpoint/)
  assert.match(tauriBusinessDesignerRs, /set_session_visibility\(&session\.session_id, true\)/)
  assert.match(tauriBusinessDesignerRs, /shell: Some\("auto"\.to_string\(\)\)/)
  assert.match(tauriBusinessDesignerRs, /fn as_tool_kind\(self\) -> AgentToolKind/)
  assert.match(
    tauriBusinessDesignerRs,
    /let tool_kind = provider\.as_tool_kind\(\);[\s\S]*?env:\s*augment_terminal_env_for_agent\(\s*app,\s*state,\s*workspace_id,\s*tool_kind,\s*true,\s*Default::default\(\),?\s*\)\?/,
  )
  assert.match(
    tauriBusinessDesignerRs,
    /write_terminal_command_with_submit\(state, &session\.session_id, provider\.as_str\(\), "\\r"\)/,
  )
  assert.match(tauriBusinessDesignerRs, /FREEFORM_PROMPT_INJECTION_DELAY_MS/)
  assert.doesNotMatch(tauriBusinessDesignerRs, /shell: Some\(provider\.as_str\(\)\.to_string\(\)\)/)
  assert.doesNotMatch(tauriBusinessDesignerRs, /env: Default::default\(\),[\s\S]*?agent_tool_kind: Some\(provider\.as_str\(\)\.to_string\(\)\)/)
  assert.match(tauriBusinessDesignerRs, /run_git\(&docs_root, &\["checkout", &checkpoint, "--", &pathspec\]\)/)
  assert.doesNotMatch(freeformControllerTs, /runDesignerAgentCompletion/)
  assert.doesNotMatch(freeformControllerTs, /runMockDesignerAgentCompletion/)
})

test('business designer freeform entry dispatches directly from inspector scenes', () => {
  const freeformPanel = localFunctionBlock(inspectorTsx, 'FreeformCompletionPanel')

  assert.match(paneTsx, /useDesignerFreeformCompletion\(\{[\s\S]*?documentId: state\.detail\?\.manifest\.documentId \?\? null/)
  assert.match(paneTsx, /const FREEFORM_PROVIDER_STORAGE_KEY = 'gtoffice\.businessDesigner\.freeformProvider'/)
  assert.match(paneTsx, /window\.localStorage\.setItem\(FREEFORM_PROVIDER_STORAGE_KEY, provider\)/)
  assert.match(paneTsx, /readStoredFreeformProvider\(\)/)
  assert.match(paneTsx, /readStoredFreeformProvider\(\) \?\? 'codex'/)
  assert.match(paneTsx, /const \[freeformProviderConfigured, setFreeformProviderConfigured\] = useState\([\s\S]*?readStoredFreeformProvider\(\) !== null/)
  assert.match(paneTsx, /setPendingFreeformCompletion\(params\)/)
  assert.match(paneTsx, /const configureFreeformProvider = useCallback\([\s\S]*?setFreeformProvider\(provider\)[\s\S]*?dispatchFreeformCompletion\(pending, provider\)/)
  assert.match(paneTsx, /const confirmFreeformProvider = useCallback\(\(\) => \{[\s\S]*?configureFreeformProvider\(freeformProvider\)/)
  assert.match(paneTsx, /const dispatchFreeformCompletion = useCallback\([\s\S]*?startCompletion\(\{[\s\S]*?\.\.\.params,[\s\S]*?provider,/)
  assert.match(
    paneTsx,
    /<DesignerInspector[\s\S]*?freeformRuns=\{freeformCompletion\.runs\}[\s\S]*?freeformProvider=\{freeformProvider\}[\s\S]*?onStartFreeformCompletion=\{onStartFreeformCompletion\}/,
  )

  assert.match(inspectorTsx, /function FreeformCompletionPanel\(/)
  assert.match(inspectorTsx, /function scenarioForBlock\(block: DesignerBlock\): DesignerFreeformCompletionScenario/)
  assert.match(inspectorTsx, /block\.id === 'brief'[\s\S]*?return 'brief_to_design'/)
  assert.match(inspectorTsx, /block\.kind === 'entityModel'[\s\S]*?return 'complete_entity'/)
  assert.match(inspectorTsx, /block\.kind === 'businessFlow'[\s\S]*?return 'complete_flow'/)
  assert.match(inspectorTsx, /block\.kind === 'apiContract'[\s\S]*?return 'complete_api_contract'/)
  assert.match(inspectorTsx, /return 'expand_canvas'/)
  assert.match(inspectorTsx, /onStart\(\{[\s\S]*?scenario,[\s\S]*?hostBlockId: block\.id,[\s\S]*?userPrompt: userPrompt\.trim\(\) \|\| null/)
  assert.match(inspectorTsx, /onProviderChange\(event\.target\.value === 'claude' \? 'claude' : 'codex'\)/)
  assert.match(inspectorTsx, /!providerConfigured/)
  assert.match(inspectorTsx, /designer\.freeform\.providerSetupPending/)
  assert.match(inspectorTsx, /designer\.freeform\.providerConfirm/)
  assert.match(messagesTs, /'designer\.freeform\.providerSetup'/)
  assert.match(messagesTs, /'designer\.freeform\.providerSetupPending'/)
  assert.match(toolbarTsx, /onExpandCanvas: \(userPrompt\?: string \| null\) => void/)
  assert.match(toolbarTsx, /className="designer-toolbar-prompt"/)
  assert.match(toolbarTsx, /placeholder=\{t\(locale, 'designer\.freeform\.toolbarPromptPlaceholder'\)\}/)
  assert.match(toolbarTsx, /onExpandCanvas\(expandPrompt\.trim\(\) \|\| null\)/)
  assert.match(messagesTs, /'designer\.freeform\.toolbarPromptPlaceholder'/)
  assert.match(
    paneTsx,
    /const onExpandCanvas = useCallback\(\(userPrompt\?: string \| null\) => \{[\s\S]*?scenario: 'expand_canvas'[\s\S]*?userPrompt: userPrompt\?\.trim\(\) \|\| null/,
  )
  assert.match(paneTsx, /onExpandCanvas=\{onExpandCanvas\}/)
  assert.match(inspectorTsx, /function FreeformRunList\(/)
  assert.match(inspectorTsx, /run\.sessionId[\s\S]*?run\.checkpointBefore/)
  assert.match(inspectorTsx, /aria-expanded=\{expandedRunId === run\.requestId\}/)
  assert.match(inspectorTsx, /onReadLog\(run\)/)
  assert.match(inspectorTsx, /className="designer-freeform-run-log"/)
  assert.match(inspectorTsx, /designer\.freeform\.viewLog/)
  assert.match(inspectorTsx, /onStopRun\(run\)/)
  assert.match(inspectorTsx, /designer\.freeform\.stopRun/)
  assert.match(inspectorTsx, /onViewChanges\(run\.checkpointBefore\)/)
  assert.match(inspectorTsx, /onRevertRun\(run\)/)
  assert.match(paneTsx, /onStopFreeformRun=\{freeformCompletion\.stopRun\}/)
  assert.match(paneTsx, /history\.openDiffFromCheckpoint\(checkpoint\)/)
  assert.match(paneTsx, /state\.revertToCheckpoint\(run\.checkpointBefore\)/)
  assert.match(inspectorTsx, /designer\.freeform\.status\.running/)
  assert.doesNotMatch(freeformPanel, /targetAgentIds/)
  assert.doesNotMatch(freeformPanel, /gapCodes/)
})

test('business designer reloads watched document changes without overwriting dirty edits', () => {
  assert.match(controllerTs, /type FilesystemChangedPayload/)
  assert.match(controllerTs, /function isDesignerDocumentReloadPath\(documentId: string, path: string\): boolean/)
  assert.match(controllerTs, /const prefix = `\.gtoffice\/docs\/documents\/\$\{documentId\}\/`/)
  assert.match(controllerTs, /relative\.startsWith\('\.agent-runs\/'\)/)
  assert.match(controllerTs, /relative\.startsWith\('logs\/'\)/)
  assert.match(controllerTs, /relative\.endsWith\('\.log'\)/)
  assert.match(controllerTs, /relative\.endsWith\('\.tmp'\)/)
  assert.match(controllerTs, /desktopApi\.subscribeFilesystemEvents\(handleFilesystemChanged\)/)
  assert.match(controllerTs, /payload\.workspaceId !== workspaceId/)
  assert.match(controllerTs, /payload\.paths\.some\(\(path\) => isDesignerDocumentReloadPath\(selectedDocumentId, path\)\)/)
  assert.match(controllerTs, /dirtyRef\.current \|\| payload\.kind === 'removed'/)
  assert.match(controllerTs, /setNotice\(\{ kind: 'warning', text: 'externalChangePending' \}\)/)
  assert.match(controllerTs, /void loadDocument\(\)/)
  assert.match(statusbarTsx, /case 'externalChangePending':[\s\S]*designer\.externalChangePendingNotice/)
  assert.match(statusbarTsx, /notice\?\.text === 'externalChangePending'/)
  assert.match(statusbarTsx, /onSaveExternalChange/)
  assert.match(statusbarTsx, /onDiscardExternalChange/)
  assert.match(controllerTs, /discardLocalAndReload/)
  assert.match(controllerTs, /await loadDocument\(\)/)
  assert.match(paneTsx, /onSaveExternalChange=\{\(\) => \{[\s\S]*?void state\.save\(\)/)
  assert.match(paneTsx, /onDiscardExternalChange=\{\(\) => \{[\s\S]*?void state\.discardLocalAndReload\(\)/)
  assert.match(messagesTs, /'designer\.externalChangePendingNotice'/)
  assert.match(messagesTs, /'designer\.externalChange\.saveLocal'/)
  assert.match(messagesTs, /'designer\.externalChange\.discardLocal'/)
})

test('business designer agent task scope vocabulary is closed', () => {
  const preview = interfaceBlock(designerPatchTs, 'DesignerAgentTaskPreview')
  const patch = interfaceBlock(designerPatchTs, 'DesignerAgentPatch')
  const sharedPreviewRequest = interfaceBlock(sharedTypesTs, 'BusinessDesignerAgentTaskPreviewRequest')
  const sharedPreview = interfaceBlock(sharedTypesTs, 'BusinessDesignerAgentTaskPreview')
  const sharedPatch = interfaceBlock(sharedTypesTs, 'BusinessDesignerAgentPatch')
  const desktopPreview = interfaceBlock(desktopApiTs, 'BusinessDesignerAgentTaskPreview')
  const desktopPatch = interfaceBlock(desktopApiTs, 'BusinessDesignerAgentPatch')

  for (const source of [
    preview,
    patch,
    sharedPreviewRequest,
    sharedPreview,
    sharedPatch,
    desktopPreview,
    desktopPatch,
  ]) {
    assert.match(source, /scope\??: ['"]single['"] \| ['"]block['"](?: \| null)?/)
    assert.doesNotMatch(source, /scope\??: ['"]single['"] \| ['"]block['"] \| string/)
  }
})

test('business designer v1 agent commands use request-object IPC wrappers', () => {
  const runAgentCompletion = exportedFunctionBlock(designerDesktopApiTs, 'runDesignerAgentCompletion')
  const previewAgentTask = exportedFunctionBlock(designerDesktopApiTs, 'previewDesignerAgentTask')
  const runMockCompletion = exportedFunctionBlock(designerDesktopApiTs, 'runMockDesignerAgentCompletion')

  assert.match(
    desktopApiTs,
    /businessDesignerPreviewAgentTask\([\s\S]*?business_designer_preview_agent_task'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerRunAgentCompletion\([\s\S]*?business_designer_run_agent_completion'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerRunMockAgentCompletion\([\s\S]*?business_designer_run_mock_agent_completion'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerValidateAgentPatch\([\s\S]*?business_designer_validate_agent_patch'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,[\s\S]*?patch,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerRecoverAgentPatchFromTask\([\s\S]*?business_designer_recover_agent_patch_from_task'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,[\s\S]*?taskId,/,
  )
  assert.match(
    desktopApiTs,
    /businessDesignerApplyAgentPatch\([\s\S]*?business_designer_apply_agent_patch'[\s\S]*?request:\s*\{[\s\S]*?workspaceId,[\s\S]*?acceptedChangeIndices:/,
  )
  assert.match(runAgentCompletion, /targetAgentIds: string\[\]/)
  assert.doesNotMatch(runAgentCompletion, /targetAgentIds\?: string\[\]/)
  assert.doesNotMatch(runAgentCompletion, /selectedBlockIds/)
  assert.doesNotMatch(controllerTs, /runDesignerAgentCompletion\(workspaceId,[\s\S]*?selectedBlockIds/)
  for (const source of [previewAgentTask, runAgentCompletion, runMockCompletion]) {
    assert.match(source, /traceId: string/)
  }
  assert.match(desktopApiTs, /businessDesignerPreviewAgentTask\([\s\S]*?traceId: string[\s\S]*?traceId: params\.traceId/)
  assert.match(desktopApiTs, /businessDesignerRunAgentCompletion\([\s\S]*?traceId: string[\s\S]*?traceId: params\.traceId/)
  assert.match(desktopApiTs, /businessDesignerRunMockAgentCompletion\([\s\S]*?traceId: string[\s\S]*?traceId: params\.traceId/)
  assert.match(desktopApiTs, /businessDesignerValidateAgentPatch\([\s\S]*?traceId\?: string[\s\S]*?traceId: traceId \?\? null/)
  assert.match(desktopApiTs, /businessDesignerRecoverAgentPatchFromTask\([\s\S]*?traceId\?: string[\s\S]*?traceId: traceId \?\? null/)
  assert.match(desktopApiTs, /businessDesignerApplyAgentPatch\([\s\S]*?traceId\?: string[\s\S]*?traceId: traceId \?\? null/)
  assert.match(controllerTs, /previewDesignerAgentTask\(workspaceId, \{[\s\S]*?traceId,/)
  assert.match(controllerTs, /runMockDesignerAgentCompletion\(workspaceId, \{[\s\S]*?traceId,/)
  assert.match(controllerTs, /runDesignerAgentCompletion\(workspaceId, \{[\s\S]*?traceId,/)
  assert.match(controllerTs, /recoverDesignerAgentPatchFromTask\([\s\S]*?traceId,/)
  assert.match(controllerTs, /applyDesignerAgentPatch\([\s\S]*?traceId,/)
})

test('business designer agent dispatch preserves request id for audit', () => {
  assert.match(designerPatchTs, /export interface DesignerAgentTaskPreview \{[\s\S]*requestId: string/)
  assert.match(sharedTypesTs, /export interface BusinessDesignerAgentTaskPreview \{[\s\S]*requestId: string/)
  assert.match(desktopApiTs, /export interface BusinessDesignerAgentTaskPreview \{[\s\S]*requestId: string/)
  assert.match(desktopApiTs, /export interface BusinessDesignerAgentCompletionResult \{[\s\S]*requestId: string/)
  assert.match(inspectorTsx, /requestId: agentDispatch\.requestId/)
  assert.match(inspectorTsx, /agentDispatch\?\.documentId === preview\.documentId/)
})

test('business designer mock completion and real dispatch use explicit interfaces', () => {
  const runAgentCompletion = functionBlock('runAgentCompletion')
  const realDispatchApi = exportedFunctionBlock(designerDesktopApiTs, 'runDesignerAgentCompletion')
  const mockCompletionApi = exportedFunctionBlock(designerDesktopApiTs, 'runMockDesignerAgentCompletion')

  assert.match(realDispatchApi, /Promise<DesignerAgentCompletionDispatchResult>/)
  assert.match(mockCompletionApi, /Promise<DesignerPatchValidationResult>/)
  assert.doesNotMatch(designerDesktopApiTs, /DesignerPatchValidationResult \| DesignerAgentCompletionDispatchResult/)
  assert.match(runAgentCompletion, /if \(provider === 'mock'\)/)
  assert.match(runAgentCompletion, /runMockDesignerAgentCompletion/)
  assert.match(runAgentCompletion, /runDesignerAgentCompletion/)
  assert.doesNotMatch(runAgentCompletion, /'patch' in result/)
})

test('business designer v1 agent entry stays host-anchored in inspector', () => {
  const toolbarProps = interfaceBlock(toolbarTsx, 'DesignerToolbarProps')
  const toolbarRenderStart = toolbarTsx.indexOf('return (')
  assert.notEqual(toolbarRenderStart, -1, 'toolbar render should exist')
  const toolbarRender = toolbarTsx.slice(toolbarRenderStart)

  assert.doesNotMatch(toolbarProps, /Agent|agent|completion|preview|run/)
  assert.doesNotMatch(toolbarRender, /previewAgentTask|runAgentCompletion|onRunAgent|agentPreview/)
  assert.doesNotMatch(toolbarRender, /designer\.inspector\.fixGap|designer\.inspector\.fixBlock/)
  assert.match(inspectorTsx, /onFixGap\(blockId, gap\.code\)/)
  assert.match(inspectorTsx, /blockId=\{block\.id\}/)
  assert.match(inspectorTsx, /onFixBlock\(block\.id\)/)
  assert.match(paneTsx, /<DesignerToolbar[\s\S]*?onCreateBlock=\{onCreateBlock\}[\s\S]*?\/>/)
  assert.match(
    paneTsx,
    /<DesignerInspector[\s\S]*?onFixGap=\{onFixGap\}[\s\S]*?onFixBlock=\{onFixBlock\}/,
  )
})

test('business designer agent preview shows host payload context before dispatch', () => {
  assert.match(inspectorTsx, /const hostPayloadPreview = formatHostPayloadPreview\(preview\.hostBlock\?\.payload\)/)
  assert.match(inspectorTsx, /function formatHostPayloadPreview\(payload: unknown\): string/)
  assert.match(inspectorTsx, /JSON\.stringify\(payload, null, 2\)/)
  assert.match(inspectorTsx, /designer\.agentPreview\.hostPayload/)
  assert.match(inspectorTsx, /<pre>\{hostPayloadPreview\}<\/pre>/)
  assert.match(designerScss, /\.designer-agent-preview-payload \{[\s\S]*pre \{[\s\S]*overscroll-behavior: contain;/)
})

test('business designer inspector virtualizes gap lists', () => {
  assert.match(inspectorTsx, /import \{ useVirtualizer \} from '@tanstack\/react-virtual'/)
  assert.match(inspectorTsx, /function GapList\(/)
  assert.match(inspectorTsx, /const rowVirtualizer = useVirtualizer\(/)
  assert.match(inspectorTsx, /getScrollElement: \(\) => parentRef\.current/)
  assert.match(inspectorTsx, /overscan: 4/)
  assert.match(inspectorTsx, /rowVirtualizer\.getVirtualItems\(\)\.map/)
  assert.match(inspectorTsx, /ref=\{rowVirtualizer\.measureElement\}/)
  assert.match(designerScss, /\.designer-gap-virtual-list \{[\s\S]*overscroll-behavior: contain;/)
  assert.match(designerScss, /\.designer-gap-virtual-row \{[\s\S]*will-change: transform;/)
})
