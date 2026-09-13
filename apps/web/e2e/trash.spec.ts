import { test, expect, type Page } from '@playwright/test'

const ADMIN = { name: 'Admin', email: 'admin@b.co', password: 'password123' }

async function ensureAdmin(page: Page) {
  const req = await page.request.get('/trpc/auth.requiresSetup')
  const { setupRequired } = (await req.json()).result.data
  if (setupRequired) {
    await page.request.post('/trpc/auth.setup', { data: ADMIN })
  }
}

async function loginAdmin(page: Page) {
  await ensureAdmin(page)
  const login = await page.request.post('/trpc/auth.login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(login.ok()).toBeTruthy()
}

// No e2e exercised any delete path before this, which is how the item path came
// to leave its image files on disk for so long. This walks the whole guarantee
// from ADR-0004: an item is recoverable, it is out of the catalog while it is
// away, and restoring it puts it back.
test('an item goes to the trash, out of the catalog, and comes back', async ({ page }) => {
  await loginAdmin(page)
  // Every delete is gated by a native confirm; accept them all.
  page.on('dialog', (dialog) => void dialog.accept())

  const type = await page.request.post('/trpc/itemTypes.create', { data: { name: 'Trashable', fields: [] } })
  const typeId = (await type.json()).result.data.id
  const created = await page.request.post('/trpc/items.create', {
    data: { name: 'Doomed Kettle', itemTypeId: typeId, locationId: null, quantity: 1 },
  })
  const itemId = (await created.json()).result.data.id

  // Trash it from the item page.
  await page.goto(`/items/${itemId}`)
  // Wait for the write before navigating: `click()` returns as soon as the event
  // is dispatched, and a `goto` straight after aborts the in-flight request — so
  // nothing is trashed and the next assertion passes for the wrong reason.
  const trashed = page.waitForResponse((res) => res.url().includes('/trpc/items.trash'))
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click()
  expect((await trashed).status()).toBe(200)

  // Gone from the catalog. Waiting on the list response first, or `toHaveCount(0)`
  // is satisfied by a page that has not rendered its items yet.
  const listed = page.waitForResponse((res) => res.url().includes('/trpc/items.list'))
  await page.goto('/items')
  await listed
  await expect(page.getByRole('heading', { name: 'Doomed Kettle', exact: true })).toHaveCount(0)

  // Present in the trash, labelled as an item rather than a draft.
  await page.goto('/trash')
  await expect(page.getByText('Doomed Kettle')).toBeVisible()
  // Substring, because the label shares its element with the timestamp — and
  // scoped to the list, because `/^Item/` also matches the "Items" and "Item
  // types" nav links.
  await expect(page.getByRole('listitem').getByText(/^Item/)).toBeVisible()

  // Restore puts it back in the catalog.
  const restored = page.waitForResponse((res) => res.url().includes('/trpc/trash.restore'))
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  expect((await restored).status()).toBe(200)
  await expect(page.getByText('The trash is empty.')).toBeVisible()

  await page.goto('/items')
  await expect(page.getByRole('heading', { name: 'Doomed Kettle', exact: true })).toBeVisible()
})

test('deleting a location keeps its items and leaves them with no location', async ({ page }) => {
  await loginAdmin(page)
  page.on('dialog', (dialog) => void dialog.accept())

  const type = await page.request.post('/trpc/itemTypes.create', { data: { name: 'Detachable', fields: [] } })
  const typeId = (await type.json()).result.data.id
  const loc = await page.request.post('/trpc/locations.create', { data: { name: 'Doomed Shelf', parentId: null } })
  const locationId = (await loc.json()).result.data.id
  await page.request.post('/trpc/items.create', {
    data: { name: 'Surviving Widget', itemTypeId: typeId, locationId, quantity: 1 },
  })

  await page.goto('/locations')
  // Same race as above: the prompt is a native confirm, and the mutation behind it
  // must land before anything else navigates.
  const removed = page.waitForResponse((res) => res.url().includes('/trpc/locations.delete'))
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
  expect((await removed).status()).toBe(200)

  // The location is gone; the item is not.
  await expect(page.getByText('Doomed Shelf')).toHaveCount(0)
  await page.goto('/items')
  await expect(page.getByRole('heading', { name: 'Surviving Widget', exact: true })).toBeVisible()
})
