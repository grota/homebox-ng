import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ItemForm } from './ItemForm'

// The create page (ADR-0011). It is a page rather than a toggle on the catalog so the
// form has a URL: a refresh no longer throws away what was typed, and Back leaves the
// form instead of hiding it.
//
// Leaving goes back where the user came from, because the catalog keeps its search and
// facets in the URL and a bare `/items` would silently reset a filtered view — the same
// loss the item surface's own close already guards against. `location.key === 'default'`
// is a cold deep link, where Back would leave the app.
export function ItemNewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const leave = useCallback(() => {
    if (location.key !== 'default') navigate(-1)
    else navigate('/items')
  }, [location.key, navigate])

  return <ItemForm onSaved={leave} onCancel={leave} />
}
