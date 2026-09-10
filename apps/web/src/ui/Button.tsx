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
