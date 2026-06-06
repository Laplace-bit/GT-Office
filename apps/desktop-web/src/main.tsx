import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shell/integration/monaco-env'
import { installInputDefaults } from './shell/integration/input-defaults.ts'
import './styles/index.scss'
import App from './App.tsx'
import { applyUiPreferences, loadUiPreferences } from './shell/state/ui-preferences.ts'

installInputDefaults()
applyUiPreferences(loadUiPreferences())

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('GT Office root element is missing')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
