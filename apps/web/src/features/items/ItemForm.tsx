import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { trpc } from '../../api/trpc'
import { uploadImage } from '../upload/PhotoUpload'
import { Button, Field, Input, Select, Textarea } from '../../ui'

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
}

type ItemFormProps = {
  item?: EditableItem
  onSaved?: (item: { id: number }) => void
  onCancel?: () => void
}

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
  const utils = trpc.useUtils()

  const types = trpc.itemTypes.list.useQuery()
  const locations = trpc.locations.list.useQuery()

  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit ?? '')
  const [itemTypeId, setItemTypeId] = useState<number | ''>(item?.itemTypeId ?? '')
  const [locationId, setLocationId] = useState<number | ''>(item?.locationId ?? '')
  const [fieldValues, setFieldValues] = useState<Record<number, string>>(
    Object.fromEntries((item?.customFields ?? []).map((f) => [f.fieldId, f.value ?? '']))
  )
  const [photo, setPhoto] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allTypes = types.data ?? []
  const selectedType = allTypes.find((t) => t.id === itemTypeId)

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
    if (itemTypeId === '') return
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
      // but does not roll the item back.
      if (photo) await uploadImage(saved.id, photo)

      utils.items.list.invalidate()
      if (item) utils.items.get.invalidate({ id: item.id })
      onSaved?.(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
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

      <Field label="Type" htmlFor="item-type">
        <Select
          id="item-type"
          value={itemTypeId === '' ? '' : String(itemTypeId)}
          onChange={(e) => handleTypeChange(e.target.value)}
        >
          <option value="">Select a type</option>
          {allTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Location" htmlFor="item-location">
        <Select
          id="item-location"
          value={locationId === '' ? '' : String(locationId)}
          onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">No location</option>
          {(locations.data ?? []).map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </Select>
      </Field>

      {selectedType && selectedType.fields.length > 0 && (
        <fieldset className="border border-border rounded-lg p-3">
          <legend>Custom fields</legend>
          {selectedType.fields.map((field) => (
            // Both `required`s are needed: `Field`'s renders the asterisk, `Input`'s
            // is the native constraint. The label was already `name *` before this
            // conversion, so the accessible name is unchanged.
            <Field key={field.id} label={field.name} htmlFor={`field-${field.id}`} required={field.required}>
              <Input
                id={`field-${field.id}`}
                type={field.fieldType === 'number' || field.fieldType === 'currency' ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'url' ? 'url' : 'text'}
                value={fieldValues[field.id] ?? ''}
                required={field.required}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
              />
            </Field>
          ))}
        </fieldset>
      )}

      <Field label={item ? 'Add photo' : 'Photo'} htmlFor="item-photo">
        <Input
          id="item-photo"
          type="file"
          accept="image/*"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoto(e.target.files?.[0] ?? null)}
        />
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
