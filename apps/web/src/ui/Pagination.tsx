import { Button } from './Button'

type PaginationProps = {
  /** 1-based. */
  page: number
  /** The unpaginated count, so the last page is derivable without a second field. */
  total: number
  /** The window size the *server* is using. Passing it keeps the Next guard and
   *  the request that produced `total` from disagreeing. */
  pageSize: number
  onPage: (page: number) => void
}

// One pagination control for every paged list, so the page size and the
// last-page arithmetic exist once rather than once per page. Renders nothing when
// there is only one page: a disabled Prev/Next pair is noise, not information.
//
// The labels are plain English, matching what the items page already rendered
// inline before this was extracted. Making them i18n keys would couple a `ui/`
// primitive to react-i18next for three words and one locale; the pages that want
// translated copy can pass their own, and the callers that exist today are
// English-only here anyway.
export function Pagination({ page, total, pageSize, onPage }: PaginationProps) {
  if (total <= pageSize) return null
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex gap-2 items-center mt-4">
      <Button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
        Prev
      </Button>
      <span>
        Page {page} of {lastPage}
      </span>
      <Button onClick={() => onPage(page + 1)} disabled={page >= lastPage}>
        Next
      </Button>
    </div>
  )
}
