import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shell/integration/monaco-env'
import { installInputDefaults } from './shell/integration/input-defaults.ts'
import './styles/index.scss'
import App from './App.tsx'
import { applyUiPreferences, loadUiPreferences } from './shell/state/ui-preferences.ts'
import { desktopApi } from './shell/integration/desktop-api.ts'

installInputDefaults()
applyUiPreferences(loadUiPreferences())
// Reveal native macOS window vibrancy once the shell confirms it was applied.
// Non-critical: on failure the app keeps its CSS-glass rendering.
if (desktopApi.isTauriRuntime()) {
  desktopApi
    .nativeVibrancyStatus()
    .then((active) => {
      if (active) {
        document.documentElement.setAttribute('data-vb-native-vibrancy', 'true')
      }
    })
    .catch(() => {})
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('GT Office root element is missing')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
