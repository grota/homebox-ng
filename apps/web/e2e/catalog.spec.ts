import { test, expect } from '@playwright/test'

// Happy-path smoke test for the whole catalog: first-run setup → log in → seed
// an item type → create an item → the item appears in the list.
//
// E2E_SEED_TYPE: creating an item requires a non-null `itemTypeId`, and a fresh
// setup-admin has no item types. `ItemForm.handleSubmit` silently no-ops when
// no type is selected, so we seed exactly one type (`Default`, no fields) via
// the API before opening the new-item form.
test('admin catalogs an item end to end', async ({ page }) => {
  // First-run `/setup` bootstraps the admin (it does NOT auto-login; a session
  // is obtained only via `auth.login`). Wait for the setup mutation response.
  const setupDone = page.waitForResponse((res) => res.url().includes('/trpc/auth.setup') && res.status() === 200)

  // A fresh install has no users, so the app must route the home page to the
  // setup screen (not the dead-end sign-in page). This is the regression test
  // for the first-run routing bug.
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup/)
  await page.fill('#name', 'Admin')
  await page.fill('#email', 'admin@b.co')
  await page.fill('#password', 'password123')
  await page.click('button:has-text("Create account")')
  await setupDone

  // Explicit login so an authenticated session exists for the seed and for the
  // SPA. `page.request` shares the browser context's cookies, so the `session`
  // cookie from this login is carried into the seed call and the page.
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  // Seed one item type so the new-item form has a type to select. If the login
  // above did not actually set a session, this admin-gated call returns 401 and
  // `seed.ok()` is false, failing the test.
  const seed = await page.request.post('/trpc/itemTypes.create', {
    data: { name: 'Default', fields: [] },
  })
  expect(seed.ok()).toBeTruthy()

  // A full load at `/items` re-runs `auth.me` with the session cookie.
  await page.goto('/items')
  await page.click('button:has-text("New item")')

  await page.fill('#item-name', 'Lamp')
  await page.selectOption('#item-type', { label: 'Default' })
  await page.click('button:has-text("Create item")')

  // After create the list refetches; the new item's card shows its name.
  await expect(page.getByText('Lamp')).toBeVisible()
})
