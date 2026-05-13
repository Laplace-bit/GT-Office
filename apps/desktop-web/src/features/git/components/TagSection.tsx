import { memo, useCallback, useState } from 'react'
import { t } from '@shell/i18n/ui-locale'
import type { GitTagEntry } from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'
import { GitIconButton } from './GitIconButton'
import { GitSectionHeader } from './GitSectionHeader'

interface TagSectionProps {
  tags: GitTagEntry[]
  loading: boolean
  locale: Locale
  isGitRepository: boolean
  actionLoading: string | null
  remoteActionLoading: 'fetch' | 'pull' | 'push' | 'tagPush' | null
  onCreateTag: (name: string, target: string, annotated: boolean, message?: string) => Promise<void>
  onDeleteTag: (name: string) => Promise<void>
  onPushTag: (name: string, remote?: string) => Promise<void>
  collapsed: boolean
  onToggle: () => void
}

export const TagSection = memo(function TagSection({
  tags,
  loading,
  locale,
  isGitRepository,
  actionLoading,
  remoteActionLoading,
  onCreateTag,
  onDeleteTag,
  onPushTag,
  collapsed,
  onToggle,
}: TagSectionProps) {
  const [tagName, setTagName] = useState('')
  const [tagTarget, setTagTarget] = useState('')
  const [tagAnnotated, setTagAnnotated] = useState(false)
  const [tagMessage, setTagMessage] = useState('')
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = useCallback(async () => {
    const name = tagName.trim()
    if (!name) return
    setSubmitting(true)
    try {
      await onCreateTag(name, tagTarget.trim() || 'HEAD', tagAnnotated, tagAnnotated ? tagMessage : undefined)
      setTagName('')
      setTagTarget('')
      setTagAnnotated(false)
      setTagMessage('')
    } finally {
      setSubmitting(false)
    }
  }, [tagName, tagTarget, tagAnnotated, tagMessage, onCreateTag])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmName) return
    setSubmitting(true)
    try {
      await onDeleteTag(deleteConfirmName)
    } finally {
      setDeleteConfirmName(null)
      setSubmitting(false)
    }
  }, [deleteConfirmName, onDeleteTag])

  const handlePush = useCallback((name: string) => {
    void onPushTag(name)
  }, [onPushTag])

  const disabled =
    !isGitRepository || Boolean(actionLoading) || Boolean(remoteActionLoading) || submitting

  return (
    <section className={`git-section ${!collapsed ? 'git-section--expanded' : ''}`}>
      <GitSectionHeader
        title={t(locale, 'git.tag.title')}
        count={tags.length}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="git-section__content">
          {/* Create form */}
          <div className="git-tag-create-form">
            <div className="git-tag-create-form__row">
              <input
                type="text"
                className="git-stash-form__input"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={t(locale, 'git.tag.namePlaceholder')}
                disabled={disabled}
              />
              <input
                type="text"
                className="git-stash-form__input"
                value={tagTarget}
                onChange={(e) => setTagTarget(e.target.value)}
                placeholder={t(locale, 'git.tag.targetPlaceholder')}
                disabled={disabled}
              />
            </div>
            <label className="git-tag-create-form__checkbox">
              <input
                type="checkbox"
                checked={tagAnnotated}
                onChange={(e) => setTagAnnotated(e.target.checked)}
                disabled={disabled}
              />
              <span>{t(locale, 'git.tag.annotated')}</span>
            </label>
            {tagAnnotated && (
              <input
                type="text"
                className="git-stash-form__input"
                value={tagMessage}
                onChange={(e) => setTagMessage(e.target.value)}
                placeholder={t(locale, 'git.tag.messagePlaceholder')}
                disabled={disabled}
              />
            )}
            <div className="git-tag-create-form__actions">
              <GitIconButton
                icon="plus"
                label={t(locale, 'git.action.createTag')}
                onClick={() => void handleCreate()}
                disabled={disabled || !tagName.trim()}
                variant="primary"
                showLabel
              />
            </div>
          </div>

          {/* Tag list */}
          {loading && tags.length === 0 && (
            <div className="git-tag-empty">{t(locale, 'git.tag.empty')}</div>
          )}
          {tags.length > 0 && (
            <div className="git-tag-list">
              {tags.map((tag) => (
                <div className="git-tag-item" key={tag.name}>
                  <div className="git-tag-item__info">
                    <code className="git-tag-item__name">{tag.name}</code>
                    {tag.message && (
                      <span className="git-tag-item__message">{tag.message}</span>
                    )}
                  </div>
                  <div className="git-tag-item__actions">
                    <GitIconButton
                      icon="arrow-up"
                      label={t(locale, 'git.action.pushTag')}
                      onClick={() => handlePush(tag.name)}
                      disabled={disabled}
                      size="sm"
                    />
                    <GitIconButton
                      icon="trash"
                      label={t(locale, 'git.action.deleteTag')}
                      onClick={() => setDeleteConfirmName(tag.name)}
                      disabled={disabled}
                      variant="danger"
                      size="sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation overlay */}
      {deleteConfirmName && (
        <div className="git-confirm-modal-overlay" onClick={() => setDeleteConfirmName(null)}>
          <section
            className="git-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-delete-tag-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="git-confirm-modal__header">
              <span className="git-confirm-modal__eyebrow">
                {t(locale, 'git.confirm.deleteTagEyebrow')}
              </span>
              <h3 id="git-delete-tag-title">
                {t(locale, 'git.confirm.deleteTagTitle')}
              </h3>
            </header>
            <div className="git-confirm-modal__body">
              <div className="git-confirm-modal__path-card">
                <strong className="git-confirm-modal__path-name">{deleteConfirmName}</strong>
              </div>
            </div>
            <footer className="git-confirm-modal__footer">
              <button
                type="button"
                className="v-btn v-btn-secondary"
                onClick={() => setDeleteConfirmName(null)}
                disabled={submitting}
              >
                {t(locale, 'git.action.cancel')}
              </button>
              <button
                type="button"
                className="v-btn v-btn-danger git-confirm-modal__danger-btn"
                onClick={() => void handleDeleteConfirm()}
                disabled={submitting}
              >
                <span className="git-confirm-modal__danger-signal" aria-hidden="true" />
                {t(locale, 'git.action.deleteTag')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  )
})
