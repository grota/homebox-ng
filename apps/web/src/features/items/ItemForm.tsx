import { useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { trpc } from '../../api/trpc'
import { uploadImage } from '../upload/PhotoUpload'
import { PhotoCrop } from '../upload/PhotoCrop'
import { filenameForBlob } from '../upload/PhotoEditor'
import { Button, Field, Input, Select, Textarea } from '../../ui'
import { flattenLocations, locationOptionLabel } from '../../lib/locationPath'

// The subset of an item DTO needed to prefill edit mode. Structurally compatible
// with the hydrated `ItemDto` returned by `items.get`/`items.list`.
type EditableItem = {
  id: number
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  customFields: { fieldId: number; fieldName: string; value: string | null }[]
  tags?: { id: number; name: string; color: string | null }[]
}

type ItemFormProps = {
  item?: EditableItem
  onSaved?: (item: { id: number }) => void
  onCancel?: () => void
}

// The crop dialog hands back a Blob; the upload wants a File. The container is taken
// from the blob's own type — the dialog offers jpeg, png and webp — because a WebP
// stored under a `.jpg` name is saved with the wrong extension and served with the
// wrong content type.
const asFile = (blob: Blob) => new File([blob], filenameForBlob(blob, 'photo'), { type: blob.type })

// Create/edit an item. Selecting an item type loads its custom-field
// definitions (`fields`) and renders one input per field; those values are
// submitted as `fieldValues: [{ fieldId, value }]`.
//
// The photo picker holds the file until submit, because the upload endpoint
// needs the item's id — which only exists once `items.create`/`items.update`
// returns. Picking a photo therefore means "save, then upload".
export function ItemForm({ item, onSaved, onCancel }: ItemFormProps) {
  const createItem = trpc.items.create.useMutation()
  const updateItem = trpc.items.update.useMutation()
  // `tags.assign` is its own procedure (an item's tags are a many-to-many link,
  // not a column), so tagging an item is a second call after the item write.
  const assignTags = trpc.tags.assign.useMutation()
  const createTag = trpc.tags.create.useMutation()
  const utils = trpc.useUtils()

  const types = trpc.itemTypes.list.useQuery()
  const locations = trpc.locations.list.useQuery()
  const tags = trpc.tags.list.useQuery()

  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [itemTypeId, setItemTypeId] = useState<number | ''>(item?.itemTypeId ?? '')
  const [locationId, setLocationId] = useState<number | ''>(item?.locationId ?? '')
  const [fieldValues, setFieldValues] = useState<Record<number, string>>(
    Object.fromEntries((item?.customFields ?? []).map((f) => [f.fieldId, f.value ?? '']))
  )
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>((item?.tags ?? []).map((t) => t.id))
  const [newTag, setNewTag] = useState('')
  // `Clear` reaches the element itself to empty its value, so this picker holds a ref.
  const photoInput = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  // The plain upload beside it: picked as-is, no crop step. Same held-until-submit
  // shape, because create mode has no item id to upload against yet.
  const plainPhotoInput = useRef<HTMLInputElement>(null)
  const [plainPhoto, setPlainPhoto] = useState<File | null>(null)
  // The file the crop dialog is open on, if any. Separate from `photo` on purpose:
  // closing the dialog without cropping keeps the file that was picked.
  const [cropping, setCropping] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allTypes = types.data ?? []
  const selectedType = allTypes.find((t) => t.id === itemTypeId)
  const allTags = tags.data ?? []

  // The tag set the item arrived with. `tags.assign` REPLACES the whole set, so
  // it may only be sent when this form actually knows the current one — a caller
  // passing an item without `tags` would otherwise silently clear them on save.
  // A new item has no prior set, so create mode is always safe.
  const loadedTagIds = (item?.tags ?? []).map((t) => t.id)
  const tagsKnown = item === undefined || Array.isArray(item.tags)
  const tagSetChanged =
    [...selectedTagIds].sort((a, b) => a - b).join(',') !== [...loadedTagIds].sort((a, b) => a - b).join(',')

  const toggleTag = (id: number) =>
    setSelectedTagIds((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]))

  // `tags.create` upserts by name, so this both adds a new tag and selects an
  // existing one whose name was retyped.
  const handleCreateTag = async () => {
    const trimmed = newTag.trim()
    if (trimmed === '') return
    setError(null)
    try {
      const created = await createTag.mutateAsync({ name: trimmed })
      await utils.tags.list.invalidate()
      setSelectedTagIds((current) => (current.includes(created.id) ? current : [...current, created.id]))
      setNewTag('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the tag')
    }
  }

  const clearPhoto = () => {
    setPhoto(null)
    setCropping(null)
    if (photoInput.current) photoInput.current.value = ''
  }

  const clearPlainPhoto = () => {
    setPlainPhoto(null)
    if (plainPhotoInput.current) plainPhotoInput.current.value = ''
  }

  const handleTypeChange = (value: string) => {
    const id = Number(value)
    setItemTypeId(id)
    // Keep only the field values that belong to the newly selected type.
    const newFieldIds = new Set((allTypes.find((t) => t.id === id)?.fields ?? []).map((f) => f.id))
    setFieldValues((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => newFieldIds.has(Number(key))))
    )
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Report it rather than returning in silence. The submit button is enabled,
    // so a click that did nothing read as a broken form rather than as "you have
    // not chosen a type" — the same trap `UnpackModal` already handles with a
    // message. The two cases get different wording because "choose a type" is
    // useless advice when there are no types to choose from.
    if (itemTypeId === '') {
      setError(
        allTypes.length === 0
          ? 'There are no item types yet — create one before adding an item.'
          : 'Choose a type.'
      )
      return
    }
    setError(null)
    const input = {
      name,
      description,
      quantity: Math.max(0, Number(quantity) || 0),
      unit: unit.trim() === '' ? null : unit.trim(),
      itemTypeId: Number(itemTypeId),
      locationId: locationId === '' ? null : Number(locationId),
      // Omit `fieldValues` entirely until the selected type's definitions have
      // loaded. In edit mode `itemTypeId` is prefilled, so `selectedType` is
      // undefined until `itemTypes.list` resolves — and `items.update` treats a
      // present `fieldValues` as a full replacement, so sending the `[]` we'd
      // build during that window would wipe every custom-field value on the
      // item. Omitting it leaves them untouched (create defaults to `[]`).
      ...(selectedType
        ? { fieldValues: selectedType.fields.map((f) => ({ fieldId: f.id, value: fieldValues[f.id] ?? '' })) }
        : {}),
    }

    try {
      const saved = item
        ? await updateItem.mutateAsync({ id: item.id, ...input })
        : await createItem.mutateAsync(input)

      // Create/edit-then-upload: both mutations return the item DTO, so
      // `saved.id` is the `itemId` the upload route needs. The item write has
      // already committed at this point, so a failed upload reports the error
      // but does not roll the item back. Each picked file uploads on its own —
      // the order carries no meaning, and one failing takes neither the other
      // nor the item with it.
      let uploadError: string | null = null
      for (const file of [photo, plainPhoto]) {
        if (!file) continue
        try {
          await uploadImage(saved.id, file)
        } catch (err) {
          uploadError = err instanceof Error ? err.message : 'Upload failed'
        }
      }
      if (uploadError) throw new Error(uploadError)

      // Same shape of trade-off for the tags: a second, non-atomic call whose
      // failure leaves the item itself saved. Skipped when the set is unchanged,
      // so a plain rename does not churn the links or reindex the item.
      if (tagsKnown && tagSetChanged) await assignTags.mutateAsync({ itemId: saved.id, tagIds: selectedTagIds })

      utils.items.list.invalidate()
      if (item) utils.items.get.invalidate({ id: item.id })
      onSaved?.(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] mx-auto my-4">
      <h2>{item ? 'Edit item' : 'New item'}</h2>

      <Field label="Name" htmlFor="item-name">
        <Input
          id="item-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Field>

      <Field label="Description" htmlFor="item-description">
        <Textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Quantity" htmlFor="item-quantity">
          <Input
            id="item-quantity"
            type="number"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full"
          />
        </Field>
        <Field label="Unit" htmlFor="item-unit">
          <Input
            id="item-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="w-full"
          />
        </Field>
      </div>

      {/* `required` on the *control*, not on `Field` — the same way `Name` above
          does it. `Field`'s asterisk is rendered inside the `<label>`, so asking
          for it would change this control's accessible name from "Type" to
          "Type *" for every screen reader and every `getByLabelText('Type')`. The
          asterisk is decoration; the constraint is the attribute.

          It is skipped while the control is disabled, which is what lets the
          guard in `handleSubmit` give the real reason instead of the browser's
          "please select an item in the list" for a list that is empty. */}
      <Field label="Type" htmlFor="item-type">
        <Select
          id="item-type"
          value={itemTypeId === '' ? '' : String(itemTypeId)}
          onChange={(e) => handleTypeChange(e.target.value)}
          required
          disabled={allTypes.length === 0}
        >
          <option value="">Select a type</option>
          {allTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* An unseeded instance has no types, so the select above holds nothing but
          its placeholder and the form cannot be completed by any amount of
          typing. Saying so, with the way out, is the whole difference between
          "this form is broken" and "this instance has no types yet". */}
      {allTypes.length === 0 && (
        <p className="text-text-muted text-sm">
          No item types yet — <Link to="/types">create one</Link> before adding an item.
        </p>
      )}

      <Field label="Location" htmlFor="item-location">
        <Select
          id="item-location"
          value={locationId === '' ? '' : String(locationId)}
          onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">No location</option>
          {/* `locations.list` is a tree, so it is flattened before it becomes
              options — the tree mapped flat is why only the roots used to appear. */}
          {(locations.data ?? []).length > 0 &&
            flattenLocations(locations.data ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {locationOptionLabel(loc)}
              </option>
            ))}
        </Select>
      </Field>

      {selectedType && selectedType.fields.length > 0 && (
        <fieldset className="border border-border rounded-lg p-3">
          <legend>Custom fields</legend>
          {selectedType.fields.map((field) => {
            // A number input defaults to step=1, so a stored decimal such as 120.50
            // raises stepMismatch and native validation blocks the whole submit —
            // the item becomes unsaveable. `fitsFieldType` blesses any float for
            // these two types, so `any` is the step that matches it.
            const numeric = field.fieldType === 'number' || field.fieldType === 'currency'
            // Both `required`s are needed: `Field`'s renders the asterisk, `Input`'s
            // is the native constraint. The label was already `name *` before this
            // conversion, so the accessible name is unchanged.
            return (
              <Field key={field.id} label={field.name} htmlFor={`field-${field.id}`} required={field.required}>
                <Input
                  id={`field-${field.id}`}
                  type={numeric ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'url' ? 'url' : 'text'}
                  step={numeric ? 'any' : undefined}
                  value={fieldValues[field.id] ?? ''}
                  required={field.required}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                />
              </Field>
            )
          })}
        </fieldset>
      )}

      <fieldset className="border border-border rounded-lg p-3">
        <legend>Tags</legend>
        {allTags.length === 0 ? (
          <p className="text-text-muted">No tags yet — add one below.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {allTags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-1">
                {/* A native checkbox: no primitive exists for it, and the label
                    wrapper is what gives it the tag's name as its accessible
                    name. */}
                <input
                  type="checkbox"
                  checked={selectedTagIds.includes(tag.id)}
                  onChange={() => toggleTag(tag.id)}
                />
                {tag.name}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-end mt-2">
          <Field label="New tag" htmlFor="item-new-tag" className="flex-1 min-w-0">
            <Input
              id="item-new-tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Tag name"
              className="w-full"
            />
          </Field>
          <Button onClick={handleCreateTag} disabled={newTag.trim() === '' || createTag.isPending}>
            Add tag
          </Button>
        </div>
      </fieldset>

      {/* The crop is the edit: picking here opens the crop dialog, so the label
          says what the file becomes rather than what the control is. */}
      <Field label="Add edited photo" htmlFor="item-photo">
        <Input
          ref={photoInput}
          id="item-photo"
          type="file"
          accept="image/*"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCropping(e.target.files?.[0] ?? null)}
        />
        {/* A photo is picked and held until submit, so until `Clear` existed the only way to
            change your mind was to pick a different one. It empties the input as well as the
            state, so what the field shows and what will be uploaded are the same file. */}
        {photo && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-text-muted text-sm">{photo.name}</span>
            <Button type="button" onClick={clearPhoto}>
              Clear
            </Button>
          </div>
        )}
      </Field>

      {/* Removing the background before the item exists is the point of cropping here
          (ADR-0012), so it is offered on pick rather than after the save. */}
      {cropping && (
        <PhotoCrop
          file={cropping}
          onSave={(blob) => {
            setPhoto(asFile(blob))
            setCropping(null)
          }}
          onClose={() => {
            setPhoto(cropping)
            setCropping(null)
          }}
        />
      )}

      {/* The plain picker beside it: no crop step, the file uploads as picked.
          Held until submit like the one above, for the same reason — create
          mode has no item id until the save returns. */}
      <Field label="Add photo" htmlFor="item-plain-photo">
        <Input
          ref={plainPhotoInput}
          id="item-plain-photo"
          type="file"
          accept="image/*"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPlainPhoto(e.target.files?.[0] ?? null)}
        />
        {plainPhoto && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-text-muted text-sm">{plainPhoto.name}</span>
            <Button type="button" onClick={clearPlainPhoto}>
              Clear
            </Button>
          </div>
        )}
      </Field>

      {error && <p role="alert" className="text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={createItem.isPending || updateItem.isPending}>
          {item ? 'Save' : 'Create item'}
        </Button>
        {onCancel && (
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
