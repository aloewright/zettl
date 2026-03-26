import { useState, useEffect } from 'react'

interface VisualViewportState {
  /** Height of the visible viewport in CSS pixels (shrinks when mobile keyboard opens) */
  height: number
  /** Offset from the top of the layout viewport to the visual viewport (scroll caused by keyboard) */
  offsetTop: number
  /** Whether the virtual keyboard is likely open (viewport significantly shorter than window) */
  keyboardOpen: boolean
}

/**
 * Hook that tracks the VisualViewport API for mobile-aware layouts.
 *
 * On mobile devices, the virtual keyboard reduces the visible viewport.
 * This hook exposes the current visual viewport height, offset, and
 * a derived `keyboardOpen` boolean so components can adapt their layout.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    offsetTop: window.visualViewport?.offsetTop ?? 0,
    keyboardOpen: false,
  }))

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const threshold = 150 // px difference to consider keyboard open

    const update = () => {
      const height = vv.height
      const offsetTop = vv.offsetTop
      const keyboardOpen = window.innerHeight - height > threshold
      setState({ height, offsetTop, keyboardOpen })
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    // Initial measurement
    update()

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return state
}
