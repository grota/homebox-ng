import type { ReactNode } from 'react'
import { cn } from './cn'

type FieldProps = {
  label: ReactNode
  htmlFor: string
  required?: boolean
  /**
   * Rendered beside the label text, deliberately *outside* the `<label>` element
   * — an icon button in there would nest an interactive control inside a label,
   * and everything inside a label becomes the control's accessible name, so the
   * hint's own text would end up read out as part of "Search".
   */
  labelAdornment?: ReactNode
  className?: string
  children: ReactNode
}

// One form control plus its label. Owns the `flex flex-col gap-1` layout that
// was duplicated at every field site, and renders a real `<label htmlFor>` so
// `getByLabelText` keeps working in tests.
//
// `className` lands on the wrapper, which is what a caller needs to size the
// field itself (`flex-1 min-w-0`) — classes on the control cannot grow a
// content-sized wrapper, so `w-full` alone never fills a flex row.
export function Field({ label, htmlFor, required, labelAdornment, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-center gap-1">
        <label htmlFor={htmlFor}>
          {label}
          {required ? ' *' : ''}
        </label>
        {labelAdornment}
      </span>
      {children}
    </div>
  )
}
