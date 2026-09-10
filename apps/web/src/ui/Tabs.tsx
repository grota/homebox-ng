import type { ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'

type TabsProps<T extends string> = {
  value: T
  onValueChange: (value: T) => void
  items: { id: T; label: string }[]
  children: ReactNode
}

// Radix gives the roving tabindex, arrow-key navigation and the
// tablist/tab/aria-selected wiring that a row of plain <button>s lacks.
//
// Generic in the tab id so callers keep their own union type (`AdminTab`) and
// no `as` cast is needed at the call site. Radix types its handlers on `string`,
// so the one cast that remains lives here rather than in every consumer.
export function Tabs<T extends string>({ value, onValueChange, items, children }: TabsProps<T>) {
  return (
    <RadixTabs.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
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
