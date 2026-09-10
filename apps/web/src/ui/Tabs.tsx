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
