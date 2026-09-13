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
// The E2E database is minted once per run (see `webServer` in
// playwright.config.ts), so the admin, the "Default" type, and the "Lamp" item
// created by the first test still exist here (tests within a file run serially by
// default). We therefore log in directly rather than replaying first-run setup,
// which would fail because `/` no longer
// routes to `/setup` once the admin exists.
test('uploads a photo and shows it on the item surface', async ({ page }) => {
  // The main test's admin already exists (DB persists within a run). Log in directly.
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  // The main test created the "Lamp" item; its list card is a Link/anchor.
  await page.goto('/items')
  await page.click('a:has-text("Lamp")')

  // Upload a small PNG. The control lives in the item panel now — one place for
  // it, in the empty case as in the full one.
  await page.setInputFiles('[aria-label="Upload photo"]', {
    name: 'lamp.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  })
  // The assertion moved with the design: there is no thumbnail grid to look at
  // any more. The stage shows the photo itself (the full rendition, not a thumb),
  // and the carousel's position indicator reports it.
  await expect(
    page.getByTestId('photo-viewer').locator('img[src*="/file/uploads/originals/"]'),
  ).toBeVisible()
  // The count itself is left free — this leg uploads Lamp's *first* photo, and
  // pinning it here would break the moment another test adds one before this runs.
  await expect(page.getByText(/^\d+ of \d+$/)).toBeVisible()
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

// A tag facet chip paints the tag's colour as an inline `background`, which beats
// every `hover:` utility — so its hover state is a scrim element over the chip,
// hidden until hover. Assert BOTH ends of that: permanently-tinted and
// never-tinted are each a regression the rest of the suite cannot see (the chip's
// colour and its accessible name are unchanged either way).
//
// The `vintage` tag was created above with no colour, so it takes the `#888888`
// default from `tags.create` and genuinely carries a scrim.
test('a coloured tag facet chip reveals its scrim on hover', async ({ page }) => {
  // The main test's admin already exists. Log in directly.
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/items')
  const chip = page.getByRole('button', { name: /^vintage/ })
  await expect(chip).toBeVisible()
  const scrim = chip.locator('span[aria-hidden="true"]')

  await expect(scrim).toHaveCSS('opacity', '0')
  await chip.hover()
  await expect(scrim).toHaveCSS('opacity', '1')
})

// Settings persistence + locale formatting leg. The main test's admin already
// exists (DB persists within a run), so log in directly, open `/settings`, switch
// the locale to de-DE and the theme mode to dark, reload, and assert the choice
// survived AND a date renders in the chosen locale.
test('settings persist across reload and drive locale formatting', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/settings')

  // Switch locale to German and theme mode to dark.
  await page.selectOption('#settings-locale', 'de-DE')
  await page.selectOption('#settings-theme-mode', 'dark')
  await page.selectOption('#settings-dark-palette', 'dark-dracula')

  // The default dark palette resolves to dark-dracula: the root carries the
  // data-theme attribute.
  await expect(page.locator('html[data-theme="dark-dracula"]')).toBeVisible()

  // A date renders in the chosen locale (German day-first format).
  const dateText = await page.getByTestId('locale-date').textContent()
  expect(dateText).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/)

  // Reload → the persisted values survive.
  await page.reload()
  await expect(page.locator('#settings-theme-mode')).toHaveValue('dark')
  await expect(page.locator('#settings-locale')).toHaveValue('de-DE')
})

// The item surface in a real browser. jsdom never loads an image and measures
// nothing, so the intrinsic-size read and the fit decision are stubbed in the
// unit tests; this is the leg that fails if the real DOM disagrees with those
// stubs. It also pins the two things only a real router can show: that the route
// leaves the Shell behind, and where a bare card click lands.
test('a catalog card opens the item surface, full-screen and nav-less', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/items')
  // The card is ONE target: the photo and the name used to be two, because the
  // image opened a lightbox and the name opened the item. There is one place to
  // go now, so the whole card is the link (ADR-0005).
  await page.getByRole('link', { name: 'Lamp', exact: true }).click()

  await expect(page).toHaveURL(/\/items\/\d+$/)
  // The surface drops the Shell's header — that is what makes it full-screen
  // without being a dialog.
  await expect(page.locator('nav')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  // The photo of the *item*, and the actions that belong to it.
  await expect(page.getByTestId('photo-viewer').getByRole('img', { name: 'Lamp', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit photo', exact: true })).toBeVisible()
})

// Escape belongs to the topmost layer, and only to it. This is the leg that pins
// it, and it cannot be a unit test: the bug is a *timing* one. Radix handles
// Escape on the document, so by the time the event has bubbled back out to
// `window` the dialog is already unmounted and the surface has re-rendered —
// a guard that asked React state "is an overlay open?" therefore read "no" and
// closed the surface underneath the dialog it had just dismissed. In jsdom
// testing-library flushes inside `act`, so the dialog is still mounted when the
// event reaches `window` and the bug cannot appear at all.
test('Escape dismisses the editor without closing the item surface under it', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/items')
  await page.getByRole('link', { name: 'Lamp', exact: true }).click()
  const surface = page.url()

  await page.getByRole('button', { name: 'Edit photo', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit photo', exact: true })
  await expect(editor).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(editor).not.toBeVisible()
  // The whole point: one Escape, one layer. The surface is still where it was.
  await expect(page).toHaveURL(surface)
  await expect(page.getByTestId('photo-viewer')).toBeVisible()
})

// The same rule for the other overlay the surface opens, which is a different
// modal (full-viewport) and was reported separately.
test('Escape dismisses manual unpack without closing the item surface under it', async ({ page }) => {
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: 'admin@b.co', password: 'password123' },
  })
  expect(login.ok()).toBeTruthy()

  await page.goto('/items')
  await page.getByRole('link', { name: 'Lamp', exact: true }).click()
  const surface = page.url()

  await page.getByRole('button', { name: 'Manual unpack this photo', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Manual unpack', exact: true })
  // It only renders its canvas once the photo has decoded, which is also what
  // makes Escape's target unambiguous.
  await expect(page.getByTestId('manual-unpack-canvas')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(modal).not.toBeVisible()
  await expect(page).toHaveURL(surface)
  await expect(page.getByTestId('photo-viewer')).toBeVisible()
})
