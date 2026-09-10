import type { ReactNode } from 'react'

// Title plus an optional actions slot. The heading itself carries no size or
// weight classes on purpose — those come from the `@layer base` rules in
// index.css, so every page title in the app stays consistent.
//
// `[&>h1]:mb-0` is not redundant with `mb-4`: a flex container does not collapse
// its children's margins, so the `h1`'s own `margin-block-end` (1rem, from
// `@layer base`) would add to this header's 24px instead of collapsing into it
// (~40px below the title where a bare `<h1>` page gets 16px), and `items-center`
// would centre the actions slot against that inflated margin box rather than the
// title's text box. Removing the h1's margin fixes both. `mb-4` keeps the
// spacing every other page gets.
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-4 [&>h1]:mb-0">
      <h1>{title}</h1>
      {actions}
    </header>
  )
}
