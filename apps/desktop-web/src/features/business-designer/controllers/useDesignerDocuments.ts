import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DesignerCreateDocumentParams,
  DesignerDocumentDetail,
  DesignerDocumentSummary,
  DesignerInitDocsRepoResponse,
  DesignerListDocumentsResponse,
} from '../model/designer-document'
import {
  createDesignerDocument,
  initDesignerDocsRepo,
  isBusinessDesignerRuntime,
  listDesignerDocuments,
} from './designerDesktopApi'

interface UseDesignerDocumentsInput {
  workspaceId: string | null
  active: boolean
}

interface UseDesignerDocumentsState {
  response: DesignerListDocumentsResponse | null
  documents: DesignerDocumentSummary[]
  selectedDocumentId: string | null
  loading: boolean
  initializing: boolean
  creating: boolean
  error: string | null
  lastInitResult: DesignerInitDocsRepoResponse | null
  selectDocument: (documentId: string) => void
  refresh: () => Promise<void>
  initializeDocsRepo: () => Promise<void>
  createDocument: (params: DesignerCreateDocumentParams) => Promise<DesignerDocumentDetail | null>
}

export function useDesignerDocuments({
  workspaceId,
  active,
}: UseDesignerDocumentsInput): UseDesignerDocumentsState {
  const [response, setResponse] = useState<DesignerListDocumentsResponse | null>(null)
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastInitResult, setLastInitResult] = useState<DesignerInitDocsRepoResponse | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId || !isBusinessDesignerRuntime()) {
      setResponse(null)
      setSelectedDocumentId(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const nextResponse = await listDesignerDocuments(workspaceId)
      setResponse(nextResponse)
      setSelectedDocumentId((prev) => {
        if (prev && nextResponse.documents.some((document) => document.documentId === prev)) {
          return prev
        }
        return nextResponse.documents[0]?.documentId ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const initializeDocsRepo = useCallback(async () => {
    if (!workspaceId || !isBusinessDesignerRuntime()) {
      return
    }

    setInitializing(true)
    setError(null)
    try {
      const initResult = await initDesignerDocsRepo(workspaceId)
      setLastInitResult(initResult)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInitializing(false)
    }
  }, [refresh, workspaceId])

  const createDocument = useCallback(
    async (params: DesignerCreateDocumentParams) => {
      if (!workspaceId || !isBusinessDesignerRuntime()) {
        return null
      }

      setCreating(true)
      setError(null)
      try {
        const detail = await createDesignerDocument(workspaceId, params)
        setSelectedDocumentId(detail.manifest.documentId)
        await refresh()
        return detail
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      } finally {
        setCreating(false)
      }
    },
    [refresh, workspaceId],
  )

  useEffect(() => {
    if (!active) {
      return
    }
    void refresh()
  }, [active, refresh])

  const documents = response?.documents ?? []

  return useMemo(
    () => ({
      response,
      documents,
      selectedDocumentId,
      loading,
      initializing,
      creating,
      error,
      lastInitResult,
      selectDocument: setSelectedDocumentId,
      refresh,
      initializeDocsRepo,
      createDocument,
    }),
    [
      createDocument,
      creating,
      documents,
      error,
      initializeDocsRepo,
      initializing,
      lastInitResult,
      loading,
      refresh,
      response,
      selectedDocumentId,
    ],
  )
}
