import { trpc } from '../../api/trpc'
import { Badge, Button } from '../../ui'
import { PhotoUpload } from '../upload/PhotoUpload'

// The subset of an item DTO the panel reads. Structurally compatible with the
// hydrated `ItemDto` returned by `items.get`.
type PanelItem = {
  id: number
  name: string
  description: string
  quantity: number
  unit: string | null
  published: boolean
  customFields: { fieldId: number; fieldName: string; value: string | null }[]
  type: { id: number; name: string } | null
  location: { id: number; name: string } | null
  tags: { id: number; name: string; color: string | null }[]
}

type ItemPanelProps = {
  item: PanelItem
  onEdit: () => void
  onTrash: () => void
  /** The image the upload created, so the surface can move to it. */
  onPhotoAdded: (imageId: number) => void
  /** Below `lg` the panel is a drawer over the photo; this is its state. */
  open: boolean
  onClose: () => void
}

// The read-only account of an item, with the actions that are about the *item*
// rather than about one of its photos.
//
// Read-only is the point (ADR-0003): nothing here edits in place, and **Edit
// item** hands off to the form, which stays the only place an item is edited.
// The fields are what the old detail page printed — name, type, description,
// quantity, location — plus the tags and custom-field values it never rendered
// at all, though `items.get` has always returned them.
//
// The strings here are hardcoded English, as the page this replaces was: the
// item surfaces were never translated, while the drafts and trash pages are.
export function ItemPanel({ item, onEdit, onTrash, onPhotoAdded, open, onClose }: ItemPanelProps) {
  const utils = trpc.useUtils()
  // A draft's panel offers Publish where a catalog item's offers Edit item —
  // otherwise opening a draft from the drafts page would be a poorer experience
  // than the list it came from.
  const publish = trpc.drafts.publish.useMutation({
    onSuccess: () => {
      void utils.items.get.invalidate({ id: item.id })
      utils.items.list.invalidate()
      void utils.drafts.list.invalidate()
    },
  })

  const fields = item.customFields.filter((field) => field.value != null && field.value !== '')

  return (
    <aside
      data-testid="item-panel"
      // One panel, two presentations: docked right at `lg` and up, a full-screen
      // drawer below it (the same shape the catalog's facets use). Two
      // presentations of one component rather than two components, so the fields
      // cannot drift between them.
      className={`${open ? 'flex' : 'hidden'} fixed inset-0 z-50 flex-col gap-3 overflow-y-auto bg-surface p-4 lg:static lg:z-auto lg:flex lg:w-72 lg:shrink-0 lg:border-l lg:border-border`}
    >
      <div className="flex items-start justify-between gap-2">
        <h1 className="m-0 text-lg">{item.name}</h1>
        {/* Not just "Close": the surface's top bar has one of those, and on a
            narrow viewport both are on screen at once. */}
        <Button size="sm" className="lg:hidden" onClick={onClose}>
          Close details
        </Button>
      </div>

      <div className="space-y-1 text-sm text-text-muted">
        <p>
          Qty: {item.quantity}
          {item.unit ? ` ${item.unit}` : ''}
        </p>
        <p>Type: {item.type?.name ?? '—'}</p>
        <p>Location: {item.location?.name ?? '—'}</p>
      </div>

      {item.description ? <p className="text-text">{item.description}</p> : null}

      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Badge key={tag.id} color={tag.color}>
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Only fields that carry a value: an item type's whole field list printed
          with em dashes is a form, and this is a read-out. */}
      {fields.length > 0 && (
        <div className="space-y-1 text-sm">
          {fields.map((field) => (
            <p key={field.fieldId}>
              <span className="text-text-muted">{field.fieldName}: </span>
              {field.value}
            </p>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        {item.published ? (
          <Button onClick={onEdit}>Edit item</Button>
        ) : (
          <Button disabled={publish.isPending} onClick={() => publish.mutate({ id: item.id })}>
            Publish
          </Button>
        )}
        <Button variant="danger" onClick={onTrash}>
          Move to trash
        </Button>
      </div>

      {/* The one place a photo is added, in both the empty and the full case, so
          there is no second control to find and no layout change when the first
          photo lands. */}
      <PhotoUpload itemId={item.id} onUploaded={(image) => onPhotoAdded(image.id)} />
    </aside>
  )
}
