import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemeMode } from '@homebox/shared'
import { getThemeById, type ThemePalette } from './registry'

// The OS preference is only visible client-side, so `auto` is resolved here.
function currentSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolvePalette(mode: ThemeMode, lightId: string, darkId: string, system: 'light' | 'dark'): ThemePalette | undefined {
  const id = mode === 'dark' ? darkId : mode === 'light' ? lightId : system === 'dark' ? darkId : lightId
  return getThemeById(id)
}

type ThemeProviderProps = {
  themeMode: ThemeMode
  lightThemeId: string
  darkThemeId: string
  children: ReactNode
}

// Applies the resolved palette's CSS variables to the document root and sets a
// `data-theme` attribute (a non-variable styling hook). Responds to OS
// `prefers-color-scheme` changes while mounted when `themeMode === 'auto'`.
export function ThemeProvider({ themeMode, lightThemeId, darkThemeId, children }: ThemeProviderProps) {
  const [system, setSystem] = useState<'light' | 'dark'>(currentSystemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const palette = useMemo(
    () => resolvePalette(themeMode, lightThemeId, darkThemeId, system),
    [themeMode, lightThemeId, darkThemeId, system]
  )

  useEffect(() => {
    if (!palette) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(palette.vars)) root.style.setProperty(key, value)
    root.setAttribute('data-theme', palette.id)
  }, [palette])

  return <>{children}</>
}
