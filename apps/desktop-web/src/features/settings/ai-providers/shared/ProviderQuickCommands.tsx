import { useEffect, useMemo, useState } from 'react'
import { motion, Reorder, AnimatePresence } from 'motion/react'
import { t, type Locale } from '@shell/i18n/ui-locale'
import {
  X,
  Pencil,
  Plus,
} from 'lucide-react'
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

function updateQuickCommandPreferences(updater: (current: UiPreferences) => UiPreferences): void {
  const current = loadUiPreferences()
  saveUiPreferences(updater(current))
  window.dispatchEvent(new Event(UI_PREFERENCES_UPDATED_EVENT))
}

export function ProviderQuickCommands({ locale, providerId }: ProviderQuickCommandsProps) {
  const [isVisible, setIsVisible] = useState<boolean>(() => isQuickCommandRailVisible(providerId, loadUiPreferences()))
  const [pinnedCommandIds, setPinnedCommandIds] = useState<string[]>([])
  const [customCapsules, setCustomCapsules] = useState<CustomCommandCapsule[]>([])
  const [orderedCommandCapsuleIds, setOrderedCommandCapsuleIds] = useState<string[]>([])
  const [hoveredOrderId, setHoveredOrderId] = useState<string | null>(null)
  
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [draftText, setDraftText] = useState('')
  const [draftSubmitMode, setDraftSubmitMode] = useState<CommandCapsuleSubmitMode>('insert')

  useEffect(() => {
    const sync = () => {
      const prefs = loadUiPreferences()
      setIsVisible(isQuickCommandRailVisible(providerId, prefs))
      setPinnedCommandIds(prefs.pinnedCommandIdsByProvider[providerId] ?? [])
      setCustomCapsules(prefs.customCommandCapsulesByProvider[providerId] ?? [])
      setOrderedCommandCapsuleIds(prefs.orderedCommandCapsuleIdsByProvider[providerId] ?? [])
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

  const handleReorder = (nextItems: ProviderCapsuleItem[]) => {
    const nextOrdered = nextItems.map(i => i.orderId)
    persist(normalizedPinned, customCapsules, nextOrdered)
  }

  const saveCustom = (mode: 'save-and-add' | 'save-only') => {
    if (!draftLabel.trim() || !draftText.trim()) return
    const id = editingCustomId ?? createCustomCapsuleId()
    const capsule: CustomCommandCapsule = {
      id,
      label: draftLabel.trim(),
      text: draftText.trim(),
      submitMode: draftSubmitMode,
      createdAt: Date.now()
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

          <Reorder.Group 
            axis="x" 
            values={enabledCapsules} 
            onReorder={handleReorder}
            className="capsule-group"
          >
            <AnimatePresence>
              {enabledCapsules.map((item) => (
                <Reorder.Item
                  key={item.orderId}
                  value={item}
                  className="command-capsule is-active"
                  onMouseEnter={() => setHoveredOrderId(item.orderId)}
                  onMouseLeave={() => setHoveredOrderId(null)}
                >
                  <span className="capsule-label">{item.label}</span>
                  <span className="capsule-tag">{item.submitMode === 'insert_and_submit' ? 'Auto' : 'Ins'}</span>
                  
                  <div className="capsule-actions">
                    {item.kind === 'custom' && (
                      <div className="action-icon" onClick={() => beginEdit(item)}>
                        <Pencil size={12} />
                      </div>
                    )}
                    <div className="action-icon danger" onClick={() => item.kind === 'preset' ? togglePreset(item.id) : toggleCustom(item.id)}>
                      <X size={12} strokeWidth={3} />
                    </div>
                  </div>

                  {hoveredOrderId === item.orderId && (
                    <div className="capsule-tooltip">{item.description}</div>
                  )}
                </Reorder.Item>
              ))}
            </AnimatePresence>
            <button className="command-capsule is-disabled" onClick={() => setIsComposerOpen(true)}>
              <Plus size={14} />
              <span>{t(locale, 'quickCommands.custom.add')}</span>
            </button>
          </Reorder.Group>
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
