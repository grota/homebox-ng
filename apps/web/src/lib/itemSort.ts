import { ITEM_SORT_PREFERENCES, type ItemSort } from '@homebox/shared'

// The labels for the catalog's orderings, in one place because two surfaces
// offer them: the per-user `/settings` page, and the items page itself.
//
// `relevance` has a label here and is *not* in `ITEM_SORT_PREFERENCES`: the items
// page offers it while a search term is active, where it is the effective order,
// and it is never a stored preference.
export const ITEM_SORT_LABELS: Record<ItemSort, string> = {
  relevance: 'Relevance',
  'createdAt:desc': 'Newest first',
  'createdAt:asc': 'Oldest first',
  'updatedAt:desc': 'Recently updated',
  'updatedAt:asc': 'Least recently updated',
  'name:asc': 'Name A–Z',
  'name:desc': 'Name Z–A',
}

// The orderings a user can store — what `/settings` lists.
export const ITEM_SORT_OPTIONS = ITEM_SORT_PREFERENCES.map((value) => ({
  value,
  label: ITEM_SORT_LABELS[value],
}))
