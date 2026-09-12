import type { FieldType } from '@homebox/shared'
import { Button, Modal } from '../../ui'

export type Offender = { itemId: number; name: string; value: string }

// The rows are a sample for judgement; `total` is what the destructive button
// commits to deleting, which is why they are separate props.
const MAX_ROWS = 50

// The one place a retype's stranded values are shown and destroyed. Its list is a
// snapshot of a moment, so the caller re-reads it while this is open (see
// `TypeFields`); everything here renders what it is given.
export function IncompatibleValuesDialog({
  open, fieldName, targetType, offenders, total, onConfirm, onCancel,
}: {
  open: boolean
  fieldName: string
  targetType: FieldType
  offenders: Offender[]
  total: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const shown = offenders.slice(0, MAX_ROWS)
  const plural = total === 1 ? '' : 's'

  return (
    // `Modal` is controlled via `onOpenChange`, and its `title` prop renders
    // `sr-only` (it exists for the accessible name), so the VISIBLE heading is
    // ours. Nothing here autofocuses: per issue #1 an effect that focuses inside
    // the portalled content during mount leaves Modal's opener capture null.
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onCancel() }}
      title={`“${fieldName}” cannot become ${targetType}`}
    >
      <h2>“{fieldName}” cannot become {targetType}</h2>
      <p>
        {total} stored value{plural} cannot be read as {targetType}. Fix them, or clear them and convert.
      </p>

      {/* The destructive action sits at the top, and asks again: it is
          irreversible and this dialog is easy to reach by accident. */}
      <div className="flex justify-end">
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(`Clear ${total} stored value${plural}? This cannot be undone.`)) onConfirm()
          }}
        >
          Clear {total} value{plural} and convert
        </Button>
      </div>

      <ul className="list-none pl-0 max-h-[50vh] overflow-auto">
        {shown.map((row) => (
          <li key={row.itemId}>
            {/* A plain anchor, not a router Link: the point is a new tab, and the
                Link component cannot carry target/rel cleanly. */}
            <a href={`/items/${row.itemId}`} target="_blank" rel="noreferrer" className="no-underline">
              {row.name}
            </a>
            {' — '}
            <span className="text-text-muted">“{row.value}”</span>
          </li>
        ))}
      </ul>
      {total > shown.length && <p className="text-text-muted">+ {total - shown.length} more</p>}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Modal>
  )
}
