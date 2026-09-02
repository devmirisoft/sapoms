import type React from "react"

export type FloatingMenuState = { id: string; top: number; left: number; flip: boolean } | null

const GUTTER = 12
const OFFSET = 8

export function isMenuOpen(openMenu: FloatingMenuState, id: string) {
  return openMenu?.id === id
}

/**
 * Place the menu under the button, flipping above it when it would overflow the
 * viewport. Called once on open with an estimated height, then again from the
 * menu's ref with its measured height, so a menu with a variable number of
 * items lands correctly instead of running off the bottom of the screen.
 */
function place(button: DOMRect, width: number, height: number) {
  const fitsBelow = button.bottom + OFFSET + height <= window.innerHeight - GUTTER
  return {
    top: fitsBelow
      ? button.bottom + OFFSET
      : Math.max(GUTTER, button.top - OFFSET - height),
    left: Math.max(GUTTER, Math.min(button.right - width, window.innerWidth - width - GUTTER)),
    flip: !fitsBelow,
  }
}

export function openFloatingMenu(
  event: React.MouseEvent<HTMLButtonElement>,
  id: string,
  setOpenMenu: React.Dispatch<React.SetStateAction<FloatingMenuState>>,
) {
  event.stopPropagation()
  const rect = event.currentTarget.getBoundingClientRect()
  // First-paint estimate; the ref below corrects it with the real height.
  setOpenMenu((prev) => (prev?.id === id ? null : { id, ...place(rect, 192, 160) }))
}

/**
 * Ref callback for the menu element: re-measures against its own size and the
 * button it belongs to, and nudges state only when the position actually moves.
 */
export function measureFloatingMenu(
  id: string,
  setOpenMenu: React.Dispatch<React.SetStateAction<FloatingMenuState>>,
) {
  return (node: HTMLDivElement | null) => {
    if (!node) return
    const button = document.querySelector<HTMLElement>(`button[data-menu-id="${CSS.escape(id)}"]`)
    if (!button) return
    const menu = node.getBoundingClientRect()
    const next = place(button.getBoundingClientRect(), menu.width, menu.height)
    setOpenMenu((prev) => {
      if (!prev || prev.id !== id) return prev
      if (prev.top === next.top && prev.left === next.left && prev.flip === next.flip) return prev
      return { id, ...next }
    })
  }
}
