# Web Styling Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web UI look designed by fixing the base typography and adding a primitives layer over the existing Tailwind token system, keeping the token architecture and all 6 palettes.

**Architecture:** The token layer (semantic CSS variables + runtime `ThemeProvider` palette swapping) is correct and stays unchanged. Everything above it changes: heading styles return to `@layer base`, the ~62 hand-written utility strings move into `apps/web/src/ui/` primitives, `Shell` gains a content container, and Radix supplies behavior (focus trap, Escape, ARIA) for the two widgets that currently fake it.

**Tech Stack:** React 19, Vite 7, Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first config), tRPC v11, Vitest 4 + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-web-styling-primitives-design.md`
**Decision record:** `docs/adr/0001-web-styling-primitives-and-radix.md`

## Global Constraints

- **The existing 39 unit tests and 2 e2e specs must pass with no assertion edited.** If a primitive forces a test change, the primitive is wrong, not the test. Adding *new* tests is expected; editing existing assertions is the failure signal.
- **Element semantics are the contract.** `Button` renders `<button>`, `Field` renders `<label htmlFor>`, `Input` renders `<input id>`. Tests query by `role` and accessible name.
- **No new styling dependency.** No clsx, no tailwind-merge, no cva, no styled component library (ADR-0001). Radix is a *behavior* dependency, permitted only for `@radix-ui/react-dialog` and `@radix-ui/react-tabs`.
- **No new color tokens.** Radius and elevation come from Tailwind v4's built-in `rounded-*` and `shadow-*`.
- **Default `Button` variant is `secondary`**, whose classes are byte-identical to the string it replaces, so a mechanical conversion preserves current rendering unless a variant is chosen deliberately.
- **Every command runs from the repo root** unless stated otherwise.

## File Structure

**Create:**
- `apps/web/src/ui/cn.ts` — class-name joiner (3 lines, no dependency)
- `apps/web/src/ui/Button.tsx` — button with 4 variants × 2 sizes
- `apps/web/src/ui/Field.tsx` — label + layout wrapper for one form control
- `apps/web/src/ui/Input.tsx` — `<input>` + `Select` + `Textarea` + shared class constants
- `apps/web/src/ui/Card.tsx` — bordered surface with elevation
- `apps/web/src/ui/Badge.tsx` — small pill (tags, facet chips, photo "Primary")
- `apps/web/src/ui/PageHeader.tsx` — page title row with an actions slot
- `apps/web/src/ui/Modal.tsx` — Radix Dialog wrapper (Task 8)
- `apps/web/src/ui/Tabs.tsx` — Radix Tabs wrapper (Task 9)
- `apps/web/src/ui/index.ts` — barrel export
- Tests: `apps/web/test/ui.test.tsx`, `apps/web/test/modal.test.tsx`, `apps/web/test/tabs.test.tsx`

**Modify:**
- `apps/web/src/index.css` — `color-scheme` fix, `@layer base` headings
- `apps/web/src/lib/theme/ThemeProvider.tsx` — set `colorScheme` from the palette
- `apps/web/src/app/Shell.tsx` — content container, header surface
- `apps/web/src/features/items/{ItemsPage,ItemDetail,ItemForm}.tsx` (Task 6/7)
- `apps/web/src/features/auth/{LoginPage,SetupPage,ChangePasswordPage}.tsx` (Task 6/7)
- `apps/web/src/features/{locations/LocationsPage,itemTypes/ItemTypesPage,tags/TagsPage}.tsx` (Task 7)
- `apps/web/src/features/drafts/{DraftsPage,UnpackModal}.tsx` (Task 7)
- `apps/web/src/features/admin/{AdminPage,AdminUsersTab,AdminSettingsTab,AdminBackupTab,AdminSystemTab}.tsx` (Task 7/9)
- `apps/web/src/features/upload/PhotoEditor.tsx` (Task 8)

---

### Task 1: Fix `color-scheme` and base typography

The `<h1>` on every page currently computes to `16px`/`weight 400`/`margins 0 0` because Tailwind Preflight resets headings and nothing re-applies them. Separately, `[data-theme]` (specificity `0,1,0`, same as `:root`) always wins, so every light palette runs `color-scheme: dark`.

**Files:**
- Modify: `apps/web/src/index.css:25-30`
- Modify: `apps/web/src/lib/theme/ThemeProvider.tsx:42-47`
- Test: `apps/web/test/theme.test.tsx`

**Interfaces:**
- Consumes: `ThemePalette` from `lib/theme/registry.ts` — already has a `dark: boolean` field.
- Produces: nothing consumed by later tasks. `document.documentElement.style.colorScheme` is set to `'light'` or `'dark'`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/theme.test.tsx`, inside the existing `describe('ThemeProvider', ...)` block:

```tsx
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
```

Also add `document.documentElement.style.removeProperty('color-scheme')` to the file's existing `afterEach`, so state does not leak between tests.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test theme
```

Expected: FAIL — `expected '' to be 'light'`. `ThemeProvider` never touches `colorScheme`.

- [ ] **Step 3: Set `colorScheme` from the palette in `ThemeProvider`**

In `apps/web/src/lib/theme/ThemeProvider.tsx`, replace the effect body:

```tsx
  useEffect(() => {
    if (!palette) return
    const root = document.documentElement
    for (const [key, value] of Object.entries(palette.vars)) root.style.setProperty(key, value)
    root.setAttribute('data-theme', palette.id)
    // `color-scheme` drives native controls (select popups, scrollbars, date
    // pickers). It must come from the palette's own `dark` flag: keying it off
    // the presence of `data-theme` marks every light palette as dark.
    root.style.colorScheme = palette.dark ? 'dark' : 'light'
  }, [palette])
```

- [ ] **Step 4: Remove the broken CSS rule and add base typography**

In `apps/web/src/index.css`, replace lines 25-30 (the `:root` / `[data-theme]` block) with:

```css
/* `color-scheme` is set by ThemeProvider from the active palette's `dark` flag —
   see lib/theme/ThemeProvider.tsx. It is deliberately not set here: a
   `[data-theme]` selector has the same specificity as `:root` and would force
   dark native controls onto every light palette. */
```

Then append to the end of `apps/web/src/index.css`:

```css
/* Tailwind Preflight resets heading styles, which left every page title
   rendering at body-text size and weight with no margins. Restore a scale here
   rather than per-page, so page titles cannot drift apart again. */
@layer base {
  h1 {
    font-size: 1.75rem;
    font-weight: 600;
    line-height: 1.25;
    margin-block: 0 1rem;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    line-height: 1.3;
    margin-block: 1.5rem 0.5rem;
  }
  h3 {
    font-size: 1.05rem;
    font-weight: 600;
    margin-block: 1.25rem 0.5rem;
  }
}
```

- [ ] **Step 5: Replace the raw palette colour with the token**

`text-red-600` bypasses the palette, so destructive text does not follow the theme. Replace every `text-red-600` with `text-danger` — **5 occurrences across 4 files**: `features/items/ItemDetail.tsx` (lines 79, 132), `features/items/ItemForm.tsx` (line 222), `features/drafts/DraftsPage.tsx` (line 54), `features/drafts/UnpackModal.tsx` (line 43).

Verify with:

```bash
cd apps/web/src && grep -rn 'text-red-' --include=*.tsx .
```

Expected: no output.

- [ ] **Step 6: Run the full suite**

```bash
pnpm --filter @homebox/web test && pnpm --filter @homebox/web typecheck
```

Expected: all tests PASS (39 + 2 new = 41), typecheck clean.

- [ ] **Step 7: Verify visually**

With `pnpm --filter @homebox/web dev` running, reload `http://localhost:5173/login` and confirm the "Sign in" heading is now visibly larger and bolder than the labels. In DevTools console:

```js
getComputedStyle(document.documentElement).colorScheme  // expect "light"
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/index.css apps/web/src/lib/theme/ThemeProvider.tsx apps/web/src/features apps/web/test/theme.test.tsx
git commit -m "fix(web): color-scheme from palette, restore heading scale, use danger token"
```

---

### Task 2: `cn` helper and `Button`

**Files:**
- Create: `apps/web/src/ui/cn.ts`
- Create: `apps/web/src/ui/Button.tsx`
- Create: `apps/web/src/ui/index.ts`
- Test: `apps/web/test/ui.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `cn(...xs)`; `Button` with props `variant?: 'primary' | 'secondary' | 'danger' | 'ghost'` (default `'secondary'`) and `size?: 'sm' | 'md'` (default `'md'`), extending `ButtonHTMLAttributes<HTMLButtonElement>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/ui.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { cn, Button } from '../src/ui'

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})

describe('Button', () => {
  it('renders a real button with its accessible name', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('renders the primary variant with the accent background', () => {
    render(<Button variant="primary">Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-accent')
  })

  it('renders the danger variant with the danger token, not a raw red', () => {
    render(<Button variant="danger">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toHaveClass('text-danger')
    expect(btn.className).not.toMatch(/text-red-\d/)
  })

  it('passes through onClick and disabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
    expect(btn).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test ui
```

Expected: FAIL — `Failed to resolve import "../src/ui"`.

- [ ] **Step 3: Write `cn`**

Create `apps/web/src/ui/cn.ts`:

```ts
// Joins class names, dropping falsy entries. Deliberately not clsx +
// tailwind-merge: variants are chosen by prop, not by callers overriding
// classes, so there is no conflict-resolution case to pay a dependency for.
export const cn = (...xs: (string | false | null | undefined)[]): string =>
  xs.filter(Boolean).join(' ')
```

- [ ] **Step 4: Write `Button`**

Create `apps/web/src/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed no-underline'

// `secondary` is byte-identical to the utility string used by every button in
// the app before this component existed, so converting a call site without
// choosing a variant preserves its rendering exactly.
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast border-accent hover:opacity-90',
  secondary: 'bg-surface text-text border-border hover:bg-surface-raised',
  danger: 'bg-surface text-danger border-danger hover:bg-surface-raised',
  ghost: 'bg-transparent text-text border-transparent hover:bg-surface-raised',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest} />
}
```

Note `type` defaults to `'button'`. This is intentional and safe: every existing `<button>` in the app either already sets `type="button"` (28 of them) or is a submit button that also sets `type="submit"` explicitly (7), so nothing changes behaviour.

- [ ] **Step 5: Write the barrel**

Create `apps/web/src/ui/index.ts`:

```ts
export { cn } from './cn'
export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test ui
```

Expected: PASS (6 tests).

- [ ] **Step 7: Confirm the existing suite is untouched**

```bash
pnpm --filter @homebox/web test
```

Expected: PASS, 47 tests, no existing test edited.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui apps/web/test/ui.test.tsx
git commit -m "feat(web): add cn helper and Button primitive"
```

---

### Task 3: `Field`, `Input`, `Select`, `Textarea`

**Files:**
- Create: `apps/web/src/ui/Field.tsx`
- Create: `apps/web/src/ui/Input.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Test: `apps/web/test/ui.test.tsx` (append)

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Field({ label, htmlFor, required, children })`; `Input`, `Select`, `Textarea` — each forwarding their native element props; `inputClass` and `selectClass` string constants for raw elements.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/ui.test.tsx`:

```tsx
describe('Field', () => {
  it('associates its label with the control so getByLabelText works', () => {
    render(
      <Field label="Name" htmlFor="item-name">
        <Input id="item-name" defaultValue="Lamp" />
      </Field>,
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Lamp')
  })

  it('marks a required field in the label text', () => {
    render(
      <Field label="Serial" htmlFor="serial" required>
        <Input id="serial" />
      </Field>,
    )
    expect(screen.getByText('Serial *')).toBeInTheDocument()
  })
})

describe('Input', () => {
  it('forwards value and onChange', () => {
    const onChange = vi.fn()
    render(<Input aria-label="q" value="a" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('q'), { target: { value: 'ab' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('applies the shared input styling and merges extra classes', () => {
    render(<Input aria-label="q" className="w-full" />)
    const input = screen.getByLabelText('q')
    expect(input).toHaveClass('border-border', 'rounded-md', 'bg-surface', 'w-full')
  })
})

describe('Select', () => {
  it('renders options and forwards onChange', () => {
    render(
      <Select aria-label="type" defaultValue="1">
        <option value="1">Light</option>
        <option value="2">Tool</option>
      </Select>,
    )
    const select = screen.getByLabelText('type')
    expect(screen.getByRole('option', { name: 'Tool' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '2' } })
    expect(select).toHaveValue('2')
  })
})
```

Add `Input`, `Select`, `Field` to the existing import from `'../src/ui'` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test ui
```

Expected: FAIL — `Input is not defined` / not exported.

- [ ] **Step 3: Write `Field`**

Create `apps/web/src/ui/Field.tsx`:

```tsx
import type { ReactNode } from 'react'

type FieldProps = {
  label: ReactNode
  htmlFor: string
  required?: boolean
  children: ReactNode
}

// One form control plus its label. Owns the `flex flex-col gap-1` layout that
// was duplicated at every field site, and renders a real `<label htmlFor>` so
// `getByLabelText` keeps working in tests.
export function Field({ label, htmlFor, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor}>
        {label}
        {required ? ' *' : ''}
      </label>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Write `Input`, `Select`, `Textarea`**

Create `apps/web/src/ui/Input.tsx`:

```tsx
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

// The exact string this replaces appeared 36 times across the app.
export const inputClass = 'px-2 py-1 border border-border rounded-md bg-surface text-text'
export const selectClass = inputClass

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...rest} />
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(selectClass, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, className)} {...rest} />
}
```

Three exports in one file is deliberate: they share one class constant and one shape, and splitting them into three files would be three near-identical files.

- [ ] **Step 5: Extend the barrel**

Update `apps/web/src/ui/index.ts`:

```ts
export { cn } from './cn'
export { Button } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'
export { Field } from './Field'
export { Input, Select, Textarea, inputClass, selectClass } from './Input'
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test ui
```

Expected: PASS (11 tests in `ui.test.tsx`, 52 total).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui apps/web/test/ui.test.tsx
git commit -m "feat(web): add Field, Input, Select and Textarea primitives"
```

---

### Task 4: `Card`, `Badge`, `PageHeader`

**Files:**
- Create: `apps/web/src/ui/Card.tsx`
- Create: `apps/web/src/ui/Badge.tsx`
- Create: `apps/web/src/ui/PageHeader.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Test: `apps/web/test/ui.test.tsx` (append)

**Interfaces:**
- Consumes: `cn` (Task 2).
- Produces: `Card` and `PageHeader({ title, actions })`; `Badge({ color })` where `color` is applied as an inline background (tag colours are user data, not tokens).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/ui.test.tsx`:

```tsx
describe('Card', () => {
  it('renders children on a raised surface', () => {
    render(<Card>Body</Card>)
    const card = screen.getByText('Body')
    expect(card).toHaveClass('bg-surface', 'border-border', 'shadow-sm', 'rounded-lg')
  })
})

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge>Primary</Badge>)
    expect(screen.getByText('Primary')).toBeInTheDocument()
  })

  it('applies a user-supplied tag colour as an inline background', () => {
    render(<Badge color="#ff0000">urgent</Badge>)
    expect(screen.getByText('urgent')).toHaveStyle({ background: '#ff0000' })
  })
})

describe('PageHeader', () => {
  it('renders the title as a level-1 heading with an actions slot', () => {
    render(<PageHeader title="Items" actions={<Button>New item</Button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Items' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument()
  })
})
```

Add `Card`, `Badge`, `PageHeader` to the import from `'../src/ui'`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test ui
```

Expected: FAIL — `Card is not defined`.

- [ ] **Step 3: Write the three components**

Create `apps/web/src/ui/Card.tsx`:

```tsx
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-surface border border-border rounded-lg shadow-sm p-4', className)} {...rest} />
}
```

Create `apps/web/src/ui/Badge.tsx`:

```tsx
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

// `color` is a user-chosen tag colour (arbitrary data), so it becomes an inline
// background rather than a class. Everything else comes from the tokens.
export function Badge({ color, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { color?: string | null }) {
  return (
    <span
      className={cn('inline-block rounded px-1.5 py-0.5 text-xs', className)}
      style={color ? { background: color } : undefined}
      {...rest}
    />
  )
}
```

Create `apps/web/src/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react'

// Title plus an optional actions slot. The heading itself carries no size or
// weight classes on purpose — those come from the `@layer base` rules in
// index.css, so every page title in the app stays consistent.
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 mb-6 flex-wrap">
      <h1>{title}</h1>
      {actions}
    </header>
  )
}
```

- [ ] **Step 4: Extend the barrel**

Append to `apps/web/src/ui/index.ts`:

```ts
export { Card } from './Card'
export { Badge } from './Badge'
export { PageHeader } from './PageHeader'
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test
```

Expected: PASS (15 tests in `ui.test.tsx`, 56 total).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui apps/web/test/ui.test.tsx
git commit -m "feat(web): add Card, Badge and PageHeader primitives"
```

---

### Task 5: Content container in `Shell`

**Files:**
- Modify: `apps/web/src/app/Shell.tsx:33-72`
- Test: `apps/web/test/shell.test.tsx` (append)

**Interfaces:**
- Consumes: nothing (Task 2-4 primitives are not needed here; `Shell` keeps its own nav markup).
- Produces: a `data-testid="content"` container other pages render inside. No page needs to change for this task.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/shell.test.tsx`, inside `describe('Shell', ...)`:

```tsx
  it('wraps routed content in a centered max-width container', () => {
    render(<MemoryRouter><Shell /></MemoryRouter>)
    const content = screen.getByTestId('content')
    expect(content).toHaveClass('mx-auto', 'max-w-6xl', 'px-4')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test shell
```

Expected: FAIL — `Unable to find an element by: [data-testid="content"]`.

- [ ] **Step 3: Add the container**

In `apps/web/src/app/Shell.tsx`, replace the `<main>` element:

```tsx
      {/* Centered content column. Without a max-width the item grid stretches
          edge to edge on wide displays while forms stay pinned narrow. */}
      <main className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="content">
        <Outlet />
      </main>
```

Also give the header a surface treatment so it reads as chrome. Replace the `<header>` opening tag:

```tsx
      <header className="border-b border-border bg-surface">
```

- [ ] **Step 4: Run the suite to verify it passes**

```bash
pnpm --filter @homebox/web test
```

Expected: PASS, 57 tests. The 3 pre-existing `Shell` tests must be untouched.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/Shell.tsx apps/web/test/shell.test.tsx
git commit -m "feat(web): add centered content container to Shell"
```

---

### Task 6: Convert the three highest-traffic pages (checkpoint)

This is the checkpoint task. Do **not** proceed to Task 7 until the rendering has been reviewed in the browser.

**Files:**
- Modify: `apps/web/src/features/auth/LoginPage.tsx`
- Modify: `apps/web/src/features/items/ItemsPage.tsx`
- Modify: `apps/web/src/features/items/ItemDetail.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `Input`, `Select`, `Card`, `Badge`, `PageHeader` from `../ui`.
- Produces: no new interfaces. Purely a call-site conversion.

- [ ] **Step 1: Convert `LoginPage`**

Replace the form's field blocks and submit button so the file reads:

```tsx
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
      <h1>Sign in</h1>

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" disabled={login.isPending}>
        Sign in
      </Button>

      {login.error && <p role="alert" className="text-danger">{login.error.message}</p>}
      {signedIn && <p>Signed in</p>}
    </form>
  )
```

Two deliberate changes beyond moving classes: the submit button becomes `variant="primary"` (it is the page's only action), and the error text becomes `text-danger`. Both are the point of this work.

- [ ] **Step 2: Convert `ItemsPage`**

Replace the header with `PageHeader`, the "New item" and "Clear filters" buttons with `Button`, the search input with `Input` inside a `Field`, the facet buttons with `Badge`, and the item card `<Link>` with `Card` wrapped in the `Link`:

```tsx
      <PageHeader
        title="Items"
        actions={<Button onClick={() => setShowForm((open) => !open)}>New item</Button>}
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Field label="Search" htmlFor="item-search">
          <Input
            id="item-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search items"
            className="w-full max-w-[26rem]"
          />
        </Field>
        <Button onClick={clearFilters} className="self-end">Clear filters</Button>
      </div>
```

For the grid, keep the `<Link>` and move the surface styling onto a `Card`:

```tsx
            {items.map((item) => (
              <Card key={item.id} className="p-0 overflow-hidden hover:border-text-muted">
                <Link to={`/items/${item.id}`} className="block p-3 no-underline text-inherit">
                  {item.images?.[0]?.thumbPath ? (
                    <img src={'/file/' + item.images[0].thumbPath} alt={item.name} className="w-full h-32 object-cover rounded-md mb-2" />
                  ) : null}
                  <h2 className="mt-0">{item.name}</h2>
                  <p>{item.location?.name}</p>
                  <p>{item.type?.name}</p>
                  {item.tags.map((tag) => (
                    <Badge key={tag.id} color={tag.color} className="mr-1">{tag.name}</Badge>
                  ))}
                  {q.trim() && item.snippet ? (
                    <p className="mt-2 text-text-muted text-sm" data-testid="item-snippet">{item.snippet}</p>
                  ) : null}
                </Link>
              </Card>
            ))}
```

Facet chips become `<Badge>` rendered as a button — use `Badge` for the tag chips (which carry a colour) and `Button variant="ghost" size="sm"` for type and location chips. The selected type chip keeps `bg-accent text-accent-contrast`:

```tsx
                  {facets.types.map((f) => (
                    <Button
                      key={f.id}
                      size="sm"
                      variant={itemTypeId === f.id ? 'primary' : 'ghost'}
                      className="rounded"
                      onClick={() => setTypeFilter(itemTypeId === f.id ? undefined : f.id)}
                    >
                      {f.name} ({f.count})
                    </Button>
                  ))}
```

The pre-existing `data-testid="item-snippet"` and the accessible names `New item` / `Clear filters` must survive — `catalog.test.tsx` and `searchFacets.test.tsx` depend on them.

- [ ] **Step 3: Convert `ItemDetail`**

Wrap the photos in `Card`, convert the action buttons, and use `PageHeader`. The `Edit` button on each photo keeps its exact accessible name `Edit` — `itemDetail.test.tsx` asserts there are exactly 2 of them. Likewise `Delete photo`, `Delete item`, `Set primary`, `Unpack this photo` keep their names.

```tsx
      <PageHeader
        title={item.name}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setEditingItem(true)}>Edit item</Button>
            <Button
              variant="danger"
              disabled={deleteItem.isPending}
              onClick={() => {
                if (confirm(`Delete "${item.name}" and its photos?`)) deleteItem.mutate({ id: itemId })
              }}
            >
              Delete item
            </Button>
          </div>
        }
      />
```

Per photo, keep the same button names, using `variant="danger"` for `Delete photo` and `Button` (secondary) elsewhere, and replace the "Primary" `<span>` with `<Badge>Primary</Badge>`.

- [ ] **Step 4: Run the full suite**

```bash
pnpm --filter @homebox/web test && pnpm --filter @homebox/web typecheck
```

Expected: PASS, 57 tests, **no existing assertion edited**. If `catalog.test.tsx`, `searchFacets.test.tsx` or `itemDetail.test.tsx` needs a change, a primitive lost its semantics — fix the primitive.

- [ ] **Step 5: CHECKPOINT — show it in the browser**

With the dev server running, screenshot `http://localhost:5173/items` at 1440px in both a light and a dark palette, and report back for review before continuing. Do not start Task 7 until this has been looked at.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features
git commit -m "refactor(web): convert login, items list and item detail to primitives"
```

---

### Task 7: Convert the remaining pages

**Files:**
- Modify: `apps/web/src/features/auth/{SetupPage,ChangePasswordPage}.tsx`
- Modify: `apps/web/src/features/items/ItemForm.tsx`
- Modify: `apps/web/src/features/locations/LocationsPage.tsx`
- Modify: `apps/web/src/features/itemTypes/ItemTypesPage.tsx`
- Modify: `apps/web/src/features/tags/TagsPage.tsx`
- Modify: `apps/web/src/features/drafts/{DraftsPage,UnpackModal}.tsx`
- Modify: `apps/web/src/features/admin/{AdminUsersTab,AdminSettingsTab,AdminBackupTab,AdminSystemTab}.tsx`

**Interfaces:**
- Consumes: the Task 2-4 primitives.
- Produces: no new interfaces.

- [ ] **Step 1: Worked example — the four conversion shapes**

Apply these four transformations to every file listed above. Here is the real before/after for a field and a button, taken from `ItemForm.tsx`.

**Shape A — a labelled input.** Before:

```tsx
      <div className="flex flex-col gap-1">
        <label htmlFor="item-name">Name</label>
        <input
          id="item-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
      </div>
```

After:

```tsx
      <Field label="Name" htmlFor="item-name">
        <Input
          id="item-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>
```

**Shape B — a two-input row.** The `flex gap-3` wrapper holding Quantity and Unit stays; only the inner blocks become `Field`, and both inputs get `className="w-full"` so they fill their columns:

```tsx
      <div className="flex gap-3">
        <Field label="Quantity" htmlFor="item-quantity">
          <Input id="item-quantity" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full" />
        </Field>
        <Field label="Unit" htmlFor="item-unit">
          <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full" />
        </Field>
      </div>
```

**Shape C — a submit button.** Before: `<button type="submit" disabled={...} className="px-3 py-1.5 rounded-md border border-border bg-surface text-text">{item ? 'Save' : 'Create item'}</button>`. After:

```tsx
        <Button type="submit" variant="primary" disabled={createItem.isPending || updateItem.isPending}>
          {item ? 'Save' : 'Create item'}
        </Button>
```

Note `type="submit"` is passed explicitly — `Button` defaults to `type="button"`, and a form's submit button must not.

**Shape D — a pill.** Any `<span className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs">` becomes `<Badge className="mr-1">`, and when it carries an inline `style={{ background: f.color }}` that becomes the `color` prop: `<Badge color={f.color} className="mr-1">`.

**Per-file notes:**

- `ItemForm.tsx` has 7 inputs and 2 buttons. It must keep its `<label htmlFor>` associations intact: `catalog.test.tsx` and `itemDetail.test.tsx` query `getByLabelText('Name')`, `getByLabelText('Type')`, `getByLabelText('Quantity')` and `getByLabelText('Photo')`. The custom-field `<fieldset>` keeps its structure — only the inner `<div><label><input>` becomes `Field` + `Input`, and `field.name`/`field.required` are passed as `label`/`required`.
- `DraftsPage.tsx` and `UnpackModal.tsx` errors are already `text-danger` from Task 1 — leave them.
- `AdminBackupTab.tsx` has 3 inputs and 3 buttons — the largest single-file conversion after `ItemForm`. Its file-upload input should use `Input` with `type="file"`.

`ItemForm.tsx` has 7 inputs and 2 buttons; note it must keep `aria-label`-free `<label htmlFor>` associations so `getByLabelText('Name')`, `getByLabelText('Type')`, `getByLabelText('Photo')` and `getByLabelText('Quantity')` keep working for `catalog.test.tsx` and `itemDetail.test.tsx`.

`UnpackModal.tsx` currently has a `text-red-600` error paragraph already converted to `text-danger` in Task 1 — keep it.

- [ ] **Step 2: Verify no hand-written duplicates remain**

```bash
cd apps/web/src && grep -rn 'border border-border rounded-md bg-surface text-text' --include=*.tsx . ; grep -rn 'px-3 py-1.5 rounded-md border border-border bg-surface text-text' --include=*.tsx . ; grep -rnE '(text|bg|border)-red-[0-9]' --include=*.tsx .
```

Expected: no output from any of the three. Any remaining hit is a missed call site.

The third grep matters: `DraftsPage.tsx:54` uses `px-3 py-1.5 rounded-md border border-border text-red-600` — no `bg-surface` — so it matches neither of the first two patterns and would sail past a two-grep check.

- [ ] **Step 3: Run the full suite and typecheck**

```bash
pnpm --filter @homebox/web test && pnpm --filter @homebox/web typecheck
```

Expected: PASS, 57 tests, no existing assertion edited.

- [ ] **Step 4: Verify in the browser, in all six palettes**

Visit each converted page in the dev server: `/setup`, `/items`, `/items/:id`, `/locations`, `/types`, `/tags`, `/drafts`, `/settings`, `/admin`. Confirm no page renders an unstyled control and that primary actions are visually distinct.

Then switch through **all six palettes** (Homebox Light/Dark, Catppuccin Latte, Nord, Dracula, Gruvbox) from `/settings` and check each one specifically for:
- a `variant="primary"` button — its label must stay legible against `--color-accent`. Nord and Gruvbox are the likely failures: Nord's accent is a muted `#5e81ac` with a near-white contrast colour, Gruvbox's is `#b16286` with a near-black one.
- a `variant="danger"` button — `--color-danger` must be distinguishable from `--color-text` on that palette's surface.
- the `Badge` sitting on a tag colour, which is arbitrary user data and may clash on any palette.

This check is the reason the primitives use tokens rather than fixed colours; a variant that only works on the default palette has failed the task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features
git commit -m "refactor(web): convert remaining pages to primitives"
```

---

### Task 8: `Modal` on Radix, for `PhotoEditor`

`PhotoEditor` currently puts `role="dialog" aria-modal="true"` on a plain `<div>`: no focus trap, no Escape handler, no focus restore. `aria-modal` without a trap tells assistive tech the page is inert while it stays tabbable.

**Files:**
- Create: `apps/web/src/ui/Modal.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/features/upload/PhotoEditor.tsx:53-64`
- Test: `apps/web/test/modal.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except `cn`.
- Produces: `Modal({ open, onOpenChange, title, children })` — `title` is used as the accessible dialog name.

- [ ] **Step 1: Install Radix Dialog**

```bash
pnpm --filter @homebox/web add @radix-ui/react-dialog
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Modal } from '../src/ui/Modal'
import { Button } from '../src/ui'

describe('Modal', () => {
  it('renders its content while open', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Edit photo">
        <p>Editor</p>
      </Modal>,
    )
    expect(screen.getByRole('dialog', { name: 'Edit photo' })).toBeInTheDocument()
    expect(screen.getByText('Editor')).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onOpenChange={() => {}} title="Edit photo">
        <p>Editor</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onOpenChange(false) when Escape is pressed', async () => {
    const onOpenChange = vi.fn()
    render(
      <Modal open onOpenChange={onOpenChange} title="Edit photo">
        <Button>Inside</Button>
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test modal
```

Expected: FAIL — `Failed to resolve import "../src/ui/Modal"`.

- [ ] **Step 4: Write `Modal`**

Create `apps/web/src/ui/Modal.tsx`:

```tsx
import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}

// Radix supplies the behavior the app was faking: focus trap, Escape to close,
// focus restore to the trigger, and `aria-modal` that is actually true. Styling
// stays on our tokens.
export function Modal({ open, onOpenChange, title, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2 w-[min(92vw,64rem)] max-h-[92vh] overflow-auto rounded-lg border border-border bg-surface p-4 shadow-lg">
          {/* Radix requires a title for the accessible name; callers that render
              their own visible heading pass a descriptive one here. */}
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test modal
```

Expected: PASS (3 tests).

- [ ] **Step 6: Convert `PhotoEditor` to use it**

Replace the returned markup in `apps/web/src/features/upload/PhotoEditor.tsx`:

```tsx
  return (
    <Modal open={open} onOpenChange={(next) => { if (!next) onClose() }} title="Edit photo">
      {error && <p role="alert" className="text-danger">{error}</p>}
      {saving && <p>Saving…</p>}
      <FilerobotImageEditor
        source={'/file/' + image.originalPath}
        onSave={handleSave}
        onClose={onClose}
        savingPixelRatio={4}
        previewPixelRatio={window.devicePixelRatio || 1}
      />
    </Modal>
  )
```

The early `if (!open) return null` moves above this return and stays. Add `import { Modal } from '../../ui/Modal'`.

**Risk to check here:** filerobot manages its own internal focus. Confirm that Escape still closes the modal once and does not double-fire, and that focus returns to the photo's "Edit" button. If they fight, wrap only the container in `Modal` and let filerobot keep its own overlay.

- [ ] **Step 7: Run the suite**

```bash
pnpm --filter @homebox/web test && pnpm --filter @homebox/web typecheck
```

Expected: PASS, 60 tests. `photoEditor.test.tsx` and `itemDetail.test.tsx` must pass with no assertion edited.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui apps/web/src/features/upload/PhotoEditor.tsx apps/web/test/modal.test.tsx package.json pnpm-lock.yaml
git commit -m "feat(web): wrap PhotoEditor in a Radix-backed Modal"
```

---

### Task 9: `Tabs` on Radix, for `AdminPage`

`AdminPage`'s tabs are a row of `<button>`s with no `role="tablist"`, no `aria-selected` and no arrow-key navigation.

**Files:**
- Create: `apps/web/src/ui/Tabs.tsx`
- Modify: `apps/web/src/ui/index.ts`
- Modify: `apps/web/src/features/admin/AdminPage.tsx`
- Test: `apps/web/test/tabs.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Tabs({ value, onValueChange, items, children })` where `items` is `{ id: string; label: string }[]` and `children` is the active panel.

- [ ] **Step 1: Install Radix Tabs**

```bash
pnpm --filter @homebox/web add @radix-ui/react-tabs
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/tabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tabs } from '../src/ui/Tabs'

const items = [
  { id: 'users', label: 'Users' },
  { id: 'settings', label: 'Settings' },
]

describe('Tabs', () => {
  it('exposes a tablist with the active tab selected', () => {
    render(<Tabs value="users" onValueChange={() => {}} items={items}>Panel</Tabs>)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'false')
  })

  it('reports a change when another tab is clicked', () => {
    const onValueChange = vi.fn()
    render(<Tabs value="users" onValueChange={onValueChange} items={items}>Panel</Tabs>)
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(onValueChange).toHaveBeenCalledWith('settings')
  })

  it('moves selection with the arrow keys', () => {
    const onValueChange = vi.fn()
    render(<Tabs value="users" onValueChange={onValueChange} items={items}>Panel</Tabs>)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Users' }), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenCalledWith('settings')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @homebox/web test tabs
```

Expected: FAIL — `Failed to resolve import "../src/ui/Tabs"`.

- [ ] **Step 4: Write `Tabs`**

Create `apps/web/src/ui/Tabs.tsx`:

```tsx
import type { ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'

type TabsProps = {
  value: string
  onValueChange: (value: string) => void
  items: { id: string; label: string }[]
  children: ReactNode
}

// Radix gives the roving tabindex, arrow-key navigation and the
// tablist/tab/aria-selected wiring that a row of plain <button>s lacks.
export function Tabs({ value, onValueChange, items, children }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List className="flex gap-1 border-b border-border">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.id}
            value={item.id}
            className="px-3 py-1.5 border-b-2 border-transparent text-text data-[state=active]:border-accent data-[state=active]:text-accent"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      <RadixTabs.Content value={value} className="pt-4">
        {children}
      </RadixTabs.Content>
    </RadixTabs.Root>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @homebox/web test tabs
```

Expected: PASS (3 tests).

- [ ] **Step 6: Convert `AdminPage`**

Replace its hand-rolled tab row with the primitive:

```tsx
  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.title')} />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as AdminTab)}
        items={tabs}
      >
        {tab === 'users' && <AdminUsersTab />}
        {tab === 'settings' && <AdminSettingsTab />}
        {tab === 'backup' && <AdminBackupTab />}
        {tab === 'system' && <AdminSystemTab />}
      </Tabs>
    </div>
  )
```

`tabs` already has the `{ id, label }` shape the primitive wants, so no reshaping is needed.

- [ ] **Step 7: Run the suite and typecheck**

```bash
pnpm --filter @homebox/web test && pnpm --filter @homebox/web typecheck && pnpm --filter @homebox/web build
```

Expected: PASS, 63 tests, typecheck clean, build succeeds. `admin.test.tsx` and the three `admin*Tab` tests must pass with no assertion edited.

- [ ] **Step 8: Check the e2e specs still pass**

```bash
pnpm --filter @homebox/web test:e2e
```

Expected: PASS. If the environment cannot run Playwright, say so explicitly rather than reporting success.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/ui apps/web/src/features/admin/AdminPage.tsx apps/web/test/tabs.test.tsx package.json pnpm-lock.yaml
git commit -m "feat(web): convert AdminPage tabs to a Radix-backed Tabs primitive"
```

---

## Deferred (not in this plan)

- Replacing `window.confirm` in `ItemDetail.tsx:83` and `:134` with the `Modal` primitive. Reasoned in the spec §3: native confirm is the better option on mobile, and its real weakness (generic OK/Cancel on a destructive action) is a small follow-up once `Modal` exists.
- `@radix-ui/react-select` for styled selects.
- A `manualChunks` pass for the pre-existing bundle-size warning.
- Deleting `--color-success` from the palette registry if it still has no consumer after Task 7. Check with `grep -rn 'text-success\|bg-success' apps/web/src` and delete it from `lib/theme/registry.ts` plus all 6 palettes if empty.
