import '@testing-library/jest-dom/vitest'

// jsdom does not implement `window.matchMedia`. Components that read the OS
// color-scheme preference (e.g. `ThemeProvider`) depend on it, so provide a
// shim that resolves to `light` (matches: false) by default, matching the
// browser default when no dark preference is set.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})
