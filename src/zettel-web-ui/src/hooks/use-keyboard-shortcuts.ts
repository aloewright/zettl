import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router'

interface ShortcutHandlers {
  onSave?: () => void
  onShowShortcuts?: () => void
  onOpenSettings?: () => void
}

/**
 * Registers global keyboard shortcuts that trigger navigation or provided callbacks.
 *
 * Registers a document-level keydown listener that invokes handlers or navigates based on specific key combinations and the current route/typing context.
 *
 * Supported shortcuts:
 * - Cmd/Ctrl + L: calls `handlers.onOpenSettings` (prevents default)
 * - Cmd/Ctrl + N: navigates to `/new` (prevents default)
 * - Cmd/Ctrl + S: calls `handlers.onSave` (prevents default)
 * - `?` (when not typing and no modifier): calls `handlers.onShowShortcuts`
 * - Escape (when not Shift or modifier): navigates to `/` unless a dialog is open, the current path is `/`, or the path is an editor (`/edit` or `/new`)
 *
 * @param handlers - Optional callbacks invoked by corresponding shortcuts:
 *   - `onOpenSettings` — invoked for Cmd/Ctrl + L
 *   - `onSave` — invoked for Cmd/Ctrl + S
 *   - `onShowShortcuts` — invoked for `?`
 */
export function useKeyboardShortcuts(handlers?: ShortcutHandlers) {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      // Cmd+L -> settings
      if (isMod && e.key === 'l') {
        e.preventDefault()
        handlers?.onOpenSettings?.()
        return
      }

      // Cmd+N -> new note
      if (isMod && e.key === 'n') {
        e.preventDefault()
        navigate('/new')
        return
      }

      // Cmd+S -> save (editor only)
      if (isMod && e.key === 's') {
        e.preventDefault()
        handlers?.onSave?.()
        return
      }

      // ? -> show keyboard shortcuts (only when not typing)
      // On US keyboards, ? is Shift+/ so e.key === '?' and e.shiftKey === true
      if (e.key === '?' && !isMod && !isTyping) {
        handlers?.onShowShortcuts?.()
        return
      }

      // Escape -> go back (or home if already on home)
      if (e.key === 'Escape' && !e.shiftKey && !isMod) {
        // Don't navigate back if a dialog/command menu is open
        const dialogOpen = document.querySelector('[role="dialog"]')
        if (dialogOpen) return
        if (location.pathname === '/') return
        // Don't navigate away from editor pages (would lose unsaved work)
        if (location.pathname.includes('/edit') || location.pathname === '/new') return
        navigate('/')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [navigate, handlers, location.pathname])
}
