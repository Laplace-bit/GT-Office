import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  X,
  Pencil,
  Plus,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  buildCustomCommandCapsuleOrderId,
  buildNextOrderedCommandCapsuleIdsForCustomSave,
  buildPresetCommandCapsuleOrderId,
  commandRailProviderCommandOptionsByProvider,
  isQuickCommandRailVisible,
  loadUiPreferences,
  saveUiPreferences,
  setQuickCommandRailVisibility,
  UI_PREFERENCES_UPDATED_EVENT,
  type CommandCapsuleSubmitMode,
  type CommandRailProviderId,
  type CustomCommandCapsule,
  type UiPreferences,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandMetadata,
} from '@shell/state/ui-preferences'

import './ProviderQuickCommands.scss'

interface ProviderQuickCommandsProps {
  locale: Locale
  providerId: CommandRailProviderId
}

interface PresetCapsuleItem {
  kind: 'preset'
  id: string
  orderId: string
  label: string
  description: string
  enabled: boolean
  submitMode: CommandCapsuleSubmitMode
}

interface CustomCapsuleItem {
  kind: 'custom'
  id: string
  orderId: string
  label: string
  description: string
  text: string
  submitMode: CommandCapsuleSubmitMode
}

type ProviderCapsuleItem = PresetCapsuleItem | CustomCapsuleItem

interface ActiveDragState {
  id: string
  width?: number
  height?: number
}

function dedupeCommandIds(commandIds: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  commandIds.forEach((id) => {
    if (id && !seen.has(id)) {
      seen.add(id)
      result.push(id)
    }
  })
  return result
}

function reconcileOrderedCapsuleIds(
  orderIds: string[],
  pinnedCommandIds: string[],
  customCapsules: CustomCommandCapsule[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const allowed = new Set<string>([
    ...pinnedCommandIds.map((id) => buildPresetCommandCapsuleOrderId(id)),
    ...customCapsules.map((c) => buildCustomCommandCapsuleOrderId(c.id)),
  ])

  orderIds.forEach((id) => {
    if (id && !seen.has(id) && allowed.has(id)) {
      seen.add(id)
      result.push(id)
    }
  })

  pinnedCommandIds.forEach((id) => {
    const orderId = buildPresetCommandCapsuleOrderId(id)
    if (!seen.has(orderId)) {
      seen.add(orderId)
      result.push(orderId)
    }
  })

  return result
}

function createCustomCapsuleId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).toLowerCase()
}

function createCustomCapsuleTimestamp(): number {
  return Date.now()
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function areCustomCapsulesEqual(left: CustomCommandCapsule[], right: CustomCommandCapsule[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index]
    const rightItem = right[index]
    if (
      leftItem.id !== rightItem.id ||
      leftItem.label !== rightItem.label ||
      leftItem.text !== rightItem.text ||
      leftItem.submitMode !== rightItem.submitMode ||
      leftItem.createdAt !== rightItem.createdAt
    ) {
      return false
    }
  }
  return true
}

function updateQuickCommandPreferences(updater: (current: UiPreferences) => UiPreferences): void {
  const current = loadUiPreferences()
  saveUiPreferences(updater(current))
  window.dispatchEvent(new Event(UI_PREFERENCES_UPDATED_EVENT))
}

function CapsuleContent({ item }: { item: ProviderCapsuleItem }) {
  return (
    <>
      <span className="capsule-label">{item.label}</span>
      <span className="capsule-tag">{item.submitMode === 'insert_and_submit' ? 'Auto' : 'Ins'}</span>
    </>
  )
}

interface SortableCapsuleProps {
  item: ProviderCapsuleItem
  isHovered: boolean
  onHover: (id: string | null) => void
  onEdit: (item: CustomCapsuleItem) => void
  onRemove: (item: ProviderCapsuleItem) => void
}

function SortableCapsule({ item, isHovered, onHover, onEdit, onRemove }: SortableCapsuleProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.orderId })

  return (
    <div
      ref={setNodeRef}
      className={`command-capsule is-active${isDragging ? ' is-dragging' : ''}`}
      onMouseEnter={() => onHover(item.orderId)}
      onMouseLeave={() => onHover(null)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <div
        ref={setActivatorNodeRef}
        className="command-capsule__drag-hitbox"
        {...attributes}
        {...listeners}
      >
        <CapsuleContent item={item} />
      </div>

      {!isDragging ? (
        <div className="capsule-actions">
          {item.kind === 'custom' ? (
            <button
              type="button"
              className="action-icon"
              onClick={(event) => {
                event.stopPropagation()
                onEdit(item)
              }}
            >
              <Pencil size={12} />
            </button>
          ) : null}
          <button
            type="button"
            className="action-icon danger"
            onClick={(event) => {
              event.stopPropagation()
              onRemove(item)
            }}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </div>
      ) : null}

      {isHovered && !isDragging ? (
        <div className="capsule-tooltip">{item.description}</div>
      ) : null}
    </div>
  )
}

export function ProviderQuickCommands({ locale, providerId }: ProviderQuickCommandsProps) {
  const [isVisible, setIsVisible] = useState<boolean>(() => isQuickCommandRailVisible(providerId, loadUiPreferences()))
  const [pinnedCommandIds, setPinnedCommandIds] = useState<string[]>([])
  const [customCapsules, setCustomCapsules] = useState<CustomCommandCapsule[]>([])
  const [orderedCommandCapsuleIds, setOrderedCommandCapsuleIds] = useState<string[]>([])
  const [hoveredOrderId, setHoveredOrderId] = useState<string | null>(null)
  const [activeDrag, setActiveDrag] = useState<ActiveDragState | null>(null)
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftSubmitMode, setDraftSubmitMode] = useState<CommandCapsuleSubmitMode>('insert')

  useEffect(() => {
    const sync = () => {
      const prefs = loadUiPreferences()
      const nextVisible = isQuickCommandRailVisible(providerId, prefs)
      const nextPinned = prefs.pinnedCommandIdsByProvider[providerId] ?? []
      const nextCustom = prefs.customCommandCapsulesByProvider[providerId] ?? []
      const nextOrdered = prefs.orderedCommandCapsuleIdsByProvider[providerId] ?? []

      setIsVisible((prev) => (prev === nextVisible ? prev : nextVisible))
      setPinnedCommandIds((prev) => (areStringArraysEqual(prev, nextPinned) ? prev : nextPinned))
      setCustomCapsules((prev) => (areCustomCapsulesEqual(prev, nextCustom) ? prev : nextCustom))
      setOrderedCommandCapsuleIds((prev) =>
        areStringArraysEqual(prev, nextOrdered) ? prev : nextOrdered,
      )
    }
    sync()
    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, sync)
    return () => window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, sync)
  }, [providerId])

  const normalizedPinned = useMemo(() => dedupeCommandIds(pinnedCommandIds), [pinnedCommandIds])
  const normalizedOrdered = useMemo(
    () => reconcileOrderedCapsuleIds(orderedCommandCapsuleIds, normalizedPinned, customCapsules),
    [customCapsules, normalizedPinned, orderedCommandCapsuleIds]
  )

  const presetItems = useMemo<PresetCapsuleItem[]>(
    () => (commandRailProviderCommandOptionsByProvider[providerId] ?? []).map(opt => {
      const metadata = resolveQuickCommandMetadata(providerId, opt.id)
      return {
        kind: 'preset',
        id: opt.id,
        orderId: buildPresetCommandCapsuleOrderId(opt.id),
        label: opt.label,
        description: t(locale, metadata.descriptionKey),
        enabled: normalizedPinned.includes(opt.id),
        submitMode: metadata.submitMode
      }
    }),
    [locale, normalizedPinned, providerId]
  )

  const customItems = useMemo<CustomCapsuleItem[]>(
    () => customCapsules.map(c => ({
      kind: 'custom',
      id: c.id,
      orderId: buildCustomCommandCapsuleOrderId(c.id),
      label: c.label,
      description: c.text,
      text: c.text,
      submitMode: c.submitMode
    })),
    [customCapsules]
  )

  const capsuleByOrderId = useMemo(() => {
    const map = new Map<string, ProviderCapsuleItem>()
    presetItems.forEach(i => map.set(i.orderId, i))
    customItems.forEach(i => map.set(i.orderId, i))
    return map
  }, [customItems, presetItems])

  const enabledCapsules = useMemo(
    () => normalizedOrdered.map(id => capsuleByOrderId.get(id)).filter((i): i is ProviderCapsuleItem => !!i),
    [capsuleByOrderId, normalizedOrdered]
  )
  const activeItem = activeDrag ? capsuleByOrderId.get(activeDrag.id) ?? null : null

  const providerCopy = quickCommandProviderCopyByProvider[providerId]

  const persist = (nextPinned: string[], nextCustom: CustomCommandCapsule[], nextOrdered: string[]) => {
    updateQuickCommandPreferences(curr => ({
      ...curr,
      pinnedCommandIdsByProvider: { ...curr.pinnedCommandIdsByProvider, [providerId]: nextPinned },
      customCommandCapsulesByProvider: { ...curr.customCommandCapsulesByProvider, [providerId]: nextCustom },
      orderedCommandCapsuleIdsByProvider: { ...curr.orderedCommandCapsuleIdsByProvider, [providerId]: nextOrdered }
    }))
  }

  const togglePreset = (id: string) => {
    const next = normalizedPinned.includes(id) ? normalizedPinned.filter(i => i !== id) : [...normalizedPinned, id]
    persist(next, customCapsules, normalizedOrdered)
  }

  const toggleCustom = (id: string) => {
    const orderId = buildCustomCommandCapsuleOrderId(id)
    const next = normalizedOrdered.includes(orderId) ? normalizedOrdered.filter(i => i !== orderId) : [...normalizedOrdered, orderId]
    persist(normalizedPinned, customCapsules, next)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    const initialRect = event.active.rect.current.initial
    setHoveredOrderId(null)
    setActiveDrag({
      id,
      width: initialRect?.width,
      height: initialRect?.height,
    })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null)
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const oldIndex = normalizedOrdered.indexOf(String(active.id))
    const newIndex = normalizedOrdered.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
      return
    }
    persist(normalizedPinned, customCapsules, arrayMove(normalizedOrdered, oldIndex, newIndex))
  }

  const handleDragCancel = () => {
    setActiveDrag(null)
  }

  const saveCustom = (mode: 'save-and-add' | 'save-only') => {
    if (!draftLabel.trim() || !draftText.trim()) return
    const id = editingCustomId ?? createCustomCapsuleId()
    const existingCreatedAt = customCapsules.find(c => c.id === id)?.createdAt
    const capsule: CustomCommandCapsule = {
      id,
      label: draftLabel.trim(),
      text: draftText.trim(),
      submitMode: draftSubmitMode,
      createdAt: existingCreatedAt ?? createCustomCapsuleTimestamp()
    }
    const nextCustom = editingCustomId ? customCapsules.map(c => c.id === id ? capsule : c) : [...customCapsules, capsule]
    const nextOrdered = buildNextOrderedCommandCapsuleIdsForCustomSave(normalizedOrdered, id, mode)
    persist(normalizedPinned, nextCustom, nextOrdered)
    closeComposer()
  }

  const beginEdit = (item: CustomCapsuleItem) => {
    setEditingCustomId(item.id)
    setDraftLabel(item.label)
    setDraftText(item.text)
    setDraftSubmitMode(item.submitMode)
    setIsComposerOpen(true)
  }

  const closeComposer = () => {
    setIsComposerOpen(false)
    setEditingCustomId(null)
    setDraftLabel('')
    setDraftText('')
    setDraftSubmitMode('insert')
  }

  return (
    <section className="provider-quick-commands">
      <header className="provider-quick-commands__header">
        <div className="provider-quick-commands__header-copy">
          <strong>{t(locale, 'quickCommands.section.title')}</strong>
          <span>{t(locale, providerCopy.descriptionKey)}</span>
        </div>
        <div className="provider-quick-commands__header-meta">
          <span className="provider-quick-commands__count">
            {t(locale, 'quickCommands.section.count', { count: String(enabledCapsules.length) })}
          </span>
          <button
            className={`provider-quick-commands__switch ${isVisible ? 'is-on' : ''}`}
            onClick={() => updateQuickCommandPreferences(curr => setQuickCommandRailVisibility(providerId, !isVisible, curr))}
          >
            <span className="provider-quick-commands__switch-thumb" />
          </button>
        </div>
      </header>

      <div className="provider-quick-commands__panel">
        <section className="provider-quick-commands__section">
          <div className="provider-quick-commands__section-head">
            <strong>{t(locale, 'quickCommands.preview.title')}</strong>
            <span>{t(locale, 'quickCommands.preview.reorder')}</span>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={normalizedOrdered} strategy={rectSortingStrategy}>
              <div className="capsule-group">
                {enabledCapsules.map((item) => (
                  <SortableCapsule
                    key={item.orderId}
                    item={item}
                    isHovered={hoveredOrderId === item.orderId}
                    onHover={setHoveredOrderId}
                    onEdit={beginEdit}
                    onRemove={(nextItem) => nextItem.kind === 'preset' ? togglePreset(nextItem.id) : toggleCustom(nextItem.id)}
                  />
                ))}
                <button className="command-capsule is-disabled" onClick={() => setIsComposerOpen(true)}>
                  <Plus size={14} />
                  <span>{t(locale, 'quickCommands.custom.add')}</span>
                </button>
              </div>
            </SortableContext>
            {typeof document !== 'undefined'
              ? createPortal(
                  <DragOverlay
                    adjustScale={false}
                    zIndex={20002}
                    dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}
                  >
                    {activeItem ? (
                      <div
                        className="drag-overlay-capsule"
                        style={{
                          width: activeDrag?.width,
                          minHeight: activeDrag?.height,
                        }}
                      >
                        <CapsuleContent item={activeItem} />
                      </div>
                    ) : null}
                  </DragOverlay>,
                  document.body,
                )
              : null}
          </DndContext>
        </section>

        <section className="provider-quick-commands__section">
          <div className="provider-quick-commands__section-head">
            <strong>{t(locale, 'quickCommands.presets.title')}</strong>
            <span>{t(locale, 'quickCommands.presets.description')}</span>
          </div>

          <div className="library-flow">
            {[...presetItems, ...customItems].map(item => (
              <div
                key={item.orderId}
                className={`library-capsule ${item.kind === 'preset' ? (item.enabled ? 'is-enabled' : '') : (normalizedOrdered.includes(item.orderId) ? 'is-enabled' : '')}`}
                onClick={() => item.kind === 'preset' ? togglePreset(item.id) : toggleCustom(item.id)}
              >
                <div className="capsule-top">
                  <strong>{item.label}</strong>
                  <div className="status-dot" />
                </div>
                <span>{item.description}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {isComposerOpen && (
          <div className="command-composer-overlay">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="command-composer-card"
            >
              <h4>{editingCustomId ? t(locale, 'quickCommands.custom.edit') : t(locale, 'quickCommands.custom.title')}</h4>

              <div className="form-group">
                <label>{t(locale, 'quickCommands.custom.label')}</label>
                <input
                  autoFocus
                  value={draftLabel}
                  onChange={e => setDraftLabel(e.target.value)}
                  placeholder={t(locale, 'quickCommands.custom.label')}
                />
              </div>

              <div className="form-group">
                <label>{t(locale, 'quickCommands.custom.text')}</label>
                <textarea
                  value={draftText}
                  onChange={e => setDraftText(e.target.value)}
                  placeholder={t(locale, 'quickCommands.custom.formHint')}
                />
              </div>

              <div className="form-group">
                <label>{t(locale, 'quickCommands.custom.mode')}</label>
                <div className="segmented-control">
                  <div
                    className={`segment-option ${draftSubmitMode === 'insert' ? 'is-selected' : ''}`}
                    onClick={() => setDraftSubmitMode('insert')}
                  >
                    {t(locale, 'quickCommands.custom.mode.insert')}
                  </div>
                  <div
                    className={`segment-option ${draftSubmitMode === 'insert_and_submit' ? 'is-selected' : ''}`}
                    onClick={() => setDraftSubmitMode('insert_and_submit')}
                  >
                    {t(locale, 'quickCommands.custom.mode.insertAndSubmit')}
                  </div>
                </div>
              </div>

              <div className="composer-footer">
                <button className="secondary" onClick={closeComposer}>
                  {t(locale, 'quickCommands.custom.cancel')}
                </button>
                <button
                  className="primary"
                  disabled={!draftLabel.trim() || !draftText.trim()}
                  onClick={() => saveCustom('save-and-add')}
                >
                  {t(locale, 'quickCommands.custom.save')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  )
}
