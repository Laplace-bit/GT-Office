import { memo, useState, useEffect, useRef } from 'react'
import './FileTreeModals.scss'

interface FileTreePromptModalProps {
  open: boolean
  title: string
  defaultValue?: string
  placeholder?: string
  onClose: () => void
  onSubmit: (value: string) => void
}

export const FileTreePromptModal = memo(({
  open,
  title,
  defaultValue = '',
  placeholder,
  onClose,
  onSubmit
}: FileTreePromptModalProps) => {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const timerId = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [open])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSubmit(value)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div className="file-tree-modal-overlay" onClick={onClose}>
      <div className="file-tree-modal-content" onClick={e => e.stopPropagation()}>
        <header className="file-tree-modal-header">
          <h3>{title}</h3>
        </header>
        <div className="file-tree-modal-body">
          <input
            ref={inputRef}
            type="text"
            className="file-tree-modal-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
        </div>
        <footer className="file-tree-modal-footer">
          <button className="v-btn v-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="v-btn v-btn-primary" onClick={() => onSubmit(value)} disabled={!value.trim()}>Confirm</button>
        </footer>
      </div>
    </div>
  )
})

interface FileTreeConfirmModalProps {
  open: boolean
  title: string
  message: string
  onClose: () => void
  onConfirm: () => void
}

export const FileTreeConfirmModal = memo(({
  open,
  title,
  message,
  onClose,
  onConfirm
}: FileTreeConfirmModalProps) => {
  if (!open) return null

  return (
    <div className="file-tree-modal-overlay" onClick={onClose}>
      <div className="file-tree-modal-content" onClick={e => e.stopPropagation()}>
        <header className="file-tree-modal-header">
          <h3>{title}</h3>
        </header>
        <div className="file-tree-modal-body">
          <p>{message}</p>
        </div>
        <footer className="file-tree-modal-footer">
          <button className="v-btn v-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="v-btn v-btn-danger" onClick={onConfirm}>Delete</button>
        </footer>
      </div>
    </div>
  )
})
