import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@shell/ui/icons'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  buildCustomCommandCapsuleOrderId,
  buildNextOrderedCommandCapsuleIdsForCustomSave,
  buildPresetCommandCapsuleOrderId,
  commandRailProviderCommandOptionsByProvider,
  defaultUiPreferences,
  isQuickCommandRailVisible,
  loadUiPreferences,
  saveUiPreferences,
  setQuickCommandRailVisibility,
  UI_PREFERENCES_UPDATED_EVENT,
  type CommandCapsuleSubmitMode,
  type CommandRailProviderId,
  type CustomCommandCapsule,
  type UiPreferences,
  resolveCustomCommandSaveModeForEdit,
  quickCommandProviderCopyByProvider,
  resolveQuickCommandDescriptionKey,
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

function dedupeCommandIds(commandIds: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  commandIds.forEach((commandId) => {
    if (!commandId || seen.has(commandId)) {
      return
    }
    seen.add(commandId)
    result.push(commandId)
  })

  return result
}

// The ordered rail is the source of truth for what is active.
// Custom capsules are only included when their order ids are explicitly present.
function reconcileOrderedCapsuleIds(
  orderIds: string[],
  pinnedCommandIds: string[],
  customCapsules: CustomCommandCapsule[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const allowed = new Set<string>([
    ...pinnedCommandIds.map((commandId) => buildPresetCommandCapsuleOrderId(commandId)),
    ...customCapsules.map((capsule) => buildCustomCommandCapsuleOrderId(capsule.id)),
  ])

  orderIds.forEach((orderId) => {
    if (!orderId || seen.has(orderId) || !allowed.has(orderId)) {
      return
    }
    seen.add(orderId)
    result.push(orderId)
  })

  pinnedCommandIds.forEach((commandId) => {
    const orderId = buildPresetCommandCapsuleOrderId(commandId)
    if (seen.has(orderId)) {
      return
    }
    seen.add(orderId)
    result.push(orderId)
  })

  return result
}

function moveOrderId(orderIds: string[], sourceOrderId: string, targetOrderId: string): string[] {
  if (sourceOrderId === targetOrderId) {
    return orderIds
  }

  const next = [...orderIds]
  const fromIndex = next.indexOf(sourceOrderId)
  const targetIndex = next.indexOf(targetOrderId)
  if (fromIndex < 0 || targetIndex < 0) {
    return orderIds
  }

  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

function shiftOrderId(orderIds: string[], orderId: string, direction: -1 | 1): string[] {
  const index = orderIds.indexOf(orderId)
  if (index < 0) {
    return orderIds
  }
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= orderIds.length) {
    return orderIds
  }

  const next = [...orderIds]
  const [moved] = next.splice(index, 1)
  next.splice(nextIndex, 0, moved)
  return next
}

function createCustomCapsuleId(): string {
  const candidate =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return candidate.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function updateQuickCommandPreferences(updater: (current: UiPreferences) => UiPreferences): void {
  const current = loadUiPreferences()
  const next = updater(current)
  saveUiPreferences(next)
  window.dispatchEvent(new Event(UI_PREFERENCES_UPDATED_EVENT))
}

export function ProviderQuickCommands({ locale, providerId }: ProviderQuickCommandsProps) {
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    isQuickCommandRailVisible(providerId, loadUiPreferences()),
  )
  const [pinnedCommandIds, setPinnedCommandIds] = useState<string[]>(() => {
    const preferences = loadUiPreferences()
    return (
      preferences.pinnedCommandIdsByProvider[providerId] ??
      defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
      []
    )
  })
  const [customCapsules, setCustomCapsules] = useState<CustomCommandCapsule[]>(() => {
    const preferences = loadUiPreferences()
    return preferences.customCommandCapsulesByProvider[providerId] ?? []
  })
  const [orderedCommandCapsuleIds, setOrderedCommandCapsuleIds] = useState<string[]>(() => {
    const preferences = loadUiPreferences()
    return preferences.orderedCommandCapsuleIdsByProvider[providerId] ?? []
  })
  const [activeCapsuleOrderId, setActiveCapsuleOrderId] = useState<string | null>(null)
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null)
  const [dropTargetOrderId, setDropTargetOrderId] = useState<string | null>(null)
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null)
  const [isCreatingCustom, setIsCreatingCustom] = useState(false)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftSubmitMode, setDraftSubmitMode] = useState<CommandCapsuleSubmitMode>('insert')

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = loadUiPreferences()
      setIsVisible(isQuickCommandRailVisible(providerId, preferences))
      setPinnedCommandIds(
        preferences.pinnedCommandIdsByProvider[providerId] ??
          defaultUiPreferences.pinnedCommandIdsByProvider[providerId] ??
          [],
      )
      setCustomCapsules(preferences.customCommandCapsulesByProvider[providerId] ?? [])
      setOrderedCommandCapsuleIds(preferences.orderedCommandCapsuleIdsByProvider[providerId] ?? [])
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== 'gtoffice.ui.preferences.v1') {
        return
      }
      syncPreferences()
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, syncPreferences)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, syncPreferences)
    }
  }, [providerId])

  const normalizedPinnedCommandIds = useMemo(() => dedupeCommandIds(pinnedCommandIds), [pinnedCommandIds])
  const normalizedOrderedCommandCapsuleIds = useMemo(
    () => reconcileOrderedCapsuleIds(orderedCommandCapsuleIds, normalizedPinnedCommandIds, customCapsules),
    [customCapsules, normalizedPinnedCommandIds, orderedCommandCapsuleIds],
  )

  const presetItems = useMemo<PresetCapsuleItem[]>(
    () =>
      (commandRailProviderCommandOptionsByProvider[providerId] ?? []).map((option) => ({
        kind: 'preset',
        id: option.id,
        orderId: buildPresetCommandCapsuleOrderId(option.id),
        label: option.label,
        description: t(locale, resolveQuickCommandDescriptionKey(providerId, option.id)),
        enabled: normalizedPinnedCommandIds.includes(option.id),
      })),
    [locale, normalizedPinnedCommandIds, providerId],
  )

  const customItems = useMemo<CustomCapsuleItem[]>(
    () =>
      customCapsules.map((capsule) => ({
        kind: 'custom',
        id: capsule.id,
        orderId: buildCustomCommandCapsuleOrderId(capsule.id),
        label: capsule.label,
        description: capsule.text,
        text: capsule.text,
        submitMode: capsule.submitMode,
      })),
    [customCapsules],
  )

  const capsuleItemByOrderId = useMemo(() => {
    const map = new Map<string, ProviderCapsuleItem>()
    presetItems.forEach((item) => map.set(item.orderId, item))
    customItems.forEach((item) => map.set(item.orderId, item))
    return map
  }, [customItems, presetItems])

  const enabledCapsules = useMemo(
    () =>
      normalizedOrderedCommandCapsuleIds
        .map((orderId) => capsuleItemByOrderId.get(orderId) ?? null)
        .filter((item): item is ProviderCapsuleItem => item !== null),
    [capsuleItemByOrderId, normalizedOrderedCommandCapsuleIds],
  )

  useEffect(() => {
    if (activeCapsuleOrderId && capsuleItemByOrderId.has(activeCapsuleOrderId)) {
      return
    }
    const fallbackOrderId =
      enabledCapsules[0]?.orderId ?? presetItems[0]?.orderId ?? customItems[0]?.orderId ?? null
    setActiveCapsuleOrderId(fallbackOrderId)
  }, [activeCapsuleOrderId, capsuleItemByOrderId, customItems, enabledCapsules, presetItems])

  const selectedRailCapsule =
    enabledCapsules.find((item) => item.orderId === activeCapsuleOrderId) ?? enabledCapsules[0] ?? null
  const selectedRailOrderId = selectedRailCapsule?.orderId ?? null
  const providerCopy = quickCommandProviderCopyByProvider[providerId]
  const draftLabelTrimmed = draftLabel.trim()
  const draftTextTrimmed = draftText.trim()
  const isComposerExpanded = isCreatingCustom || editingCustomId !== null

  if (presetItems.length === 0) {
    return null
  }

  const resetDraft = () => {
    setIsCreatingCustom(false)
    setEditingCustomId(null)
    setDraftLabel('')
    setDraftText('')
    setDraftSubmitMode('insert')
  }

  const persistOrderedState = (
    nextPinnedCommandIds: string[],
    nextCustomCapsules: CustomCommandCapsule[],
    nextOrderedCommandCapsuleIds: string[],
  ) =>
    updateQuickCommandPreferences((current) => ({
      ...current,
      pinnedCommandIdsByProvider: {
        ...current.pinnedCommandIdsByProvider,
        [providerId]: nextPinnedCommandIds,
      },
      customCommandCapsulesByProvider: {
        ...current.customCommandCapsulesByProvider,
        [providerId]: nextCustomCapsules,
      },
      orderedCommandCapsuleIdsByProvider: {
        ...current.orderedCommandCapsuleIdsByProvider,
        [providerId]: reconcileOrderedCapsuleIds(
          nextOrderedCommandCapsuleIds,
          nextPinnedCommandIds,
          nextCustomCapsules,
        ),
      },
    }))

  const togglePresetCommand = (commandId: string) => {
    const nextPinnedCommandIds = normalizedPinnedCommandIds.includes(commandId)
      ? normalizedPinnedCommandIds.filter((id) => id !== commandId)
      : [...normalizedPinnedCommandIds, commandId]

    persistOrderedState(nextPinnedCommandIds, customCapsules, normalizedOrderedCommandCapsuleIds)
  }

  const toggleCustomCapsule = (capsuleId: string) => {
    const orderId = buildCustomCommandCapsuleOrderId(capsuleId)
    const nextOrderedCommandCapsuleIds = normalizedOrderedCommandCapsuleIds.includes(orderId)
      ? normalizedOrderedCommandCapsuleIds.filter((candidate) => candidate !== orderId)
      : [...normalizedOrderedCommandCapsuleIds, orderId]

    persistOrderedState(normalizedPinnedCommandIds, customCapsules, nextOrderedCommandCapsuleIds)
    setActiveCapsuleOrderId(orderId)
  }

  const moveEnabledCapsule = (orderId: string, direction: -1 | 1) => {
    const nextOrderedCommandCapsuleIds = shiftOrderId(normalizedOrderedCommandCapsuleIds, orderId, direction)
    persistOrderedState(normalizedPinnedCommandIds, customCapsules, nextOrderedCommandCapsuleIds)
  }

  const handleDropCapsule = (targetOrderId: string) => {
    if (!draggedOrderId) {
      return
    }
    const nextOrderedCommandCapsuleIds = moveOrderId(
      normalizedOrderedCommandCapsuleIds,
      draggedOrderId,
      targetOrderId,
    )
    setDraggedOrderId(null)
    setDropTargetOrderId(null)
    persistOrderedState(normalizedPinnedCommandIds, customCapsules, nextOrderedCommandCapsuleIds)
  }

  const saveCustomCapsule = (saveMode: 'save-and-add' | 'save-only' = 'save-and-add') => {
    if (!draftLabelTrimmed || !draftTextTrimmed) {
      return
    }

    const nextCustomCapsuleId = editingCustomId ?? createCustomCapsuleId()
    const nextSaveMode =
      editingCustomId === null
        ? saveMode
        : resolveCustomCommandSaveModeForEdit(normalizedOrderedCommandCapsuleIds, nextCustomCapsuleId)
    const nextCustomCapsules =
      editingCustomId === null
        ? [
            ...customCapsules,
            {
              id: nextCustomCapsuleId,
              label: draftLabelTrimmed,
              text: draftTextTrimmed,
              submitMode: draftSubmitMode,
              createdAt: Date.now(),
            },
          ]
        : customCapsules.map((capsule) =>
            capsule.id === editingCustomId
              ? {
                  ...capsule,
                  label: draftLabelTrimmed,
                  text: draftTextTrimmed,
                  submitMode: draftSubmitMode,
                }
              : capsule,
          )
    const nextOrderedCommandCapsuleIds = buildNextOrderedCommandCapsuleIdsForCustomSave(
      normalizedOrderedCommandCapsuleIds,
      nextCustomCapsuleId,
      nextSaveMode,
    )

    persistOrderedState(normalizedPinnedCommandIds, nextCustomCapsules, nextOrderedCommandCapsuleIds)
    resetDraft()
  }

  const deleteCustomCapsule = (capsuleId: string) => {
    const nextCustomCapsules = customCapsules.filter((capsule) => capsule.id !== capsuleId)
    const nextOrderedCommandCapsuleIds = normalizedOrderedCommandCapsuleIds.filter(
      (orderId) => orderId !== buildCustomCommandCapsuleOrderId(capsuleId),
    )
    if (editingCustomId === capsuleId) {
      resetDraft()
    }
    persistOrderedState(normalizedPinnedCommandIds, nextCustomCapsules, nextOrderedCommandCapsuleIds)
  }

  const beginEditCustomCapsule = (capsule: CustomCommandCapsule) => {
    setIsCreatingCustom(false)
    setEditingCustomId(capsule.id)
    setDraftLabel(capsule.label)
    setDraftText(capsule.text)
    setDraftSubmitMode(capsule.submitMode)
    setActiveCapsuleOrderId(buildCustomCommandCapsuleOrderId(capsule.id))
  }

  const beginCreateCustomCapsule = () => {
    setEditingCustomId(null)
    setIsCreatingCustom(true)
    setDraftLabel('')
    setDraftText('')
    setDraftSubmitMode('insert')
  }

  const toggleVisibility = () => {
    updateQuickCommandPreferences((current) =>
      setQuickCommandRailVisibility(providerId, !isQuickCommandRailVisible(providerId, current), current),
    )
  }

  return (
    <section className="provider-quick-commands" aria-label={t(locale, providerCopy.titleKey)}>
      <header className="provider-quick-commands__header provider-quick-commands__summary">
        <div className="provider-quick-commands__header-copy provider-quick-commands__summary-copy">
          <strong>{t(locale, 'quickCommands.section.title')}</strong>
          <span>{t(locale, providerCopy.descriptionKey)}</span>
        </div>
        <div className="provider-quick-commands__header-meta provider-quick-commands__summary-meta">
          <span className="provider-quick-commands__count">
            {t(locale, 'quickCommands.section.count', {
              count: String(enabledCapsules.length),
            })}
          </span>
          <button
            type="button"
            className={`provider-quick-commands__switch ${isVisible ? 'is-on' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              toggleVisibility()
            }}
            aria-pressed={isVisible}
            aria-label={t(locale, 'quickCommands.section.visibility')}
          >
            <span className="provider-quick-commands__switch-thumb" />
          </button>
        </div>
      </header>

      <div className="provider-quick-commands__panel">
        <p className="provider-quick-commands__hint">{t(locale, 'quickCommands.section.hint')}</p>

        <section className="provider-quick-commands__rail-section provider-quick-commands__section">
          <div className="provider-quick-commands__section-head">
            <div>
              <strong>{t(locale, 'quickCommands.preview.title')}</strong>
              <span>{t(locale, 'quickCommands.preview.reorder')}</span>
            </div>
          </div>

          {enabledCapsules.length > 0 ? (
            <div className="provider-quick-commands__rail provider-quick-commands__preview-rail" role="list">
              {enabledCapsules.map((item, index) => (
                <div
                  key={item.orderId}
                  role="listitem"
                  tabIndex={0}
                  draggable
                  className={[
                    'provider-quick-commands__rail-item',
                    'provider-quick-commands__preview-item',
                    `is-${item.kind}`,
                    activeCapsuleOrderId === item.orderId ? 'is-active' : '',
                    draggedOrderId === item.orderId ? 'is-dragging' : '',
                    dropTargetOrderId === item.orderId ? 'is-drop-target' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setActiveCapsuleOrderId(item.orderId)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', item.orderId)
                    setDraggedOrderId(item.orderId)
                    setDropTargetOrderId(item.orderId)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (dropTargetOrderId !== item.orderId) {
                      setDropTargetOrderId(item.orderId)
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    handleDropCapsule(item.orderId)
                  }}
                  onDragEnd={() => {
                    setDraggedOrderId(null)
                    setDropTargetOrderId(null)
                  }}
                  onPointerEnter={() => setActiveCapsuleOrderId(item.orderId)}
                  onFocus={() => setActiveCapsuleOrderId(item.orderId)}
                  aria-label={`${item.label}: ${item.description}`}
                >
                  <div className="provider-quick-commands__preview-main">
                    <span className="provider-quick-commands__preview-label">{item.label}</span>
                    <span className="provider-quick-commands__preview-kind">
                      {item.kind === 'preset'
                        ? t(locale, 'quickCommands.capsule.preset')
                        : item.submitMode === 'insert_and_submit'
                          ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                          : t(locale, 'quickCommands.custom.mode.insert')}
                    </span>
                  </div>
                  <div className="provider-quick-commands__preview-actions">
                    <button
                      type="button"
                      className="provider-quick-commands__preview-action"
                      onClick={(event) => {
                        event.stopPropagation()
                        moveEnabledCapsule(item.orderId, -1)
                      }}
                      disabled={index === 0}
                      aria-label={t(locale, 'quickCommands.preview.moveEarlier')}
                    >
                      <AppIcon name="chevron-left" width={12} height={12} />
                    </button>
                    <button
                      type="button"
                      className="provider-quick-commands__preview-action"
                      onClick={(event) => {
                        event.stopPropagation()
                        moveEnabledCapsule(item.orderId, 1)
                      }}
                      disabled={index === enabledCapsules.length - 1}
                      aria-label={t(locale, 'quickCommands.preview.moveLater')}
                    >
                      <AppIcon name="chevron-right" width={12} height={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="provider-quick-commands__empty-state">
              <p>{t(locale, 'quickCommands.preview.empty')}</p>
            </div>
          )}

          {selectedRailCapsule ? (
            <div className="provider-quick-commands__detail-strip provider-quick-commands__detail" aria-live="polite">
              <div className="provider-quick-commands__detail-copy">
                <div className="provider-quick-commands__detail-head">
                  <strong>{selectedRailCapsule.label}</strong>
                  <span>
                    {selectedRailCapsule.kind === 'custom'
                      ? selectedRailCapsule.submitMode === 'insert_and_submit'
                        ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                        : t(locale, 'quickCommands.custom.mode.insert')
                      : t(locale, 'quickCommands.capsule.preset')}
                  </span>
                </div>
                <p>{selectedRailCapsule.description}</p>
              </div>
              <div className="provider-quick-commands__detail-actions provider-quick-commands__custom-card-actions">
                {selectedRailCapsule.kind === 'custom' ? (
                  <>
                    <button
                      type="button"
                      className="provider-quick-commands__custom-action"
                      onClick={() => {
                        const capsule = customCapsules.find((candidate) => candidate.id === selectedRailCapsule.id)
                        if (capsule) {
                          beginEditCustomCapsule(capsule)
                        }
                      }}
                    >
                      <AppIcon name="pencil" width={12} height={12} />
                      <span>{t(locale, 'quickCommands.custom.edit')}</span>
                    </button>
                    <button
                      type="button"
                      className="provider-quick-commands__custom-action danger"
                      onClick={() => deleteCustomCapsule(selectedRailCapsule.id)}
                    >
                      <AppIcon name="trash" width={12} height={12} />
                      <span>{t(locale, 'quickCommands.custom.delete')}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="provider-quick-commands__custom-action"
                    onClick={() => togglePresetCommand(selectedRailCapsule.id)}
                  >
                    <AppIcon name="minus" width={12} height={12} />
                    <span>{t(locale, 'quickCommands.section.hidden')}</span>
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </section>

        <div className="provider-quick-commands__library">
          <section className="provider-quick-commands__group provider-quick-commands__section">
            <div className="provider-quick-commands__section-head">
              <div>
                <strong>{t(locale, 'quickCommands.presets.title')}</strong>
                <span>{t(locale, 'quickCommands.presets.description')}</span>
              </div>
            </div>

            <div className="provider-quick-commands__group-list" role="list">
              {presetItems.map((item) => (
                <article
                  key={item.orderId}
                  role="listitem"
                  className={[
                    'provider-quick-commands__library-row',
                    'provider-quick-commands__preset-chip',
                    item.enabled ? 'is-active' : '',
                    selectedRailOrderId === item.orderId ? 'is-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerEnter={() => setActiveCapsuleOrderId(item.orderId)}
                >
                  <button
                    type="button"
                    className="provider-quick-commands__library-copy"
                    onClick={() => setActiveCapsuleOrderId(item.orderId)}
                    aria-pressed={activeCapsuleOrderId === item.orderId}
                    aria-label={`${item.label}: ${item.description}`}
                    title={item.description}
                  >
                    <span className="provider-quick-commands__preset-label">{item.label}</span>
                    <span className="provider-quick-commands__library-description">{item.description}</span>
                  </button>
                  <span className="provider-quick-commands__preset-state">
                    {item.enabled ? t(locale, 'quickCommands.section.shown') : t(locale, 'quickCommands.section.hidden')}
                  </span>
                  <button
                    type="button"
                    className="provider-quick-commands__library-action provider-quick-commands__custom-action"
                    onClick={() => {
                      togglePresetCommand(item.id)
                      setActiveCapsuleOrderId(item.orderId)
                    }}
                    aria-pressed={item.enabled}
                  >
                    <AppIcon name={item.enabled ? 'minus' : 'plus'} width={12} height={12} />
                    <span>
                      {item.enabled ? t(locale, 'quickCommands.section.hidden') : t(locale, 'quickCommands.custom.add')}
                    </span>
                  </button>
                </article>
              ))}
            </div>
          </section>

          <section className="provider-quick-commands__group provider-quick-commands__section">
            <div className="provider-quick-commands__section-head">
              <div>
                <strong>{t(locale, 'quickCommands.custom.title')}</strong>
                <span>{t(locale, 'quickCommands.custom.description')}</span>
              </div>
            </div>

            {isComposerExpanded ? (
              <div
                className="provider-quick-commands__library-row provider-quick-commands__inline-composer"
                role="group"
                aria-label={t(locale, 'quickCommands.custom.title')}
              >
                <label className="provider-quick-commands__library-copy provider-quick-commands__field">
                  <span>{t(locale, 'quickCommands.custom.label')}</span>
                  <input
                    type="text"
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    placeholder={t(locale, 'quickCommands.custom.label', 'Label')}
                  />
                </label>

                <label className="provider-quick-commands__field">
                  <span>{t(locale, 'quickCommands.custom.text')}</span>
                  <input
                    type="text"
                    value={draftText}
                    onChange={(event) => setDraftText(event.target.value)}
                    placeholder={t(locale, 'quickCommands.custom.formHint')}
                  />
                </label>

                <label className="provider-quick-commands__field">
                  <span>{t(locale, 'quickCommands.custom.mode')}</span>
                  <select
                    value={draftSubmitMode}
                    onChange={(event) => setDraftSubmitMode(event.target.value as CommandCapsuleSubmitMode)}
                  >
                    <option value="insert">{t(locale, 'quickCommands.custom.mode.insert')}</option>
                    <option value="insert_and_submit">
                      {t(locale, 'quickCommands.custom.mode.insertAndSubmit')}
                    </option>
                  </select>
                </label>

                <div className="provider-quick-commands__composer-actions">
                  <button
                    type="button"
                    className="provider-quick-commands__composer-primary"
                    onClick={() => saveCustomCapsule('save-and-add')}
                    disabled={!draftLabelTrimmed || !draftTextTrimmed}
                  >
                    <AppIcon name="plus" width={14} height={14} />
                    <span>{t(locale, 'quickCommands.custom.saveAndAdd', 'Save and add')}</span>
                  </button>
                  <button
                    type="button"
                    className="provider-quick-commands__composer-secondary"
                    onClick={() => saveCustomCapsule('save-only')}
                    disabled={!draftLabelTrimmed || !draftTextTrimmed}
                  >
                    {t(locale, 'quickCommands.custom.saveOnly', 'Save only')}
                  </button>
                  <button
                    type="button"
                    className="provider-quick-commands__composer-secondary"
                    onClick={resetDraft}
                  >
                    {t(locale, 'quickCommands.custom.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="provider-quick-commands__inline-composer-trigger provider-quick-commands__composer-secondary"
                onClick={beginCreateCustomCapsule}
              >
                <AppIcon name="plus" width={14} height={14} />
                <span>{t(locale, 'quickCommands.custom.add')}</span>
              </button>
            )}

            {customCapsules.length > 0 ? (
              <div className="provider-quick-commands__custom-list provider-quick-commands__group-list">
                {customCapsules.map((capsule) => {
                  const orderId = buildCustomCommandCapsuleOrderId(capsule.id)
                  const isEnabled = normalizedOrderedCommandCapsuleIds.includes(orderId)
                  return (
                    <article
                      key={capsule.id}
                      className={[
                        'provider-quick-commands__library-row',
                        editingCustomId === capsule.id ? 'is-editing' : '',
                        selectedRailOrderId === orderId ? 'is-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onPointerEnter={() => setActiveCapsuleOrderId(orderId)}
                    >
                      <button
                        type="button"
                        className="provider-quick-commands__library-copy"
                        onClick={() => setActiveCapsuleOrderId(orderId)}
                      >
                        <span className="provider-quick-commands__preset-label">{capsule.label}</span>
                        <span className="provider-quick-commands__library-description">{capsule.text}</span>
                      </button>
                      <span className="provider-quick-commands__preset-state">
                        {capsule.submitMode === 'insert_and_submit'
                          ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                          : t(locale, 'quickCommands.custom.mode.insert')}
                      </span>
                      <div className="provider-quick-commands__custom-card-actions">
                        <button
                          type="button"
                          className="provider-quick-commands__custom-action"
                          onClick={() => toggleCustomCapsule(capsule.id)}
                        >
                          <span>
                            {isEnabled
                              ? t(locale, 'quickCommands.section.hidden')
                              : t(locale, 'quickCommands.custom.add')}
                          </span>
                          <AppIcon name={isEnabled ? 'minus' : 'plus'} width={12} height={12} />
                        </button>
                        <button
                          type="button"
                          className="provider-quick-commands__custom-action"
                          onClick={() => beginEditCustomCapsule(capsule)}
                        >
                          <AppIcon name="pencil" width={12} height={12} />
                          <span>{t(locale, 'quickCommands.custom.edit')}</span>
                        </button>
                        <button
                          type="button"
                          className="provider-quick-commands__custom-action danger"
                          onClick={() => deleteCustomCapsule(capsule.id)}
                        >
                          <AppIcon name="trash" width={12} height={12} />
                          <span>{t(locale, 'quickCommands.custom.delete')}</span>
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="provider-quick-commands__empty-state">
                <p>{t(locale, 'quickCommands.custom.empty')}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}
