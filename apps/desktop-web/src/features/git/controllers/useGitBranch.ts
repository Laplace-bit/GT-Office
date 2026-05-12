import { useCallback, useMemo, useState } from 'react'
import {
  desktopApi,
  type GitBranchEntry,
} from '@shell/integration/desktop-api'
import type { Locale } from '@shell/i18n/ui-locale'
import { t } from '@shell/i18n/ui-locale'

interface UseGitBranchInput {
  workspaceId: string | null
  isGitRepository: boolean
  locale: Locale
  branches: GitBranchEntry[]
  checkoutTarget: string
  setCheckoutTarget: (target: string | ((prev: string) => string)) => void
  runAction: (actionKey: string, runner: () => Promise<void>) => Promise<void>
  invalidateDiffCache: () => void
  onRefreshBranches: () => Promise<void>
  onRefreshAll: () => Promise<void>
}

interface UseGitBranchResult {
  newBranchName: string
  setNewBranchName: (name: string) => void
  selectedBranchEntry: GitBranchEntry | null
  checkout: () => Promise<void>
  checkoutTo: (target: string) => Promise<void>
  createBranch: () => Promise<void>
  deleteBranch: () => Promise<void>
}

export function useGitBranch({
  workspaceId,
  isGitRepository,
  locale,
  branches,
  checkoutTarget,
  setCheckoutTarget,
  runAction,
  invalidateDiffCache,
  onRefreshBranches,
  onRefreshAll,
}: UseGitBranchInput): UseGitBranchResult {
  // Only newBranchName is local state
  const [newBranchName, setNewBranchName] = useState('')

  const selectedBranchEntry = useMemo(
    () => branches.find((item) => item.name === checkoutTarget) ?? null,
    [branches, checkoutTarget],
  )

  const checkoutTo = useCallback(async (target: string) => {
    const nextTarget = target.trim()
    if (!workspaceId || !isGitRepository || !nextTarget) {
      return
    }
    setCheckoutTarget(nextTarget)
    await runAction('checkout', async () => {
      await desktopApi.gitCheckout(workspaceId, nextTarget, { create: false })
      invalidateDiffCache()
      await onRefreshAll()
    })
  }, [
    invalidateDiffCache,
    isGitRepository,
    onRefreshAll,
    runAction,
    setCheckoutTarget,
    workspaceId,
  ])

  const checkout = useCallback(async () => {
    await checkoutTo(checkoutTarget)
  }, [checkoutTarget, checkoutTo])

  const createBranch = useCallback(async () => {
    const branch = newBranchName.trim()
    if (!workspaceId || !isGitRepository || !branch) {
      return
    }
    await runAction('create-branch', async () => {
      await desktopApi.gitCreateBranch(workspaceId, branch, null)
      setNewBranchName('')
      setCheckoutTarget(branch)
      await onRefreshBranches()
    })
  }, [isGitRepository, newBranchName, onRefreshBranches, runAction, setCheckoutTarget, workspaceId])

  const deleteBranch = useCallback(async () => {
    if (!workspaceId || !isGitRepository || !checkoutTarget.trim()) {
      return
    }
    if (selectedBranchEntry?.current) {
      return
    }
    if (!window.confirm(t(locale, 'git.confirm.deleteBranch', { branch: checkoutTarget }))) {
      return
    }
    await runAction('delete-branch', async () => {
      await desktopApi.gitDeleteBranch(workspaceId, checkoutTarget, false)
      await onRefreshBranches()
    })
  }, [
    checkoutTarget,
    isGitRepository,
    locale,
    onRefreshBranches,
    runAction,
    selectedBranchEntry?.current,
    workspaceId,
  ])

  return {
    newBranchName,
    setNewBranchName,
    selectedBranchEntry,
    checkout,
    checkoutTo,
    createBranch,
    deleteBranch,
  }
}
