import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-surface border border-border rounded-lg shadow-sm p-4', className)} {...rest} />
}
