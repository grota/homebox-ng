import { test, expect } from '@playwright/test'

// Happy-path smoke test for the whole catalog: first-run setup → seed an item
// type → create an item → the item appears in the list.
//
// E2E_SEED_TYPE: creating an item requires a non-null `itemTypeId`, and a fresh
// setup-admin has no item types. `ItemForm.handleSubmit` silently no-ops when
// no type is selected, so we seed exactly one type (`Default`, no fields) via
// the API before opening the new-item form.
test('admin catalogs an item end to end', async ({ page }) => {
  // First-run `/setup` bootstraps the admin and logs them in (the built backend
  // issues the `session` cookie here). We wait for the setup mutation response
  // so the cookie is committed before we move on — the SPA would otherwise
  // client-side-redirect to `/login` (its `auth.me` cache still holds the
  // pre-setup `null`), so we then do a full reload at `/items`.
  const setupDone = page.waitForResponse((res) => res.url().includes('/trpc/auth.setup') && res.status() === 200)

  await page.goto('/setup')
  await page.fill('#name', 'Admin')
  await page.fill('#email', 'admin@b.co')
  await page.fill('#password', 'password123')
  await page.click('button:has-text("Create account")')
  await setupDone

  // Seed one item type so the new-item form has a type to select. `page.request`
  // shares the page's (browser-context) cookies, so the admin session is sent.
  const seed = await page.request.post('/trpc/itemTypes.create', {
    data: { name: 'Default', fields: [] },
  })
  expect(seed.ok()).toBeTruthy()

  // Fresh load at `/items` picks up the session cookie and lands on the items
  // page (a plain `navigate` after setup would bounce to `/login`).
  await page.goto('/items')
  await page.click('button:has-text("New item")')

  await page.fill('#item-name', 'Lamp')
  await page.selectOption('#item-type', { label: 'Default' })
  await page.click('button:has-text("Create item")')

  // After create the list refetches; the new item's card shows its name.
  await expect(page.getByText('Lamp')).toBeVisible()
})
