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
