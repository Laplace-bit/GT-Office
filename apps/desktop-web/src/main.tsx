import { createRoot } from 'react-dom/client'
import { ShellStartupFrame } from './shell/layout/ShellStartupFrame'
import './shell/layout/ShellStartupFrame.scss'

if (typeof performance !== 'undefined') {
  performance.mark('gtoffice:main-module-loaded')
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('GT Office root element is missing')
}

const root = createRoot(rootElement)
root.render(<ShellStartupFrame />)

if (typeof performance !== 'undefined') {
  performance.mark('gtoffice:first-paint')
}

void import('./mount-application')
  .then((module) => module.mountFullApplication(root))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    rootElement.innerHTML =
      '<div style="padding:20px;font-family:system-ui,sans-serif;color:#b91c1c;">' +
      '<strong>GT Office failed to start.</strong><br />' +
      message +
      '</div>'
  })
