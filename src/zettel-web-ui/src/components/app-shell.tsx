import { useState, useEffect, useCallback, useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { Header } from './header'
import { CommandMenu } from './command-menu'
import { CaptureButton } from './capture-button'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { useCommandMenu } from '@/hooks/use-command-menu'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useVisualViewport } from '@/hooks/use-visual-viewport'
import { toast } from 'sonner'

/**
 * Top-level application shell that renders the header, routed content, command menu, capture button, and keyboard shortcuts dialog while managing related global UI state.
 *
 * Registers global listeners for tag-search events and online/offline status, and wires keyboard shortcut handlers (including navigation to settings).
 *
 * @returns The rendered application shell React element.
 */
export function AppShell() {
  const navigate = useNavigate()
  const { open, setOpen } = useCommandMenu()
  const [initialQuery, setInitialQuery] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const { keyboardOpen, height: viewportHeight } = useVisualViewport()

  // Listen for tag search events from NoteView
  useEffect(() => {
    const handler = (e: Event) => {
      const tag = (e as CustomEvent<string>).detail
      setInitialQuery(`#${tag}`)
      setOpen(true)
    }
    window.addEventListener('zettel:search-tag', handler)
    return () => window.removeEventListener('zettel:search-tag', handler)
  }, [setOpen])

  // Clear initialQuery when command menu closes
  const handleOpenChange = useCallback(
    (value: boolean) => {
      if (!value) setInitialQuery('')
      setOpen(value)
    },
    [setOpen],
  )

  // Offline indicator
  useEffect(() => {
    const handleOffline = () => {
      toast.warning('You are offline. Changes may not be saved.', {
        duration: Infinity,
        id: 'offline-indicator',
      })
    }
    const handleOnline = () => {
      toast.dismiss('offline-indicator')
      toast.success('Back online', { duration: 3000 })
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    // Show immediately if already offline
    if (!navigator.onLine) {
      handleOffline()
    }

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

  const shortcutHandlers = useMemo(
    () => ({
      onShowShortcuts: () => setShortcutsOpen(true),
      onOpenSettings: () => navigate('/settings'),
    }),
    [navigate],
  )
  useKeyboardShortcuts(shortcutHandlers)

  return (
    <div
      className="min-h-screen"
      style={keyboardOpen ? { height: `${viewportHeight}px`, overflow: 'auto' } : undefined}
    >
      <Header onOpenSearch={() => setOpen(true)} />
      <main className={keyboardOpen ? 'pb-2' : 'pb-20'}>
        <Outlet />
      </main>
      <CommandMenu
        open={open}
        onOpenChange={handleOpenChange}
        initialQuery={initialQuery}
      />
      <CaptureButton />
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  )
}
