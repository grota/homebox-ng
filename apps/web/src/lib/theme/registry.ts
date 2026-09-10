// Semantic CSS custom properties the app's components read. Every value the app
// shows must come from one of these — never a raw hex in markup.
export type ThemeVar =
  | '--color-bg'
  | '--color-surface'
  | '--color-surface-raised'
  | '--color-text'
  | '--color-text-muted'
  | '--color-border'
  | '--color-accent'
  | '--color-accent-contrast'
  | '--color-danger'
  | '--color-success'
  | '--color-focus'

export interface ThemePalette {
  id: string
  name: string
  /** Group flag: a palette belongs to exactly one set (light or dark). */
  dark: boolean
  vars: Record<ThemeVar, string>
}

// ~3 light + ~3 dark palettes, adapted from Homebox's theme list. Hex values are
// illustrative (adjust freely) — the ONLY rule is that every palette sets every
// `ThemeVar`.
export const themes: ThemePalette[] = [
  {
    id: 'light-default',
    name: 'Homebox Light',
    dark: false,
    vars: {
      '--color-bg': '#f5f6fa',
      '--color-surface': '#ffffff',
      '--color-surface-raised': '#f3f4f6',
      '--color-text': '#1a1a1a',
      '--color-text-muted': '#6b7280',
      '--color-border': '#e5e7eb',
      '--color-accent': '#2563eb',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#dc2626',
      '--color-success': '#16a34a',
      '--color-focus': '#2563eb',
    },
  },
  {
    id: 'light-catppuccin',
    name: 'Catppuccin Latte',
    dark: false,
    vars: {
      '--color-bg': '#eff1f5',
      '--color-surface': '#e6e9ef',
      '--color-surface-raised': '#ffffff',
      '--color-text': '#4c4f69',
      '--color-text-muted': '#8c8fa1',
      '--color-border': '#ccd0da',
      '--color-accent': '#1e66f5',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#d20f39',
      '--color-success': '#40a02b',
      '--color-focus': '#04a5e5',
    },
  },
  {
    id: 'light-nord',
    name: 'Nord Snowstorm',
    dark: false,
    vars: {
      '--color-bg': '#eceff4',
      '--color-surface': '#e5e9f0',
      '--color-surface-raised': '#ffffff',
      '--color-text': '#2e3440',
      '--color-text-muted': '#4c566a',
      '--color-border': '#d8dee9',
      '--color-accent': '#5e81ac',
      '--color-accent-contrast': '#eceff4',
      '--color-danger': '#bf616a',
      '--color-success': '#a3be8c',
      '--color-focus': '#81a1c1',
    },
  },
  {
    id: 'dark-default',
    name: 'Homebox Dark',
    dark: true,
    vars: {
      '--color-bg': '#1a1a1a',
      '--color-surface': '#242424',
      '--color-surface-raised': '#2d2d2d',
      '--color-text': '#e5e5e5',
      '--color-text-muted': '#9ca3af',
      '--color-border': '#3a3a3a',
      '--color-accent': '#2563eb',
      '--color-accent-contrast': '#ffffff',
      '--color-danger': '#ef4444',
      '--color-success': '#22c55e',
      '--color-focus': '#3b82f6',
    },
  },
  {
    id: 'dark-dracula',
    name: 'Dracula',
    dark: true,
    vars: {
      '--color-bg': '#282a36',
      '--color-surface': '#21222c',
      '--color-surface-raised': '#44475a',
      '--color-text': '#f8f8f2',
      '--color-text-muted': '#6272a4',
      '--color-border': '#44475a',
      '--color-accent': '#bd93f9',
      '--color-accent-contrast': '#282a36',
      '--color-danger': '#ff5555',
      '--color-success': '#50fa7b',
      '--color-focus': '#8be9fd',
    },
  },
  {
    id: 'dark-gruvbox',
    name: 'Gruvbox Dark',
    dark: true,
    vars: {
      '--color-bg': '#282828',
      '--color-surface': '#32302f',
      '--color-surface-raised': '#3c3836',
      '--color-text': '#ebdbb2',
      '--color-text-muted': '#928374',
      '--color-border': '#504945',
      '--color-accent': '#b16286',
      '--color-accent-contrast': '#282828',
      '--color-danger': '#fb4934',
      '--color-success': '#b8bb26',
      '--color-focus': '#83a598',
    },
  },
]

// The light set and the dark set, derived from the `dark` group flag.
export const lightThemes = themes.filter((t) => !t.dark)
export const darkThemes = themes.filter((t) => t.dark)

export const getThemeById = (id: string | null | undefined): ThemePalette | undefined =>
  themes.find((t) => t.id === (id ?? ''))
