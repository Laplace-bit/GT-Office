import { useEffect, useState } from 'react'

const DEFAULT_ROOT_FONT_SIZE_PX = 16
const DESIGN_BASE_FONT_SIZE_PX = 14

export function readRootFontSizePx(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_ROOT_FONT_SIZE_PX
  }
  const value = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ROOT_FONT_SIZE_PX
}

export function designPxToRem(value: number): string {
  return `${value / DESIGN_BASE_FONT_SIZE_PX}rem`
}

export function actualPxToRem(value: number, rootFontSizePx: number): string {
  return `${value / rootFontSizePx}rem`
}

export function scaleDesignPxToActualPx(value: number, rootFontSizePx: number): number {
  return Math.round((value / DESIGN_BASE_FONT_SIZE_PX) * rootFontSizePx)
}

export function useRootFontSizePx(): number {
  const [rootFontSizePx, setRootFontSizePx] = useState(() => readRootFontSizePx())

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const update = () => {
      setRootFontSizePx(readRootFontSizePx())
    }

    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })

    return () => observer.disconnect()
  }, [])

  return rootFontSizePx
}
