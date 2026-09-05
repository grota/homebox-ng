import { trpc } from '../../api/trpc'
import { LocationTree } from './LocationTree'

export function LocationsPage() {
  const { data, isLoading } = trpc.locations.list.useQuery()

  return (
    <section>
      <h1>Locations</h1>
      {isLoading ? <p>Loading…</p> : <LocationTree locations={data ?? []} />}
    </section>
  )
}
