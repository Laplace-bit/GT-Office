import type { PaneModel } from './navigation-model'
import './LeftBusinessPane.scss'

interface LeftBusinessPaneProps {
  model: PaneModel
}

export function LeftBusinessPane({ model }: LeftBusinessPaneProps) {
  return (
    <aside className="panel left-pane">
      <h2>{model.title}</h2>
      <p>{model.subtitle}</p>
      <ul>
        {model.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  )
}
