import { trpc } from '../../api/trpc'

export function TagsPage() {
  const { data, isLoading } = trpc.tags.list.useQuery()

  return (
    <section>
      <h1>Tags</h1>
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="list-none flex flex-wrap gap-2">
          {(data ?? []).map((tag) => (
            <li key={tag.id} className="inline-block rounded px-1.5 py-0.5 mr-1 text-xs" style={tag.color ? { background: tag.color } : undefined}>
              {tag.name}
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No tags yet.</p>}
        </ul>
      )}
    </section>
  )
}
