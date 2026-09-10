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
