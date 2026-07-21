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
  onOpenDrill: (blockId: string) => void
  onFixGap: (blockId: string, gapCode: string) => void
  onFixBlock: (blockId: string) => void
  onCreateEntityFromGap: (gap: DesignerGap) => void
  onConfirmAgentPreview: (provider: string, targetAgentIds: string[]) => void
  onReloadDocument: () => void
  onCancelAgentPreview: () => void
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
  onOpenDrill,
  onFixGap,
  onFixBlock,
  onCreateEntityFromGap,
  onConfirmAgentPreview,
  onReloadDocument,
  onCancelAgentPreview,
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
  const consistencyGaps = blockGaps.filter((gap) => gap.layer !== 'completeness')
  const completenessGaps = blockGaps.filter((gap) => gap.layer === 'completeness')
  const hasFixable = consistencyGaps.some((gap) => gap.fixableByAgent)
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
        {consistencyGaps.length === 0 && completenessGaps.length === 0 ? (
          <div className="designer-inspector-clean">
            <AppIcon name="check-circle" aria-hidden="true" />
            <span>{t(locale, 'designer.inspector.noGaps')}</span>
          </div>
        ) : (
          <>
            {consistencyGaps.length > 0 && (
              <GapList
                locale={locale}
                blockId={block.id}
                gaps={consistencyGaps}
                agentBusy={agentBusy}
                onFixGap={onFixGap}
                onCreateEntityFromGap={onCreateEntityFromGap}
              />
            )}
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
            {completenessGaps.length > 0 && (
              <section className="designer-inspector__completeness">
                <h4>{t(locale, 'designer.inspector.completenessTitle')}</h4>
                <ul className="designer-gap-list">
                  {completenessGaps.map((gap) => (
                    <li key={gap.id} className={`designer-gap-item is-${gap.severity}`}>
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
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
            onReload={onReloadDocument}
            onCancel={onCancelAgentPreview}
          />
        ) : null}
      </section>

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
  onReload,
  onCancel,
}: {
  locale: Locale
  preview: DesignerAgentTaskPreview
  agents: AgentProfile[]
  agentDispatch: DesignerAgentCompletionDispatchResult | null
  busy: boolean
  onConfirm: (provider: string, targetAgentIds: string[]) => void
  onReload: () => void
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
                onClick={onReload}
              >
                {t(locale, 'designer.agentPreview.reloadDocument')}
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
