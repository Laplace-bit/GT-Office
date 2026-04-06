declare module 'react-zoom-pan-pinch' {
  import { ReactNode } from 'react'

  export interface TransformComponentProps {
    children?: ReactNode
    wrapperStyle?: React.CSSProperties
    contentStyle?: React.CSSProperties
    wrapperClass?: string
    contentClass?: string
  }

  export interface TransformWrapperProps {
    children?: ReactNode | ((utils: ControlsProps) => ReactNode)
    initialScale?: number
    minScale?: number
    maxScale?: number
    centerOnInit?: boolean
    limitToBounds?: boolean
    limitToWrapper?: boolean
    centerZoomedOut?: boolean
    disabled?: boolean
    alignment?: 'center' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
    onZoomStart?: () => void
    onZoom?: () => void
    onZoomStop?: () => void
    onPanningStart?: () => void
    onPanning?: () => void
    onPanningStop?: () => void
    onPinchingStart?: () => void
    onPinching?: () => void
    onPinchingStop?: () => void
  }

  export interface ControlsProps {
    zoomIn: () => void
    zoomOut: () => void
    resetTransform: () => void
    centerView: () => void
    setTransform: (scale?: number, positionX?: number, positionY?: number) => void
    state: {
      scale: number
      positionX: number
      positionY: number
    }
  }

  export function TransformWrapper(props: TransformWrapperProps): ReactNode
  export function TransformComponent(props: TransformComponentProps): ReactNode
  export function useControls(): ControlsProps
}