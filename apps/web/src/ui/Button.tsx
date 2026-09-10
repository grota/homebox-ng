import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed no-underline'

// Composed with `base` and `sizes.md`, `secondary` covers every token of the
// utility string the app's buttons used before this component existed
// (`px-3 py-1.5 rounded-md border border-border bg-surface text-text`), so no
// original styling is lost. It also deliberately adds control typography and a
// hover state (`text-sm`, `font-medium`, flex centring, a colour transition):
// a converted button renders at 14px/500 where it previously inherited
// 16px/400. Converting a call site is therefore a visual change, not a no-op —
// look at it rather than assuming it is unchanged. That difference is the
// point: it is what stops controls reading as body text.
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
