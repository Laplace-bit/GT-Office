import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.scss'
import App from './App.tsx'
import { applyUiPreferences, loadUiPreferences } from './shell/state/ui-preferences.ts'

applyUiPreferences(loadUiPreferences())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
