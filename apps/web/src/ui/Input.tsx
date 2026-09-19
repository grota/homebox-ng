import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

// The exact string this replaces appeared 36 times across the app.
export const inputClass = 'px-2 py-1 border border-border rounded-md bg-surface text-text'
export const selectClass = inputClass

// `ref` is declared only so it can be *passed*: React 19 hands it to a function
// component as an ordinary prop, so the spread below already forwards it and there
// is no `forwardRef` to write. It needs spelling out because
// `InputHTMLAttributes` does not carry it. Same note as `Button`.
//
// Used by the catalog's search box, which takes focus back when Clear Filters is
// pressed.
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(inputClass, className)} {...rest} />
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(selectClass, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, className)} {...rest} />
}
