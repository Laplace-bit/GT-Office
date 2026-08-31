import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            padding: '20px',
            margin: '20px',
            backgroundColor: 'var(--vb-surface-elevated)',
            border: '1px solid color-mix(in srgb, var(--vb-error) 38%, transparent)',
            borderRadius: 'var(--vb-radius-md)',
            fontFamily: 'var(--vb-font-mono)',
            fontSize: '13px',
            color: 'var(--vb-text)',
            maxHeight: '80vh',
            overflow: 'auto',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', color: 'var(--vb-error)' }}>
            Something went wrong
          </h2>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
              <strong>{this.state.error?.name || 'Error'}</strong>
              : {this.state.error?.message || 'Unknown error'}
            </summary>
            <div style={{ marginTop: '12px' }}>
              <strong>Stack trace:</strong>
              <pre
                style={{
                  margin: '8px 0',
                  padding: '12px',
                  backgroundColor: 'color-mix(in srgb, var(--vb-error) 7%, transparent)',
                  borderRadius: 'var(--vb-radius-sm)',
                  overflow: 'auto',
                }}
              >
                {this.state.error?.stack || 'No stack trace available'}
              </pre>
              {this.state.errorInfo?.componentStack && (
                <>
                  <strong>Component stack:</strong>
                  <pre
                    style={{
                      margin: '8px 0',
                      padding: '12px',
                      backgroundColor: 'color-mix(in srgb, var(--vb-error) 7%, transparent)',
                      borderRadius: 'var(--vb-radius-sm)',
                      overflow: 'auto',
                    }}
                  >
                    {this.state.errorInfo.componentStack}
                  </pre>
                </>
              )}
            </div>
          </details>
        </div>
      )
    }

    return this.props.children
  }
}