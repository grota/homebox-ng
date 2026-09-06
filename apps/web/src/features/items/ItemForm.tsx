import { useState } from 'react'
import type { FormEvent } from 'react'
import { trpc } from '../../api/trpc'

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
    const input = {
      name,
      description,
      quantity: Math.max(0, Number(quantity) || 0),
      unit: unit.trim() === '' ? null : unit.trim(),
      itemTypeId: Number(itemTypeId),
      locationId: locationId === '' ? null : Number(locationId),
      fieldValues: (selectedType?.fields ?? []).map((f) => ({ fieldId: f.id, value: fieldValues[f.id] ?? '' })),
    }

    const saved = item
      ? await updateItem.mutateAsync({ id: item.id, ...input })
      : await createItem.mutateAsync(input)

    utils.items.list.invalidate()
    if (item) utils.items.get.invalidate({ id: item.id })
    onSaved?.(saved)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-[30rem] my-4">
      <h2>{item ? 'Edit item' : 'New item'}</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="item-name">Name</label>
        <input
          id="item-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="item-description">Description</label>
        <textarea
          id="item-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="item-quantity">Quantity</label>
          <input
            id="item-quantity"
            type="number"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="item-unit">Unit</label>
          <input
            id="item-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="item-type">Type</label>
        <select
          id="item-type"
          value={itemTypeId === '' ? '' : String(itemTypeId)}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          <option value="">Select a type</option>
          {allTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="item-location">Location</label>
        <select
          id="item-location"
          value={locationId === '' ? '' : String(locationId)}
          onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          <option value="">No location</option>
          {(locations.data ?? []).map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </div>

      {selectedType && selectedType.fields.length > 0 && (
        <fieldset className="border border-border rounded-lg p-3">
          <legend>Custom fields</legend>
          {selectedType.fields.map((field) => (
            <div className="flex flex-col gap-1" key={field.id}>
              <label htmlFor={`field-${field.id}`}>
                {field.name}
                {field.required ? ' *' : ''}
              </label>
              <input
                id={`field-${field.id}`}
                type={field.fieldType === 'number' || field.fieldType === 'currency' ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'url' ? 'url' : 'text'}
                value={fieldValues[field.id] ?? ''}
                required={field.required}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                className="px-2 py-1 border border-border rounded-md bg-surface text-text"
              />
            </div>
          ))}
        </fieldset>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={createItem.isPending || updateItem.isPending}
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
        >
          {item ? 'Save' : 'Create item'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md border border-border bg-surface text-text"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
