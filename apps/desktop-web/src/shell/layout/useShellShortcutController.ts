import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import {
  areShortcutBindingsEqual,
  formatNativeMenuAccelerator,
  getDefaultShortcutBindings,
  matchesShortcutEvent,
  resolveShortcutBindingsFromSettings,
  shortcutBindingToKeystroke,
  type ShortcutBinding,
  type ShortcutBindings,
} from '@features/keybindings'
import {
  DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  normalizeTaskQuickDispatchOpacity,
} from '@features/task-center'
import {
  applyUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_UPDATED_EVENT,
  type UiPreferences,
} from '../state/ui-preferences'
import { desktopApi } from '../integration/desktop-api'
import { t } from '../i18n/ui-locale'
import {
  readTaskQuickDispatchOpacityFromSettings,
  shouldPreventDesktopBrowserShortcut,
} from './ShellRoot.shared'
import { addNotification } from '@/stores/notification'

interface UseShellShortcutControllerInput {
  nativeWindowTopMacOs: boolean
  tauriRuntime: boolean
  platformDefaultShortcutBindings: ShortcutBindings
  activeWorkspaceId: string | null
  triggerFileSearchRef: MutableRefObject<(mode?: 'file' | 'content') => void>
  requestCloseWorkspaceRef: MutableRefObject<(workspaceId: string) => void>
  triggerFileEditorCommandRef: MutableRefObject<
    (type: 'find' | 'replace' | 'findNext' | 'findPrevious') => void
  >
  shouldRouteFileEditorShortcutRef: MutableRefObject<(target: EventTarget | null) => boolean>
  activeWorkspaceIdRef: MutableRefObject<string | null>
}

export interface ShellShortcutController {
  uiPreferences: UiPreferences
  setUiPreferences: React.Dispatch<React.SetStateAction<UiPreferences>>
  shortcutBindings: ShortcutBindings
  taskQuickDispatchOpacity: number
  isTaskQuickDispatchOpen: boolean
  closeTaskQuickDispatch: () => void
  handleTaskQuickDispatchShortcutChange: (binding: ShortcutBinding) => void
  handleTaskQuickDispatchShortcutReset: () => void
  handleTaskQuickDispatchOpacityChange: (value: number) => void
}

export function useShellShortcutController({
  nativeWindowTopMacOs,
  tauriRuntime,
  platformDefaultShortcutBindings,
  activeWorkspaceId,
  triggerFileSearchRef,
  requestCloseWorkspaceRef,
  triggerFileEditorCommandRef,
  shouldRouteFileEditorShortcutRef,
  activeWorkspaceIdRef,
}: UseShellShortcutControllerInput): ShellShortcutController {
  const [uiPreferences, setUiPreferences] = useState(loadUiPreferences)
  const [shortcutBindings, setShortcutBindings] = useState(() => platformDefaultShortcutBindings)
  const [taskQuickDispatchOpacity, setTaskQuickDispatchOpacity] = useState(
    DEFAULT_TASK_QUICK_DISPATCH_OPACITY,
  )
  const [isTaskQuickDispatchOpen, setIsTaskQuickDispatchOpen] = useState(false)
  const locale = uiPreferences.locale

  const macOsNativeMenuInstallSeqRef = useRef(0)
  const shortcutBindingsRef = useRef(shortcutBindings)

  // --- Callbacks ---

  const persistShortcutBindings = useCallback(
    (bindings: ShortcutBindings) => {
      if (!desktopApi.isTauriRuntime()) {
        return
      }

      void desktopApi
        .settingsUpdate('user', {
          keybindings: {
            overrides: [
              {
                command: 'shell.search.open_file',
                keystroke: shortcutBindingToKeystroke(bindings.openFileSearch),
              },
              {
                command: 'shell.search.open_content',
                keystroke: shortcutBindingToKeystroke(bindings.openContentSearch),
              },
              {
                command: 'shell.editor.find',
                keystroke: shortcutBindingToKeystroke(bindings.editorFind),
              },
              {
                command: 'shell.editor.replace',
                keystroke: shortcutBindingToKeystroke(bindings.editorReplace),
              },
              {
                command: 'task.center.quick_dispatch',
                keystroke: shortcutBindingToKeystroke(bindings.taskQuickDispatch),
              },
            ],
          },
        })
        .catch(() => {
          // Keep local shortcut state even if settings persistence fails.
        })
    },
    [],
  )

  const handleTaskQuickDispatchShortcutChange = useCallback(
    (binding: ShortcutBinding) => {
      setShortcutBindings((prev) => {
        const next = {
          ...prev,
          taskQuickDispatch: binding,
        }
        persistShortcutBindings(next)
        return next
      })
    },
    [persistShortcutBindings],
  )

  const handleTaskQuickDispatchShortcutReset = useCallback(() => {
    setShortcutBindings((prev) => {
      const next = {
        ...prev,
        taskQuickDispatch: platformDefaultShortcutBindings.taskQuickDispatch,
      }
      persistShortcutBindings(next)
      return next
    })
  }, [persistShortcutBindings, platformDefaultShortcutBindings.taskQuickDispatch])

  const handleTaskQuickDispatchOpacityChange = useCallback((value: number) => {
    const nextOpacity = normalizeTaskQuickDispatchOpacity(value)
    setTaskQuickDispatchOpacity(nextOpacity)
    if (!desktopApi.isTauriRuntime()) {
      return
    }

    void desktopApi
      .settingsUpdate('user', {
        ui: {
          taskQuickDispatch: {
            opacity: nextOpacity,
          },
        },
      })
      .catch(() => {
        // The overlay remains usable even if settings persistence fails.
      })
  }, [])

  const closeTaskQuickDispatch = useCallback(() => {
    setIsTaskQuickDispatchOpen(false)
  }, [])

  const isShortcutRepeat = useCallback((event: KeyboardEvent) => event.repeat, [])

  // --- Effects ---

  // UI preferences apply & persist
  useEffect(() => {
    applyUiPreferences(uiPreferences)
    saveUiPreferences(uiPreferences)
  }, [uiPreferences])

  // Cross-tab UI preferences sync
  useEffect(() => {
    const syncUiPreferences = () => {
      setUiPreferences(loadUiPreferences())
    }

    window.addEventListener(UI_PREFERENCES_UPDATED_EVENT, syncUiPreferences)
    return () => {
      window.removeEventListener(UI_PREFERENCES_UPDATED_EVENT, syncUiPreferences)
    }
  }, [])

  // App update check
  useEffect(() => {
    if (!tauriRuntime || !uiPreferences.autoCheckAppUpdates) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void desktopApi.settingsUpdateCheck().then((response) => {
        if (
          cancelled ||
          !response.updateAvailable ||
          !response.version ||
          response.version === uiPreferences.skippedAppUpdateVersion
        ) {
          return
        }
        addNotification({
          type: 'info',
          message: t(
            uiPreferences.locale,
            `GT Office ${response.version} 已可更新，请在设置中查看并安装。`,
            `GT Office ${response.version} is available. Open Settings to review and install it.`,
          ),
          duration: 8000,
        })
      }).catch(() => {
        // Startup update checks are best-effort and should stay silent here.
      })
    }, 4000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    tauriRuntime,
    uiPreferences.autoCheckAppUpdates,
    uiPreferences.locale,
    uiPreferences.skippedAppUpdateVersion,
  ])

  // Settings sync: load runtime shortcuts & task dispatch opacity from backend
  useEffect(() => {
    if (!tauriRuntime) {
      return
    }

    let disposed = false
    let cleanup: (() => void) | null = null

    const loadRuntimeSettings = async () => {
      try {
        const response = await desktopApi.settingsGetEffective(activeWorkspaceId)
        if (disposed) {
          return
        }
        const runtimeShortcuts = resolveShortcutBindingsFromSettings(
          response.values,
          nativeWindowTopMacOs,
        )
        const normalizedRuntimeShortcuts =
          nativeWindowTopMacOs &&
          shortcutBindingToKeystroke(runtimeShortcuts.editorReplace) ===
            shortcutBindingToKeystroke(getDefaultShortcutBindings(false).editorReplace)
            ? {
                ...runtimeShortcuts,
                editorReplace: platformDefaultShortcutBindings.editorReplace,
              }
            : runtimeShortcuts
        setShortcutBindings((prev) =>
          areShortcutBindingsEqual(prev, normalizedRuntimeShortcuts)
            ? prev
            : normalizedRuntimeShortcuts,
        )
        if (
          nativeWindowTopMacOs &&
          !areShortcutBindingsEqual(runtimeShortcuts, normalizedRuntimeShortcuts)
        ) {
          void desktopApi
            .settingsUpdate('user', {
              keybindings: {
                overrides: [
                  {
                    command: 'shell.search.open_file',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.openFileSearch,
                    ),
                  },
                  {
                    command: 'shell.search.open_content',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.openContentSearch,
                    ),
                  },
                  {
                    command: 'shell.editor.find',
                    keystroke: shortcutBindingToKeystroke(normalizedRuntimeShortcuts.editorFind),
                  },
                  {
                    command: 'shell.editor.replace',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.editorReplace,
                    ),
                  },
                  {
                    command: 'task.center.quick_dispatch',
                    keystroke: shortcutBindingToKeystroke(
                      normalizedRuntimeShortcuts.taskQuickDispatch,
                    ),
                  },
                ],
              },
            })
            .catch(() => {
              // Keep normalized runtime shortcuts in memory even if migration persistence fails.
            })
        }
        const runtimeTaskQuickDispatchOpacity = readTaskQuickDispatchOpacityFromSettings(
          response.values,
        )
        if (runtimeTaskQuickDispatchOpacity !== null) {
          setTaskQuickDispatchOpacity((prev) =>
            prev === runtimeTaskQuickDispatchOpacity ? prev : runtimeTaskQuickDispatchOpacity,
          )
        }
      } catch {
        // Keep local preference when settings service is unavailable.
      }
    }

    void loadRuntimeSettings()

    void desktopApi
      .subscribeSettingsUpdated((payload) => {
        if (payload.workspaceId && activeWorkspaceId && payload.workspaceId !== activeWorkspaceId) {
          return
        }
        if (payload.workspaceId && !activeWorkspaceId) {
          return
        }
        void loadRuntimeSettings()
      })
      .then((unlisten) => {
        cleanup = unlisten
      })

    return () => {
      disposed = true
      if (cleanup) {
        cleanup()
      }
    }
  }, [
    activeWorkspaceId,
    nativeWindowTopMacOs,
    platformDefaultShortcutBindings.editorReplace,
  ])

  // Ref sync effects
  useEffect(() => {
    shortcutBindingsRef.current = shortcutBindings
  }, [shortcutBindings])

  // macOS native menu install
  useEffect(() => {
    if (!nativeWindowTopMacOs || !tauriRuntime) {
      return
    }

    let disposed = false
    const installSeq = macOsNativeMenuInstallSeqRef.current + 1
    macOsNativeMenuInstallSeqRef.current = installSeq

    const installNativeShortcutMenu = async () => {
      try {
        const { Menu, Submenu } = await import('@tauri-apps/api/menu')
        if (disposed || installSeq !== macOsNativeMenuInstallSeqRef.current) {
          return
        }

        const searchMenu = await Submenu.new({
          text: t(locale, '工作区搜索', 'Search'),
          items: [
            {
              id: 'shell.search.open_file',
              text: t(locale, '文件搜索', 'Quick Open'),
              accelerator: formatNativeMenuAccelerator(shortcutBindings.openFileSearch, true),
              action: () => {
                triggerFileSearchRef.current('file')
              },
            },
            {
              id: 'shell.search.open_content',
              text: t(locale, '内容搜索', 'Search In Files'),
              accelerator: formatNativeMenuAccelerator(shortcutBindings.openContentSearch, true),
              action: () => {
                triggerFileSearchRef.current('content')
              },
            },
          ],
        })
        const editMenu = await Submenu.new({
          text: t(locale, '编辑', 'Edit'),
          items: [
            { item: 'Undo' },
            { item: 'Redo' },
            { item: 'Separator' },
            { item: 'Cut' },
            { item: 'Copy' },
            { item: 'Paste' },
            { item: 'SelectAll' },
          ],
        })
        const windowMenu = await Submenu.new({
          text: t(locale, '窗口', 'Window'),
          items: [{ item: 'Minimize' }, { item: 'Maximize' }, { item: 'Fullscreen' }],
        })
        const appMenu = await Submenu.new({
          text: 'GT Office',
          items: [
            { item: { About: { name: 'GT Office' } } },
            { item: 'Services' },
            { item: 'Separator' },
            { item: 'Hide' },
            { item: 'HideOthers' },
            { item: 'ShowAll' },
            { item: 'Separator' },
            { item: 'Quit' },
          ],
        })

        const nextMenu = await Menu.new({
          items: [appMenu, searchMenu, editMenu, windowMenu],
        })
        if (disposed || installSeq !== macOsNativeMenuInstallSeqRef.current) {
          void nextMenu.close().catch(() => {
            // Ignore stale menu disposal failures.
          })
          return
        }

        const previousMenu = await nextMenu.setAsAppMenu()
        void windowMenu.setAsWindowsMenuForNSApp().catch(() => {
          // The app menu still works even if the dedicated Window menu hint fails.
        })
        if (previousMenu) {
          void previousMenu.close().catch(() => {
            // Ignore old menu cleanup failures.
          })
        }
      } catch {
        // Ignore native menu installation failures and keep DOM shortcuts active.
      }
    }

    void installNativeShortcutMenu()

    return () => {
      disposed = true
    }
  }, [locale, nativeWindowTopMacOs, shortcutBindings.openContentSearch, shortcutBindings.openFileSearch])

  // Global keydown handler
  useEffect(() => {
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (document.body.dataset.gtoShortcutRecording === 'true') {
        return
      }

      const bindings = shortcutBindingsRef.current
      const isMacOs = nativeWindowTopMacOs

      if (matchesShortcutEvent(event, bindings.taskQuickDispatch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setIsTaskQuickDispatchOpen((prev) => !prev)
        return
      }

      if (matchesShortcutEvent(event, bindings.openContentSearch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearchRef.current('content')
        return
      }

      if (matchesShortcutEvent(event, bindings.editorFind, isMacOs)) {
        if (!shouldRouteFileEditorShortcutRef.current(event.target)) {
          return
        }
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileEditorCommandRef.current('find')
        return
      }

      if (matchesShortcutEvent(event, bindings.editorReplace, isMacOs)) {
        if (!shouldRouteFileEditorShortcutRef.current(event.target)) {
          return
        }
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileEditorCommandRef.current('replace')
        return
      }

      if (matchesShortcutEvent(event, bindings.openFileSearch, isMacOs)) {
        if (isShortcutRepeat(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        triggerFileSearchRef.current('file')
        return
      }

      // Prevent desktop WebView reload/zoom shortcuts without swallowing plain text input.
      if (desktopApi.isTauriRuntime() && shouldPreventDesktopBrowserShortcut(event)) {
        event.preventDefault()
        event.stopPropagation()
      }

      // Cmd/Ctrl+W to close active workspace tab
      if (event.key === 'w' && (isMacOs ? event.metaKey : event.ctrlKey)) {
        const activeId = activeWorkspaceIdRef.current
        if (activeId) {
          event.preventDefault()
          event.stopPropagation()
          requestCloseWorkspaceRef.current(activeId)
        }
      }
    }

    window.addEventListener('keydown', onGlobalShortcut, { capture: true })
    return () => {
      window.removeEventListener('keydown', onGlobalShortcut, { capture: true })
    }
  }, [isShortcutRepeat, nativeWindowTopMacOs])

  return {
    uiPreferences,
    setUiPreferences,
    shortcutBindings,
    taskQuickDispatchOpacity,
    isTaskQuickDispatchOpen,
    closeTaskQuickDispatch,
    handleTaskQuickDispatchShortcutChange,
    handleTaskQuickDispatchShortcutReset,
    handleTaskQuickDispatchOpacityChange,
  }
}