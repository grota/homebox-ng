import { describe, it, expect, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeProvider } from '../src/lib/theme/ThemeProvider'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('color-scheme')
  for (const [key, value] of Object.entries({ '--color-bg': '', '--color-text': '', '--color-accent': '' })) {
    document.documentElement.style.removeProperty(key)
  }
})

describe('ThemeProvider', () => {
  it('resolves an explicit light palette', () => {
    render(<ThemeProvider themeMode="light" lightThemeId="light-default" darkThemeId="dark-default">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light-default')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f5f6fa')
  })

  it('resolves an explicit dark palette', () => {
    render(<ThemeProvider themeMode="dark" lightThemeId="light-default" darkThemeId="dark-dracula">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark-dracula')
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#282a36')
  })

  it('follows prefers-color-scheme when auto', () => {
    // jsdom matchMedia default is light; a null matchMedia resolves to light.
    render(<ThemeProvider themeMode="auto" lightThemeId="light-default" darkThemeId="dark-default">x</ThemeProvider>)
    // With no matchMedia (light path) the light palette wins.
    expect(document.documentElement.style.getPropertyValue('--color-bg')).toBe('#f5f6fa')
  })

  it('sets color-scheme from the palette, not from the presence of data-theme', () => {
    render(<ThemeProvider themeMode="light" lightThemeId="light-catppuccin" darkThemeId="dark-dracula">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light-catppuccin')
    // A light palette must not leave native controls (selects, scrollbars,
    // date pickers) rendering dark.
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('sets color-scheme dark for a dark palette', () => {
    render(<ThemeProvider themeMode="dark" lightThemeId="light-default" darkThemeId="dark-gruvbox">x</ThemeProvider>)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })
})
