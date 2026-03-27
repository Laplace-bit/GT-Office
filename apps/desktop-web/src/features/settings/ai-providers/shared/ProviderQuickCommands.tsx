import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@shell/ui/icons'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  buildCustomCommandCapsuleOrderId,
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

  customCapsules.forEach((capsule) => {
    const orderId = buildCustomCommandCapsuleOrderId(capsule.id)
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
  const [isExpanded, setIsExpanded] = useState(false)
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

  const activeCapsule =
    (activeCapsuleOrderId ? capsuleItemByOrderId.get(activeCapsuleOrderId) : null) ??
    enabledCapsules[0] ??
    presetItems[0] ??
    customItems[0] ??
    null

  const providerCopy = quickCommandProviderCopyByProvider[providerId]
  const draftLabelTrimmed = draftLabel.trim()
  const draftTextTrimmed = draftText.trim()

  if (presetItems.length === 0) {
    return null
  }

  const resetDraft = () => {
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

  const saveCustomCapsule = () => {
    if (!draftLabelTrimmed || !draftTextTrimmed) {
      return
    }

    const nextCustomCapsules =
      editingCustomId === null
        ? [
          ...customCapsules,
          {
            id: createCustomCapsuleId(),
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

    persistOrderedState(normalizedPinnedCommandIds, nextCustomCapsules, normalizedOrderedCommandCapsuleIds)
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
    setEditingCustomId(capsule.id)
    setDraftLabel(capsule.label)
    setDraftText(capsule.text)
    setDraftSubmitMode(capsule.submitMode)
    setActiveCapsuleOrderId(buildCustomCommandCapsuleOrderId(capsule.id))
  }

  const toggleVisibility = () => {
    updateQuickCommandPreferences((current) =>
      setQuickCommandRailVisibility(providerId, !isQuickCommandRailVisible(providerId, current), current),
    )
  }

  return (
    <section className="provider-quick-commands" aria-label={t(locale, providerCopy.titleKey)}>
      <div className={`provider-quick-commands__summary ${isExpanded ? 'is-expanded' : ''}`}>
        <button
          type="button"
          className="provider-quick-commands__summary-main"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded((current) => !current)
          }}
          aria-expanded={isExpanded}
        >
          <div className="provider-quick-commands__summary-copy">
            <strong>{t(locale, 'quickCommands.section.title')}</strong>
            <span>{t(locale, providerCopy.descriptionKey)}</span>
          </div>
          <div className="provider-quick-commands__summary-meta">
            <span className="provider-quick-commands__count">
              {t(locale, 'quickCommands.section.count', {
                count: String(enabledCapsules.length),
              })}
            </span>
            <span className="provider-quick-commands__summary-icon" aria-hidden="true">
              <AppIcon name={isExpanded ? 'collapse' : 'expand'} width={14} height={14} />
            </span>
          </div>
        </button>
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

      {isExpanded ? (
        <div className="provider-quick-commands__panel">
          <p className="provider-quick-commands__hint">{t(locale, 'quickCommands.section.hint')}</p>

          <div className="provider-quick-commands__section">
            <div className="provider-quick-commands__section-head">
              <div>
                <strong>{t(locale, 'quickCommands.preview.title')}</strong>
                <span>{t(locale, 'quickCommands.preview.reorder')}</span>
              </div>
            </div>

            {enabledCapsules.length > 0 ? (
              <div className="provider-quick-commands__preview-rail" role="list">
                {enabledCapsules.map((item, index) => (
                  <div
                    key={item.orderId}
                    role="listitem"
                    tabIndex={0}
                    draggable
                    className={[
                      'provider-quick-commands__preview-item',
                      `is-${item.kind}`,
                      activeCapsuleOrderId === item.orderId ? 'is-active' : '',
                      draggedOrderId === item.orderId ? 'is-dragging' : '',
                      dropTargetOrderId === item.orderId ? 'is-drop-target' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
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
                      <span className="provider-quick-commands__preview-kind">
                        {item.kind === 'preset'
                          ? t(locale, 'quickCommands.capsule.preset')
                          : t(locale, 'quickCommands.capsule.custom')}
                      </span>
                      <span className="provider-quick-commands__preview-label">{item.label}</span>
                      {item.kind === 'custom' ? (
                        <span className="provider-quick-commands__preview-mode">
                          {item.submitMode === 'insert_and_submit'
                            ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                            : t(locale, 'quickCommands.custom.mode.insert')}
                        </span>
                      ) : null}
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

            {activeCapsule ? (
              <div className="provider-quick-commands__detail" aria-live="polite">
                <div className="provider-quick-commands__detail-head">
                  <strong>{activeCapsule.label}</strong>
                  <span>
                    {activeCapsule.kind === 'custom'
                      ? activeCapsule.submitMode === 'insert_and_submit'
                        ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                        : t(locale, 'quickCommands.custom.mode.insert')
                      : t(locale, activeCapsule.enabled ? 'quickCommands.section.shown' : 'quickCommands.section.hidden')}
                  </span>
                </div>
                <p>{activeCapsule.description}</p>
              </div>
            ) : null}
          </div>

          <div className="provider-quick-commands__section">
            <div className="provider-quick-commands__section-head">
              <div>
                <strong>{t(locale, 'quickCommands.presets.title')}</strong>
                <span>{t(locale, 'quickCommands.presets.description')}</span>
              </div>
            </div>
            <div className="provider-quick-commands__preset-grid" role="list">
              {presetItems.map((item) => (
                <button
                  key={item.orderId}
                  type="button"
                  role="listitem"
                  className={`provider-quick-commands__preset-chip ${item.enabled ? 'is-active' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    togglePresetCommand(item.id)
                  }}
                  onPointerEnter={() => setActiveCapsuleOrderId(item.orderId)}
                  onFocus={() => setActiveCapsuleOrderId(item.orderId)}
                  aria-pressed={item.enabled}
                  aria-label={`${item.label}: ${item.description}`}
                  title={item.description}
                >
                  <span className="provider-quick-commands__preset-label">{item.label}</span>
                  <span className="provider-quick-commands__preset-state">
                    {item.enabled
                      ? t(locale, 'quickCommands.section.shown')
                      : t(locale, 'quickCommands.section.hidden')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="provider-quick-commands__section">
            <div className="provider-quick-commands__section-head">
              <div>
                <strong>{t(locale, 'quickCommands.custom.title')}</strong>
                <span>{t(locale, 'quickCommands.custom.description')}</span>
              </div>
            </div>

            <div className="provider-quick-commands__composer">
              <div className="provider-quick-commands__composer-grid">
                <label className="provider-quick-commands__field">
                  <span>{t(locale, 'quickCommands.custom.label')}</span>
                  <input
                    type="text"
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    placeholder={t(locale, 'quickCommands.custom.label', 'Label')}
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
              </div>

              <label className="provider-quick-commands__field">
                <span>{t(locale, 'quickCommands.custom.text')}</span>
                <textarea
                  value={draftText}
                  onChange={(event) => setDraftText(event.target.value)}
                  rows={4}
                  placeholder={t(locale, 'quickCommands.custom.formHint')}
                />
              </label>

              <p className="provider-quick-commands__composer-hint">
                {t(locale, 'quickCommands.custom.formHint')}
              </p>

              <div className="provider-quick-commands__composer-actions">
                <button
                  type="button"
                  className="provider-quick-commands__composer-primary"
                  onClick={(event) => {
                    event.stopPropagation()
                    saveCustomCapsule()
                  }}
                  disabled={!draftLabelTrimmed || !draftTextTrimmed}
                >
                  <AppIcon name="plus" width={14} height={14} />
                  <span>
                    {editingCustomId === null
                      ? t(locale, 'quickCommands.custom.add')
                      : t(locale, 'quickCommands.custom.save')}
                  </span>
                </button>
                {editingCustomId !== null ? (
                  <button
                    type="button"
                    className="provider-quick-commands__composer-secondary"
                    onClick={(event) => {
                      event.stopPropagation()
                      resetDraft()
                    }}
                  >
                    {t(locale, 'quickCommands.custom.cancel')}
                  </button>
                ) : null}
              </div>
            </div>

            {customCapsules.length > 0 ? (
              <div className="provider-quick-commands__custom-list">
                {customCapsules.map((capsule) => {
                  const orderId = buildCustomCommandCapsuleOrderId(capsule.id)
                  return (
                    <article
                      key={capsule.id}
                      className={[
                        'provider-quick-commands__custom-card',
                        editingCustomId === capsule.id ? 'is-editing' : '',
                        activeCapsuleOrderId === orderId ? 'is-active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onPointerEnter={() => setActiveCapsuleOrderId(orderId)}
                    >
                      <div className="provider-quick-commands__custom-card-head">
                        <div className="provider-quick-commands__custom-card-copy">
                          <strong>{capsule.label}</strong>
                          <span>
                            {capsule.submitMode === 'insert_and_submit'
                              ? t(locale, 'quickCommands.custom.mode.insertAndSubmit')
                              : t(locale, 'quickCommands.custom.mode.insert')}
                          </span>
                        </div>
                        <div className="provider-quick-commands__custom-card-actions">
                          <button
                            type="button"
                            className="provider-quick-commands__custom-action"
                            onClick={(event) => {
                              event.stopPropagation()
                              beginEditCustomCapsule(capsule)
                            }}
                          >
                            <AppIcon name="pencil" width={12} height={12} />
                            <span>{t(locale, 'quickCommands.custom.edit')}</span>
                          </button>
                          <button
                            type="button"
                            className="provider-quick-commands__custom-action danger"
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteCustomCapsule(capsule.id)
                            }}
                          >
                            <AppIcon name="trash" width={12} height={12} />
                            <span>{t(locale, 'quickCommands.custom.delete')}</span>
                          </button>
                        </div>
                      </div>
                      <p>{capsule.text}</p>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="provider-quick-commands__empty-state">
                <p>{t(locale, 'quickCommands.custom.empty')}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
