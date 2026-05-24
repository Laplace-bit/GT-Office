import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import App from './App'
import { applyUiPreferences, loadUiPreferences } from './shell/state/ui-preferences'

export async function mountFullApplication(root: Root): Promise<void> {
  await import('./styles/index.scss')
  applyUiPreferences(loadUiPreferences())
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
