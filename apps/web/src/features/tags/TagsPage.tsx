import { trpc } from '../../api/trpc'

export function TagsPage() {
  const { data, isLoading } = trpc.tags.list.useQuery()

  return (
    <section>
      <h1>Tags</h1>
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul className="tag-list">
          {(data ?? []).map((tag) => (
            <li key={tag.id} className="tag" style={tag.color ? { background: tag.color } : undefined}>
              {tag.name}
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No tags yet.</p>}
        </ul>
      )}
    </section>
  )
}
