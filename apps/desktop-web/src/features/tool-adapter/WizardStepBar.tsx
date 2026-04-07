/** Shared wizard step progress bar */
export function WizardStepBar({ total, current }: { total: number; current: number }) {
  return (
    <div className="channel-wizard-step-bar">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={`channel-wizard-step-segment ${index === current ? 'active' : ''} ${index < current ? 'completed' : ''}`}
        />
      ))}
    </div>
  )
}
