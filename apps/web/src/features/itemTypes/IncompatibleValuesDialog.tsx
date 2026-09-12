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
  open, fieldName, targetType, offenders, total, refreshError, onConfirm, onCancel,
}: {
  open: boolean
  fieldName: string
  targetType: FieldType
  offenders: Offender[]
  total: number
  // Set when the caller's re-read of `offenders`/`total` failed while this is open:
  // the numbers on screen are then unverified, so the dialog says so and refuses the
  // action they would commit to. (The form's own alert is no use here — it renders
  // outside Radix's portal, behind its overlay and its `aria-hidden`.) Null when the
  // list is current, which is every state a caller can present without a failed read.
  refreshError: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const shown = offenders.slice(0, MAX_ROWS)
  const plural = total === 1 ? '' : 's'
  // The caller re-reads this list while the dialog is open, so the count can fall to
  // zero — that is the admin fixing the values in the other tab the links opened. A
  // retype with nothing left to clear is not destructive any more, so it is offered
  // as a plain action: "Clear 0 values" behind a second confirm would be a lie about
  // what the click does.
  const clearing = total > 0
  const heading = clearing ? `“${fieldName}” cannot become ${targetType}` : `Convert “${fieldName}” to ${targetType}`

  return (
    // `Modal` is controlled via `onOpenChange`, and its `title` prop renders
    // `sr-only` (it exists for the accessible name), so the VISIBLE heading is
    // ours. Nothing here autofocuses: per issue #1 an effect that focuses inside
    // the portalled content during mount leaves Modal's opener capture null.
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onCancel() }}
      title={heading}
    >
      <h2>{heading}</h2>
      <p>
        {clearing
          ? `${total} stored value${plural} cannot be read as ${targetType}. Fix them, or clear them and convert.`
          : `No stored value blocks ${targetType}, so nothing will be cleared.`}
      </p>

      {/* A dead end needs a way out, not just a diagnosis: with the action on hold,
          cancel and re-saving the row re-reads the list from scratch. */}
      {refreshError && (
        <p role="alert" className="text-danger">
          {refreshError} The list is out of date, so converting is on hold — cancel and try again.
        </p>
      )}

      {/* The destructive action sits at the top, and asks again: it is
          irreversible and this dialog is easy to reach by accident. With nothing to
          clear there is nothing to ask about, so the retype becomes one click. */}
      <div className="flex justify-end">
        {clearing ? (
          <Button
            variant="danger"
            disabled={refreshError !== null}
            onClick={() => {
              if (window.confirm(`Clear ${total} stored value${plural}? This cannot be undone.`)) onConfirm()
            }}
          >
            Clear {total} value{plural} and convert
          </Button>
        ) : (
          <Button variant="primary" disabled={refreshError !== null} onClick={onConfirm}>
            Convert
          </Button>
        )}
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
