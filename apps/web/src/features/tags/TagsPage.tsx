import { trpc } from '../../api/trpc'
import { Badge } from '../../ui'

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
            // `tag.color` is arbitrary user data, so it rides on `Badge`'s inline
            // `color` prop rather than a token class.
            <li key={tag.id}>
              <Badge color={tag.color} className="mr-1">{tag.name}</Badge>
            </li>
          ))}
          {(data ?? []).length === 0 && <p>No tags yet.</p>}
        </ul>
      )}
    </section>
  )
}
