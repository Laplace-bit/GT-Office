import { t, type Locale } from '@shell/i18n/ui-locale'
import { AppIcon } from '@shell/ui/icons'
import { requestStandardModalClose } from '@/components/modal/standard-modal-close'

import {
  canConfirmStationDeleteCleanup,
  type StationDeleteCleanupState,
  type StationDeleteCleanupStrategy,
} from './station-delete-binding-cleanup-model'

interface StationDeleteBindingCleanupDialogProps {
  open: boolean
  locale: Locale
  state: StationDeleteCleanupState | null
  submitting?: boolean
  onClose: () => void
  onStrategyChange: (strategy: StationDeleteCleanupStrategy) => void
  onReplacementAgentChange: (agentId: string) => void
  onConfirm: () => void
}

const strategyOrder: StationDeleteCleanupStrategy[] = ['rebind', 'disable', 'delete']

export function StationDeleteBindingCleanupDialog({
  open,
  locale,
  state,
  submitting = false,
  onClose,
  onStrategyChange,
  onReplacementAgentChange,
  onConfirm,
}: StationDeleteBindingCleanupDialogProps) {
  if (!open || !state) {
    return null
  }

  const confirmDisabled = submitting || !canConfirmStationDeleteCleanup(state)

  const describeStrategy = (strategy: StationDeleteCleanupStrategy) => {
    switch (strategy) {
      case 'rebind':
        return t(locale, '改绑到其他 Agent', 'Rebind to another agent')
      case 'disable':
        return t(locale, '仅停用这些绑定', 'Disable the bindings')
      case 'delete':
      default:
        return t(locale, '直接删除这些绑定', 'Delete the bindings')
    }
  }

  return (
    <div
      className="settings-modal-backdrop station-role-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestStandardModalClose('backdrop', onClose)
        }
      }}
    >
      <section className="settings-modal panel station-role-modal" role="dialog" aria-modal="true">
        <header className="settings-modal-header">
          <div>
            <h2>{t(locale, '删除前处理通道路由', 'Resolve channel routes before deletion')}</h2>
            <p>
              {t(
                locale,
                '这个 Agent 仍被外部通道路由引用。请先选择这些绑定的处理方式。',
                'This agent is still referenced by external channel bindings. Choose how those bindings should be handled before deletion.',
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestStandardModalClose('explicit', onClose)}
            aria-label={t(locale, '关闭', 'Close')}
          >
            <AppIcon name="close" className="vb-icon" aria-hidden="true" />
          </button>
        </header>

        <section className="station-role-modal__body">
          <div className="station-role-modal__list">
            {strategyOrder.map((strategy) => (
              <button
                key={strategy}
                type="button"
                className={`station-role-modal__list-item ${state.strategy === strategy ? 'is-active' : ''}`}
                onClick={() => onStrategyChange(strategy)}
                disabled={submitting}
              >
                <strong>{describeStrategy(strategy)}</strong>
                <span>
                  {strategy === 'rebind'
                    ? t(locale, '保持原路由意图，但切到新的 Agent。', 'Keep the route but switch it to a different agent.')
                    : strategy === 'disable'
                    ? t(locale, '保留配置，先暂停路由。', 'Keep the configuration but stop routing for now.')
                    : t(locale, '移除这些路由配置。', 'Remove these route configurations.')}
                </span>
              </button>
            ))}
          </div>

          <div className="station-role-modal__editor">
            <div className="station-role-modal__hint">
              {t(locale, '受影响绑定: {count}', 'Affected bindings: {count}', {
                count: state.blockingBindings.length,
              })}
            </div>
            <ul className="channel-bot-routes">
              {state.blockingBindings.map((binding) => (
                <li key={`${binding.channel}:${binding.accountId}:${binding.peerPattern}:${binding.targetAgentId}`} className="channel-bot-route-item">
                  <div className="channel-bot-route-info">
                    <p className="channel-bot-route-binding">
                      {binding.channel} · {(binding.accountId ?? 'default').trim() || 'default'}
                    </p>
                    <p className="channel-bot-route-match">
                      {t(locale, '匹配: {kind} / {pattern}', 'Match: {kind} / {pattern}', {
                        kind: binding.peerKind ?? '*',
                        pattern: binding.peerPattern || '*',
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            {state.strategy === 'rebind' ? (
              <label className="station-form-field">
                <span>{t(locale, '替换为', 'Replacement Agent')}</span>
                <select
                  value={state.replacementAgentId}
                  disabled={submitting}
                  onChange={(event) => onReplacementAgentChange(event.target.value)}
                >
                  <option value="">{t(locale, '请选择', 'Select an agent')}</option>
                  {state.availableAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </section>

        <footer className="station-form-actions">
          <button
            type="button"
            className="station-form-btn subtle"
            disabled={submitting}
            onClick={() => requestStandardModalClose('explicit', onClose)}
          >
            {t(locale, '取消', 'Cancel')}
          </button>
          <button
            type="button"
            className={`station-form-btn ${state.strategy === 'delete' ? 'danger' : ''}`}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            <AppIcon name={state.strategy === 'delete' ? 'trash' : 'check'} className="vb-icon" aria-hidden="true" />
            <span>
              {submitting
                ? t(locale, '处理中...', 'Applying...')
                : t(locale, '确认并删除 Agent', 'Confirm and delete agent')}
            </span>
          </button>
        </footer>
      </section>
    </div>
  )
}
