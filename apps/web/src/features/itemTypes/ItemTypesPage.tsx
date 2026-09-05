import { trpc } from '../../api/trpc'

export function ItemTypesPage() {
  const { data, isLoading } = trpc.itemTypes.list.useQuery()

  return (
    <section>
      <h1>Item types</h1>
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="type-list">
          {(data ?? []).map((type) => (
            <li key={type.id}>
              <strong>{type.name}</strong>
              {type.description && <p>{type.description}</p>}
              {type.fields.length > 0 && (
                <ul>
                  {type.fields.map((field) => (
                    <li key={field.id}>
                      {field.name} <span className="muted">({field.fieldType})</span>
                      {field.required ? ' *' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No item types yet.</p>}
        </ul>
      )}
    </section>
  )
}
