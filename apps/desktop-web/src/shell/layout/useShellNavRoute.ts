import { useCallback, useEffect, useState } from 'react'
import { isNavItemId, readString } from './ShellRoot.shared'
import type { NavItemId } from './navigation-model'

const NAV_HASH_KEY = 'nav'

function parseNavIdFromHash(hash: string): NavItemId | null {
  const rawHash = hash.trim()
  if (!rawHash.startsWith('#')) {
    return null
  }

  const body = rawHash.slice(1)
  const params = new URLSearchParams(body)
  const fromQuery = readString(params.get(NAV_HASH_KEY) ?? null)
  if (fromQuery && isNavItemId(fromQuery)) {
    return fromQuery
  }

  const normalizedBody = body.replace(/^\/+/, '')
  return isNavItemId(normalizedBody) ? normalizedBody : null
}

function buildNavHash(navId: NavItemId): string {
  const params = new URLSearchParams()
  params.set(NAV_HASH_KEY, navId)
  return `#${params.toString()}`
}

export function useShellNavRoute(defaultNavId: NavItemId): [NavItemId, (next: NavItemId) => void] {
  const [navId, setNavIdState] = useState<NavItemId>(() => {
    if (typeof window === 'undefined') {
      return defaultNavId
    }
    return parseNavIdFromHash(window.location.hash) ?? defaultNavId
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncFromLocation = () => {
      setNavIdState(parseNavIdFromHash(window.location.hash) ?? defaultNavId)
    }

    window.addEventListener('hashchange', syncFromLocation)
    return () => {
      window.removeEventListener('hashchange', syncFromLocation)
    }
  }, [defaultNavId])

  const setNavId = useCallback((next: NavItemId) => {
    setNavIdState((prev) => (prev === next ? prev : next))
    if (typeof window === 'undefined') {
      return
    }
    const nextHash = buildNavHash(next)
    if (window.location.hash === nextHash) {
      return
    }
    window.history.replaceState(window.history.state, '', `${window.location.search}${nextHash}`)
  }, [])

  return [navId, setNavId]
}
