import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import type { AgentProfile } from '@shell/integration/desktop-api'
import type { DesignerBlock } from '../model/designer-blocks'
import type {
  DesignerAgentCompletionDispatchResult,
  DesignerAgentTaskPreview,
} from '../model/designer-patch'
import type {
  DesignerFreeformCompletionProvider,
  DesignerFreeformCompletionRun,
  DesignerFreeformCompletionScenario,
} from '../model/designer-freeform-completion'
import type { DesignerDerivedEdge, DesignerGap } from '../model/designer-validation'

interface DesignerInspectorProps {
  locale: Locale
  block: DesignerBlock | null
  gaps: DesignerGap[]
  edges: DesignerDerivedEdge[]
  agentPreview: DesignerAgentTaskPreview | null
  agents: AgentProfile[]
  agentDispatch: DesignerAgentCompletionDispatchResult | null
  agentBusy: boolean
  freeformRuns: DesignerFreeformCompletionRun[]
  freeformRunLogs: Record<string, string>
  freeformLogLoadingRunId: string | null
  freeformBusy: boolean
  freeformError: string | null
  freeformProvider: DesignerFreeformCompletionProvider
  freeformProviderConfigured: boolean
  freeformProviderPending: boolean
  onOpenDrill: (blockId: string) => void
  onFixGap: (blockId: string, gapCode: string) => void
  onFixBlock: (blockId: string) => void
  onCreateEntityFromGap: (gap: DesignerGap) => void
  onConfirmAgentPreview: (provider: string, targetAgentIds: string[]) => void
  onRecoverAgentPatch: (taskId: string) => void
  onCancelAgentPreview: () => void
  onFreeformProviderChange: (provider: DesignerFreeformCompletionProvider) => void
  onConfirmFreeformProvider: () => void
  onStartFreeformCompletion: (params: {
    scenario: DesignerFreeformCompletionScenario
    hostBlockId?: string | null
    userPrompt?: string | null
  }) => void
  onRefreshFreeformRuns: () => void
  onReadFreeformRunLog: (run: DesignerFreeformCompletionRun) => void
  onStopFreeformRun: (run: DesignerFreeformCompletionRun) => void
  onViewFreeformChanges: (checkpoint: string) => void
  onRevertFreeformRun: (run: DesignerFreeformCompletionRun) => void
}

/**
 * Right column of the v1 workbench — shows the selected block's properties,
 * its gaps, and host-anchored Agent entry points. Empty state when nothing is
 * selected matches the §7.8 contract: one icon + one line, no skeleton.
 */
export const DesignerInspector = memo(function DesignerInspector({
  locale,
  block,
  gaps,
  edges,
  agentPreview,
  agents,
  agentDispatch,
  agentBusy,
  freeformRuns,
  freeformRunLogs,
  freeformLogLoadingRunId,
  freeformBusy,
  freeformError,
  freeformProvider,
  freeformProviderConfigured,
  freeformProviderPending,
  onOpenDrill,
  onFixGap,
  onFixBlock,
  onCreateEntityFromGap,
  onConfirmAgentPreview,
  onRecoverAgentPatch,
  onCancelAgentPreview,
  onFreeformProviderChange,
  onConfirmFreeformProvider,
  onStartFreeformCompletion,
  onRefreshFreeformRuns,
  onReadFreeformRunLog,
  onStopFreeformRun,
  onViewFreeformChanges,
  onRevertFreeformRun,
}: DesignerInspectorProps) {
  if (!block) {
    return (
      <aside className="designer-inspector" aria-label={t(locale, 'designer.inspector.label')}>
        <div className="designer-inspector-empty">
          <AppIcon name="info" aria-hidden="true" />
          <p>{t(locale, 'designer.inspector.empty')}</p>
        </div>
      </aside>
    )
  }

  const blockGaps = gaps.filter((gap) => gap.blockId === block.id)
  const hasFixable = blockGaps.some((gap) => gap.fixableByAgent)
  const adjacency = edges.filter(
    (edge) => edge.fromBlockId === block.id || edge.toBlockId === block.id,
  )

  return (
    <aside className="designer-inspector" aria-label={t(locale, 'designer.inspector.label')}>
      <header className="designer-inspector-header">
        <span className="designer-inspector-kind">{block.kind}</span>
        <h3 className="designer-inspector-title">{block.title || block.id}</h3>
        <div className="designer-inspector-id">{block.id}</div>
      </header>

      <section className="designer-inspector-section">
        <div className="designer-inspector-section-label">
          <span>{t(locale, 'designer.inspector.gaps')}</span>
          <div className="designer-inspector-section-actions">
            <button
              type="button"
              className="designer-inspector-drill-btn"
              onClick={() => onOpenDrill(block.id)}
              aria-label={t(locale, 'designer.inspector.openDrill')}
            >
              <AppIcon name="panel-right-open" aria-hidden="true" />
              {t(locale, 'designer.inspector.openDrill')}
            </button>
          </div>
        </div>
        {blockGaps.length === 0 ? (
          <div className="designer-inspector-clean">
            <AppIcon name="check-circle" aria-hidden="true" />
            <span>{t(locale, 'designer.inspector.noGaps')}</span>
          </div>
        ) : (
          <>
            <GapList
              locale={locale}
              blockId={block.id}
              gaps={blockGaps}
              agentBusy={agentBusy}
              onFixGap={onFixGap}
              onCreateEntityFromGap={onCreateEntityFromGap}
            />
            {hasFixable ? (
              <div className="designer-gap-block-action">
                <button
                  type="button"
                  className="designer-gap-fix designer-gap-fix--accent"
                  onClick={() => onFixBlock(block.id)}
                  disabled={agentBusy}
                >
                  {t(locale, 'designer.inspector.fixBlock')}
                </button>
              </div>
            ) : null}
          </>
        )}
        {agentPreview && agentPreview.hostBlockId === block.id ? (
          <AgentPreviewPanel
            locale={locale}
            preview={agentPreview}
            agents={agents}
            agentDispatch={agentDispatch}
            busy={agentBusy}
            onConfirm={onConfirmAgentPreview}
            onRecover={onRecoverAgentPatch}
            onCancel={onCancelAgentPreview}
          />
        ) : null}
      </section>

      <FreeformCompletionPanel
        locale={locale}
        block={block}
        runs={freeformRuns}
        runLogs={freeformRunLogs}
        logLoadingRunId={freeformLogLoadingRunId}
        busy={freeformBusy}
        error={freeformError}
        provider={freeformProvider}
        providerConfigured={freeformProviderConfigured}
        providerPending={freeformProviderPending}
        onProviderChange={onFreeformProviderChange}
        onConfirmProvider={onConfirmFreeformProvider}
        onStart={onStartFreeformCompletion}
        onRefresh={onRefreshFreeformRuns}
        onReadLog={onReadFreeformRunLog}
        onStopRun={onStopFreeformRun}
        onViewChanges={onViewFreeformChanges}
        onRevertRun={onRevertFreeformRun}
      />

      {adjacency.length > 0 ? (
        <section className="designer-inspector-section">
          <div className="designer-inspector-section-label">
            {t(locale, 'designer.inspector.adjacency')}
          </div>
          <ul className="designer-gap-list">
            {adjacency.map((edge, index) => (
              <li
                key={`${edge.fromBlockId}-${edge.toBlockId}-${edge.relation}-${index}`}
                className="designer-gap-item"
              >
                <div className="designer-gap-row">
                  <span className="designer-gap-text">
                    <span className="designer-gap-message">
                      {edge.fromBlockId === block.id
                        ? `→ ${edge.toBlockId}`
                        : `← ${edge.fromBlockId}`}
                    </span>
                    <code className="designer-gap-code">{edge.relation}</code>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </aside>
  )
})

function FreeformCompletionPanel({
  locale,
  block,
  runs,
  runLogs,
  logLoadingRunId,
  busy,
  error,
  provider,
  providerConfigured,
  providerPending,
  onProviderChange,
  onConfirmProvider,
  onStart,
  onRefresh,
  onReadLog,
  onStopRun,
  onViewChanges,
  onRevertRun,
}: {
  locale: Locale
  block: DesignerBlock
  runs: DesignerFreeformCompletionRun[]
  runLogs: Record<string, string>
  logLoadingRunId: string | null
  busy: boolean
  error: string | null
  provider: DesignerFreeformCompletionProvider
  providerConfigured: boolean
  providerPending: boolean
  onProviderChange: (provider: DesignerFreeformCompletionProvider) => void
  onConfirmProvider: () => void
  onStart: (params: {
    scenario: DesignerFreeformCompletionScenario
    hostBlockId?: string | null
    userPrompt?: string | null
  }) => void
  onRefresh: () => void
  onReadLog: (run: DesignerFreeformCompletionRun) => void
  onStopRun: (run: DesignerFreeformCompletionRun) => void
  onViewChanges: (checkpoint: string) => void
  onRevertRun: (run: DesignerFreeformCompletionRun) => void
}) {
  const scenario = scenarioForBlock(block)
  const [userPrompt, setUserPrompt] = useState('')
  const latestRuns = runs.slice(0, 4)

  function handleSubmit() {
    onStart({
      scenario,
      hostBlockId: block.id,
      userPrompt: userPrompt.trim() || null,
    })
    setUserPrompt('')
  }

  return (
    <section className="designer-inspector-section designer-freeform">
      <div className="designer-inspector-section-label">
        <span>{t(locale, 'designer.freeform.title')}</span>
        <div className="designer-inspector-section-actions">
          <button
            type="button"
            className="designer-inspector-drill-btn"
            onClick={onRefresh}
            disabled={busy}
            aria-label={t(locale, 'designer.freeform.refreshRuns')}
          >
            <AppIcon name="refresh" aria-hidden="true" />
            {t(locale, 'designer.freeform.refreshRuns')}
          </button>
        </div>
      </div>
      <div className="designer-freeform-controls">
        <label className="designer-agent-preview-field">
          <span>{t(locale, 'designer.freeform.provider')}</span>
          <select
            value={provider}
            disabled={busy}
            onChange={(event) =>
              onProviderChange(event.target.value === 'claude' ? 'claude' : 'codex')
            }
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        {!providerConfigured ? (
          <div className="designer-freeform-provider-setup" role="status">
            <span>
              {providerPending
                ? t(locale, 'designer.freeform.providerSetupPending')
                : t(locale, 'designer.freeform.providerSetup')}
            </span>
            <button
              type="button"
              className="designer-gap-fix"
              disabled={busy}
              onClick={onConfirmProvider}
            >
              {t(locale, 'designer.freeform.providerConfirm')}
            </button>
          </div>
        ) : null}
        <label className="designer-freeform-prompt">
          <span>{t(locale, 'designer.freeform.userPrompt')}</span>
          <textarea
            value={userPrompt}
            disabled={busy}
            spellCheck={false}
            rows={3}
            placeholder={t(locale, 'designer.freeform.userPromptPlaceholder')}
            onChange={(event) => setUserPrompt(event.target.value)}
          />
        </label>
      </div>
      <div className="designer-freeform-actions">
        <button
          type="button"
          className="designer-gap-fix designer-gap-fix--accent"
          disabled={busy}
          onClick={handleSubmit}
        >
          <AppIcon name="sparkles" aria-hidden="true" />
          {t(locale, scenarioButtonKey(scenario))}
        </button>
      </div>
      {error ? (
        <div className="designer-freeform-error" role="alert">
          <AppIcon name="alert-circle" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      <FreeformRunList
        locale={locale}
        runs={latestRuns}
        runLogs={runLogs}
        logLoadingRunId={logLoadingRunId}
        busy={busy}
        onReadLog={onReadLog}
        onStopRun={onStopRun}
        onViewChanges={onViewChanges}
        onRevertRun={onRevertRun}
      />
    </section>
  )
}

function scenarioForBlock(block: DesignerBlock): DesignerFreeformCompletionScenario {
  if (block.id === 'brief') {
    return 'brief_to_design'
  }
  if (block.kind === 'entityModel') {
    return 'complete_entity'
  }
  if (block.kind === 'businessFlow') {
    return 'complete_flow'
  }
  if (block.kind === 'apiContract') {
    return 'complete_api_contract'
  }
  return 'expand_canvas'
}

function scenarioButtonKey(
  scenario: DesignerFreeformCompletionScenario,
):
  | 'designer.freeform.briefToDesign'
  | 'designer.freeform.completeEntity'
  | 'designer.freeform.completeFlow'
  | 'designer.freeform.completeApiContract'
  | 'designer.freeform.expandCanvas' {
  switch (scenario) {
    case 'brief_to_design':
      return 'designer.freeform.briefToDesign'
    case 'complete_entity':
      return 'designer.freeform.completeEntity'
    case 'complete_flow':
      return 'designer.freeform.completeFlow'
    case 'complete_api_contract':
      return 'designer.freeform.completeApiContract'
    case 'expand_canvas':
      return 'designer.freeform.expandCanvas'
  }
}

function FreeformRunList({
  locale,
  runs,
  runLogs,
  logLoadingRunId,
  busy,
  onReadLog,
  onStopRun,
  onViewChanges,
  onRevertRun,
}: {
  locale: Locale
  runs: DesignerFreeformCompletionRun[]
  runLogs: Record<string, string>
  logLoadingRunId: string | null
  busy: boolean
  onReadLog: (run: DesignerFreeformCompletionRun) => void
  onStopRun: (run: DesignerFreeformCompletionRun) => void
  onViewChanges: (checkpoint: string) => void
  onRevertRun: (run: DesignerFreeformCompletionRun) => void
}) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  if (runs.length === 0) {
    return <p className="designer-agent-preview-empty">{t(locale, 'designer.freeform.noRuns')}</p>
  }
  return (
    <ul className="designer-freeform-runs" aria-label={t(locale, 'designer.freeform.latestRuns')}>
      {runs.map((run) => (
        <li key={run.requestId} className={`designer-freeform-run is-${run.status}`}>
          <div className="designer-freeform-run-main">
            <span className="designer-freeform-run-status">
              {t(locale, freeformStatusKey(run.status))}
            </span>
            <span className="designer-freeform-run-provider">{run.provider}</span>
          </div>
          <div className="designer-freeform-run-meta">
            {run.sessionId} · {run.checkpointBefore}
          </div>
          {run.userPromptSummary ? (
            <div className="designer-freeform-run-summary">{run.userPromptSummary}</div>
          ) : null}
          <div className="designer-freeform-run-actions">
            <button
              type="button"
              className="designer-gap-fix"
              disabled={logLoadingRunId === run.requestId}
              aria-expanded={expandedRunId === run.requestId}
              onClick={() => {
                const nextExpanded = expandedRunId === run.requestId ? null : run.requestId
                setExpandedRunId(nextExpanded)
                if (nextExpanded && !runLogs[run.requestId]) {
                  onReadLog(run)
                }
              }}
            >
              {logLoadingRunId === run.requestId
                ? t(locale, 'designer.freeform.loadingLog')
                : t(locale, 'designer.freeform.viewLog')}
            </button>
            <button
              type="button"
              className="designer-gap-fix"
              onClick={() => onViewChanges(run.checkpointBefore)}
            >
              {t(locale, 'designer.freeform.viewChanges')}
            </button>
            {run.status === 'running' ? (
              <button
                type="button"
                className="designer-gap-fix"
                disabled={busy}
                onClick={() => onStopRun(run)}
              >
                {t(locale, 'designer.freeform.stopRun')}
              </button>
            ) : null}
            <button
              type="button"
              className="designer-gap-fix"
              disabled={busy || run.status === 'running'}
              onClick={() => onRevertRun(run)}
            >
              {t(locale, 'designer.freeform.revert')}
            </button>
          </div>
          {expandedRunId === run.requestId ? (
            <pre className="designer-freeform-run-log">
              {runLogs[run.requestId] || t(locale, 'designer.freeform.noLog')}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function freeformStatusKey(
  status: DesignerFreeformCompletionRun['status'],
):
  | 'designer.freeform.status.running'
  | 'designer.freeform.status.completed'
  | 'designer.freeform.status.failed'
  | 'designer.freeform.status.cancelled' {
  switch (status) {
    case 'completed':
      return 'designer.freeform.status.completed'
    case 'failed':
      return 'designer.freeform.status.failed'
    case 'cancelled':
      return 'designer.freeform.status.cancelled'
    case 'running':
      return 'designer.freeform.status.running'
  }
}

const GAP_ROW_ESTIMATE_PX = 92

function GapList({
  locale,
  blockId,
  gaps,
  agentBusy,
  onFixGap,
  onCreateEntityFromGap,
}: {
  locale: Locale
  blockId: string
  gaps: DesignerGap[]
  agentBusy: boolean
  onFixGap: (blockId: string, gapCode: string) => void
  onCreateEntityFromGap: (gap: DesignerGap) => void
}) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const rowVirtualizer = useVirtualizer({
    count: gaps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => GAP_ROW_ESTIMATE_PX,
    getItemKey: (index) => gaps[index]?.id ?? index,
    overscan: 4,
  })

  return (
    <div
      ref={parentRef}
      className="designer-gap-virtual-list"
      role="list"
      aria-label={t(locale, 'designer.inspector.gaps')}
    >
      <div
        className="designer-gap-virtual-spacer"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const gap = gaps[virtualItem.index]
          if (!gap) return null
          return (
            <div
              key={virtualItem.key}
              className="designer-gap-virtual-row"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
            >
              <GapListItem
                locale={locale}
                blockId={blockId}
                gap={gap}
                agentBusy={agentBusy}
                onFixGap={onFixGap}
                onCreateEntityFromGap={onCreateEntityFromGap}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GapListItem({
  locale,
  blockId,
  gap,
  agentBusy,
  onFixGap,
  onCreateEntityFromGap,
}: {
  locale: Locale
  blockId: string
  gap: DesignerGap
  agentBusy: boolean
  onFixGap: (blockId: string, gapCode: string) => void
  onCreateEntityFromGap: (gap: DesignerGap) => void
}) {
  return (
    <div role="listitem" className={`designer-gap-item is-${gap.severity}`}>
      <div className="designer-gap-row">
        <AppIcon
          name={gap.severity === 'error' ? 'alert-circle' : 'alert-triangle'}
          className="designer-gap-icon"
          aria-hidden="true"
        />
        <div className="designer-gap-text">
          <div className="designer-gap-message">{gap.message}</div>
          <code className="designer-gap-code">{gap.code}</code>
        </div>
      </div>
      {gap.fixableByAgent ? (
        <div className="designer-gap-actions">
          <button
            type="button"
            className="designer-gap-fix"
            onClick={() => onFixGap(blockId, gap.code)}
            disabled={agentBusy}
          >
            {t(locale, 'designer.inspector.fixGap')}
          </button>
        </div>
      ) : gap.code === 'dangling-ref' && gap.locator?.ref ? (
        <div className="designer-gap-actions">
          <button
            type="button"
            className="designer-gap-fix"
            onClick={() => onCreateEntityFromGap(gap)}
            disabled={agentBusy}
          >
            <AppIcon name="plus" aria-hidden="true" />
            {t(locale, 'designer.inspector.createEntityFromGap', {
              name: gap.locator.ref,
            })}
          </button>
        </div>
      ) : (
        <div className="designer-gap-actions">
          <span className="designer-gap-code">{t(locale, 'designer.gap.unfixable')}</span>
        </div>
      )}
    </div>
  )
}

function AgentPreviewPanel({
  locale,
  preview,
  agents,
  agentDispatch,
  busy,
  onConfirm,
  onRecover,
  onCancel,
}: {
  locale: Locale
  preview: DesignerAgentTaskPreview
  agents: AgentProfile[]
  agentDispatch: DesignerAgentCompletionDispatchResult | null
  busy: boolean
  onConfirm: (provider: string, targetAgentIds: string[]) => void
  onRecover: (taskId: string) => void
  onCancel: () => void
}) {
  const hasTargetGaps = preview.targetGaps.length > 0
  const ready = preview.status === 'ready' && hasTargetGaps
  const adjacency = preview.adjacency ?? []
  const providers = ['mock', 'codex', 'claude']
  const [provider, setProvider] = useState(preview.provider || 'mock')
  const eligibleAgents = useMemo(
    () =>
      provider === 'mock'
        ? []
        : agents.filter((agent) => agent.state !== 'terminated' && agent.tool === provider),
    [agents, provider],
  )
  const [targetAgentId, setTargetAgentId] = useState('')
  const previewRef = useRef<HTMLDivElement | null>(null)
  const requiresTarget = provider !== 'mock'
  const canConfirm = ready && !busy && (!requiresTarget || targetAgentId.length > 0)
  const dispatchTask = agentDispatch?.dispatch.results.find((result) => result.status === 'sent')
  const hostPayloadPreview = formatHostPayloadPreview(preview.hostBlock?.payload)

  useEffect(() => {
    setProvider(preview.provider || 'mock')
    setTargetAgentId('')
  }, [preview])

  useEffect(() => {
    if (provider === 'mock') {
      setTargetAgentId('')
      return
    }
    setTargetAgentId((current) =>
      current && eligibleAgents.some((agent) => agent.id === current)
        ? current
        : (eligibleAgents[0]?.id ?? ''),
    )
  }, [eligibleAgents, provider])

  useEffect(() => {
    const firstControl =
      previewRef.current?.querySelector<HTMLSelectElement>('select:not(:disabled)') ??
      previewRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    firstControl?.focus()
  }, [preview.requestId])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    onCancel()
  }

  return (
    <div
      ref={previewRef}
      className="designer-agent-preview"
      role="region"
      aria-label={t(locale, 'designer.agentPreview.title')}
      onKeyDown={handleKeyDown}
    >
      <div className="designer-agent-preview-head">
        <AppIcon name={ready ? 'sparkles' : 'info'} aria-hidden="true" />
        <div>
          <div className="designer-agent-preview-title">
            {t(locale, 'designer.agentPreview.title')}
          </div>
          <div className="designer-agent-preview-meta">
            {preview.hostBlockId} · {preview.scope}
          </div>
        </div>
      </div>

      {ready ? (
        <>
          <div className="designer-agent-preview-controls">
            <label className="designer-agent-preview-field">
              <span>{t(locale, 'designer.agentPreview.provider')}</span>
              <select
                value={provider}
                disabled={busy}
                onChange={(event) => setProvider(event.target.value)}
              >
                {providers.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {requiresTarget ? (
              <label className="designer-agent-preview-field">
                <span>{t(locale, 'designer.agentPreview.targetAgent')}</span>
                <select
                  value={targetAgentId}
                  disabled={busy || eligibleAgents.length === 0}
                  onChange={(event) => setTargetAgentId(event.target.value)}
                >
                  {eligibleAgents.length === 0 ? (
                    <option value="">{t(locale, 'designer.agentPreview.noTargetAgents')}</option>
                  ) : null}
                  {eligibleAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <PreviewList
            label={t(locale, 'designer.agentPreview.targetGaps')}
            values={preview.targetGaps.map((gap) => `${gap.code}: ${gap.message}`)}
          />
          <div className="designer-agent-preview-payload">
            <div className="designer-agent-preview-list-label">
              {t(locale, 'designer.agentPreview.hostPayload')}
            </div>
            <pre>{hostPayloadPreview}</pre>
          </div>
          <PreviewList
            label={t(locale, 'designer.agentPreview.contextGaps')}
            values={preview.contextGaps.map((gap) => `${gap.code}: ${gap.message}`)}
            empty={t(locale, 'designer.agentPreview.none')}
          />
          <PreviewList
            label={t(locale, 'designer.agentPreview.adjacency')}
            values={adjacency.map((edge) => `${edge.fromBlockId} → ${edge.toBlockId} · ${edge.relation}`)}
            empty={t(locale, 'designer.agentPreview.none')}
          />
          {agentDispatch?.documentId === preview.documentId && dispatchTask ? (
            <div className="designer-agent-dispatch-note">
              <AppIcon name="check-circle" aria-hidden="true" />
              <span>
                {t(locale, 'designer.agentPreview.dispatched', {
                  taskId: dispatchTask.taskId,
                  requestId: agentDispatch.requestId,
                })}
              </span>
              <button
                type="button"
                className="designer-gap-fix"
                disabled={busy}
                onClick={() => onRecover(dispatchTask.taskId)}
              >
                {t(locale, 'designer.agentPreview.recoverPatch')}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="designer-agent-preview-empty">
          {preview.status === 'ready'
            ? t(locale, 'designer.agentPreview.noTargetGaps')
            : t(locale, 'designer.agentPreview.noFixableGaps')}
        </p>
      )}

      <div className="designer-agent-preview-actions">
        <button
          type="button"
          className="designer-gap-fix designer-gap-fix--accent"
          disabled={!canConfirm}
          onClick={() => onConfirm(provider, requiresTarget ? [targetAgentId] : [])}
        >
          {t(locale, 'designer.agentPreview.confirm')}
        </button>
        <button
          type="button"
          className="designer-gap-fix"
          disabled={busy}
          onClick={onCancel}
        >
          {t(locale, 'designer.agentPreview.cancel')}
        </button>
      </div>
    </div>
  )
}

function formatHostPayloadPreview(payload: unknown): string {
  if (payload === undefined || payload === null) {
    return '{}'
  }
  try {
    return JSON.stringify(payload, null, 2) ?? '{}'
  } catch {
    return '{}'
  }
}

function PreviewList({
  label,
  values,
  empty,
}: {
  label: string
  values: string[]
  empty?: string
}) {
  return (
    <div className="designer-agent-preview-list">
      <div className="designer-agent-preview-list-label">{label}</div>
      {values.length > 0 ? (
        <ul>
          {values.map((value, index) => (
            <li key={`${value}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : (
        <div className="designer-agent-preview-empty">{empty}</div>
      )}
    </div>
  )
}
