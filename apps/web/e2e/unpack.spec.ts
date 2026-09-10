import { test, expect, type Page } from '@playwright/test'

// Seeded admin account, shared with catalog.spec.ts and admin.spec.ts. The e2e
// DB is minted once per RUN (see `webServer` in playwright.config.ts), so this
// account survives across the spec files that run serially (workers: 1,
// alphabetical file order).
const ADMIN = { name: 'Admin', email: 'admin@b.co', password: 'password123' }

// Make sure the admin exists. Idempotent: check `requiresSetup` and run /setup
// only when no user exists. If an earlier spec file (catalog.spec.ts) bootstrapped
// it first, the /setup POST returns 403 — which is fine, the admin exists.
async function ensureAdmin(page: Page) {
  const req = await page.request.get('/trpc/auth.requiresSetup')
  expect(req.ok()).toBeTruthy()
  const { setupRequired } = (await req.json()).result.data
  if (setupRequired) {
    await page.request.post('/trpc/auth.setup', {
      data: { name: ADMIN.name, email: ADMIN.email, password: ADMIN.password },
    })
  }
}

// Establish an admin session in this context by hitting the login mutation
// directly. `page.request` shares the context's cookies, so the session cookie
// is carried into `page.goto` calls and later API seeding.
async function loginAdmin(page: Page) {
  await ensureAdmin(page)
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  })
  expect(login.ok()).toBeTruthy()
}

// A deterministic 500x300 PNG. The mock detection provider ignores pixel content
// and returns hard-coded boxes (chair + table), so the only constraint on the
// fixture is its dimensions: the detection `clampBox` requires source width >=
// 500 and height >= 180, and the mock boxes (chair x/w -> 220, table x/w -> 500)
// must both stay within the frame.
const PHOTO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAfQAAAEsCAIAAAC62dafAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAEN0lEQVR4nO3UQQkAMAzAwPpXUakzURiEOwV5ZRaAnPkdAMA9cwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gCBzBwgyd4AgcwcIMneAIHMHCDJ3gO15IhfiV2lzQUIAAAAASUVORK5CYII='

test('mock provider unpacks a photo into drafts and publishes them', async ({ page }) => {
  await loginAdmin(page)

  // Seed an item type so the Unpack modal has a target for the unpacked drafts.
  // The "Default" type from catalog.spec.ts already exists; a fresh "Box" type is
  // the one we select so the test does not depend on the earlier specs' state.
  const seedType = await page.request.post('/trpc/itemTypes.create', {
    data: { name: 'Box', fields: [] },
  })
  expect(seedType.ok()).toBeTruthy()

  // Empty-drafts page shows the Unpack modal with the type select.
  await page.goto('/drafts')
  await expect(page.getByRole('heading', { name: 'Drafts' })).toBeVisible()
  await page.getByRole('combobox').selectOption({ label: 'Box' })

  // Feed the fixture photo and trigger the root /upload/unpack route. The mock
  // detection provider returns two boxes (chair + table), so the response reports
  // `detected: 2`.
  const unpackRes = page.waitForResponse((res) => res.url().includes('/upload/unpack'))
  await page.setInputFiles('input[type="file"]', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_B64, 'base64'),
  })
  await page.getByRole('button', { name: 'Unpack', exact: true }).click()
  await unpackRes

  // The Unpack modal navigates to /drafts?detected=<n>; that is the SAME route
  // element, so React Query keeps the (stale, empty) drafts.list result and the
  // list would not refresh. Force a full reload so the two drafts are fetched
  // fresh and deterministic.
  await page.goto('/drafts')

  // Two drafts were created, one per detected box, named from the box labels.
  // The name input has no `type` attribute, so `getByRole('textbox')` matches it
  // by its implicit text role (a `[type="text"]` selector would match zero, as
  // the attribute is absent).
  const nameInputs = page.getByRole('textbox')
  await expect(nameInputs).toHaveCount(2)
  const values = await nameInputs.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  // Ordering of the drafts list is `createdAt` DESC and both boxes share a
  // timestamp, so assert the SET of names rather than a fixed position.
  expect([...values].sort()).toEqual(['chair', 'table'])

  // Rename the chair draft. `defaultValue` makes the input uncontrolled, so the
  // value is only persisted on blur (DraftsPage fires drafts.update fire-and-forget).
  const chairIdx = values.findIndex((v) => v === 'chair')
  expect(chairIdx).toBeGreaterThanOrEqual(0)
  const updateDone = page.waitForResponse((res) => res.url().includes('/trpc/drafts.update'))
  await nameInputs.nth(chairIdx).fill('Office chair')
  await nameInputs.nth(chairIdx).press('Tab')
  await updateDone

  // Select both drafts and publish them (drafts.publishAll). On success the
  // frontend invalidates drafts.list, which refetches to the empty state.
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check()
  await page.getByRole('button', { name: 'Publish selected', exact: true }).click()
  await expect(page.getByText('No drafts. Use Unpack a photo to import several items at once.')).toBeVisible()

  // A published item is not a draft any more: it shows up in the catalog (the
  // items.list query has a base `published = true` predicate). The renamed chair
  // proves the rename survived the publish.
  await page.goto('/items')
  await expect(page.getByRole('heading', { name: 'Office chair', exact: true })).toBeVisible()
})
