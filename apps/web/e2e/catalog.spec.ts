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

// Photo-upload leg: opens the item the main test created, uploads a 1×1 PNG via
// the real upload control, and asserts the generated thumbnail renders.
//
// The E2E database is cleared only once per run (global-setup), so the admin,
// the "Default" type, and the "Lamp" item created by the first test still exist
// (tests within a file run serially by default). We therefore log in directly
// rather than replaying first-run setup, which would fail because `/` no longer
// routes to `/setup` once the admin exists.
test('uploads a photo and shows its thumbnail', async ({ page }) => {
  // The main test's admin already exists (DB persists within a run). Log in directly.
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  // The main test created the "Lamp" item; its list card is a Link/anchor.
  await page.goto('/items')
  await page.click('a:has-text("Lamp")')

  // Upload a small PNG via the photo input on the item detail page.
  await page.setInputFiles('[aria-label="Upload photo"]', {
    name: 'lamp.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  })
  // After upload the item's get query refetches; the new thumb appears.
  await expect(page.locator('img[src*="/file/uploads/thumbs/"]').first()).toBeVisible()
})

// Search + facet-narrowing leg. The first test's "Lamp" item has NO tag, so a
// narrowing assert would be vacuous (no chip to click). Seed determinism via the
// API — the same idiom the first test uses to seed the "Default" type: fetch the
// Lamp id, create a `vintage` tag, assign it, and create ONE untagged twin
// ("Table Lamp") that also matches the search term. Searching then narrows from
// the two-item set to only the tagged one when the `vintage` facet is applied.
test('search + tag facet narrows the item catalog', async ({ page }) => {
  // The main test's admin already exists. Log in directly.
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  // Resolve the existing "Lamp" item's id (queries are served on GET only, so
  // the `input` is the URL-encoded JSON of the query's input object).
  const listRes = await page.request.get(
    '/trpc/items.list?input=' + encodeURIComponent(JSON.stringify({ page: 1, pageSize: 100 }))
  )
  expect(listRes.ok()).toBeTruthy()
  const lamp = (await listRes.json()).result.data.items.find((item: any) => item.name === 'Lamp')
  expect(lamp, 'the first test should have seeded a "Lamp" item').toBeTruthy()

  // Resolve the "Default" item type id created by the first test (needed so the
  // untagged twin is a well-formed item of the same type).
  const typesRes = await page.request.get(
    '/trpc/itemTypes.list?input=' + encodeURIComponent(JSON.stringify({}))
  )
  expect(typesRes.ok()).toBeTruthy()
  const defaultType = (await typesRes.json()).result.data.find((type: any) => type.name === 'Default')
  expect(defaultType, 'the first test should have seeded a "Default" type').toBeTruthy()

  // Create a `vintage` tag and assign it to the existing "Lamp" item.
  const tagRes = await page.request.post('/trpc/tags.create', { data: { name: 'vintage' } })
  expect(tagRes.ok()).toBeTruthy()
  const vintageId = (await tagRes.json()).result.data.id

  const assignRes = await page.request.post('/trpc/tags.assign', {
    data: { itemId: lamp.id, tagIds: [vintageId] },
  })
  expect(assignRes.ok()).toBeTruthy()

  // Create ONE untagged sibling that also matches the search term. It must NOT be
  // tagged, so the `vintage` facet is what distinguishes it from the tagged Lamp.
  const siblingRes = await page.request.post('/trpc/items.create', {
    data: {
      name: 'Table Lamp',
      description: '',
      quantity: 1,
      unit: null,
      itemTypeId: defaultType.id,
      locationId: null,
      fieldValues: [],
    },
  })
  expect(siblingRes.ok()).toBeTruthy()

  // The search box is bound to `q`; typing debounces (~300ms) then refetches. Both
  // the tagged "Lamp" and the untagged "Table Lamp" match `lamp` and appear as
  // cards, plus a per-card FTS snippet while a search term is active.
  await page.goto('/items')
  await page.getByPlaceholder('Search items').fill('lamp')
  await expect(page.getByRole('heading', { name: 'Lamp', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Table Lamp', exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="item-snippet"]').first()).toBeVisible()

  // Apply the `vintage` tag facet: the result narrows to only the tagged item.
  await page.getByRole('button', { name: /^vintage/ }).click()
  await expect(page.getByRole('heading', { name: 'Lamp', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Table Lamp', exact: true })).not.toBeVisible()
})
