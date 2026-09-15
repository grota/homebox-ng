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
  await page.getByRole('button', { name: 'Auto unpack', exact: true }).click()
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
  // Both boxes share a `createdAt` second, so this order is the `id` tiebreak
  // doing its job — and that tiebreak is what makes paging safe, since a
  // non-total order lets rows repeat or vanish between pages. Newest first.
  expect(values).toEqual(['table', 'chair'])

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

// The path nothing else covers: the boxes come from the pointer rather than from
// a provider. Everything downstream of the box is shared with the auto path, so
// what this proves is the drawing, the naming, and the coordinate conversion —
// a wrong conversion would still create two drafts, named right, cropped from
// the wrong place.
test('manual unpack turns drawn rectangles into named drafts', async ({ page }) => {
  await loginAdmin(page)
  await page.request.post('/trpc/itemTypes.create', { data: { name: 'Manual box', fields: [] } })

  await page.goto('/drafts')
  await page.getByRole('combobox').selectOption({ label: 'Manual box' })
  await page.setInputFiles('input[type="file"]', {
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PHOTO_B64, 'base64'),
  })

  await page.getByRole('button', { name: 'Manual unpack', exact: true }).click()
  const canvas = page.getByTestId('manual-unpack-canvas')
  await expect(canvas).toBeVisible()
  // Ready means the image has decoded: the overlay only renders once the natural
  // size is known, and until then a drag is discarded — so waiting on the box
  // alone would silently swallow the first drag and leave one rectangle.
  await expect(page.locator('[data-testid="manual-unpack-image"] svg')).toBeVisible()

  // Which hint sentence shows is a CSS branch on pointer type, and this is the
  // only place it can be observed: jsdom applies no CSS, so the unit suite can
  // assert the two sentences differ but not that one of them is hidden. This
  // project is a desktop Chrome (`pointer: fine`), so the keyboard sentence is
  // the visible one — delete the variant and both show at once.
  await expect(page.getByText(/press Space/)).toBeVisible()
  await expect(page.getByText(/Tap a box to select it/)).toBeHidden()

  // Drawn against the *image*, not the canvas: the image is fitted and centred
  // inside the canvas, so canvas-relative coordinates near an edge land outside
  // the photo, where the clamp turns the drag into a sliver that the minimum-size
  // check then rejects. Measured per drag, because the first rectangle adds a row
  // underneath and shrinks the canvas.
  const image = page.getByTestId('manual-unpack-image')
  const drag = async (fx: number, fy: number, tx: number, ty: number) => {
    const box = (await image.boundingBox())!
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 5 })
    await page.mouse.up()
  }
  await drag(0.08, 0.15, 0.38, 0.55)
  await drag(0.55, 0.2, 0.9, 0.65)

  const names = page.getByPlaceholder('Item name')
  await expect(names).toHaveCount(2)
  await names.nth(0).fill('Left thing')
  await names.nth(1).fill('Right thing')

  // Panning is a *mode*: Space toggles the same state the header button does, so
  // there is nothing to hold and nothing to get in the right order. Pinned with
  // real input because jsdom cannot see the focus or the keystroke routing this
  // failed on.
  //
  // The click first is the point of the test, not setup. Filling a name leaves
  // focus in that text box, and a text field must keep Space as a character — item
  // names contain spaces — so Space toggles only while the drawing surface has
  // focus. Pressing it with a name box focused types a space and does nothing,
  // which is exactly how this failed in a real session, and is why the modal now
  // opens with focus on the photo.
  await canvas.click({ position: { x: 6, y: 6 } })
  const centre = (await image.boundingBox())!
  const tx = centre.x + centre.width / 2
  const ty = centre.y + centre.height / 2
  await page.mouse.move(tx, ty)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(250)

  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Moving', exact: true })).toBeVisible()

  // The overlay is an inline <svg>, which Chromium drags as an image by default
  // however the <img> is configured. When the browser wins that race it takes the
  // pointer, panning dies mid-gesture, and a ghost of the overlay trails the
  // cursor — reported from a real session as the photo being dragged. Recorded on
  // `document` in the bubble phase, i.e. after React's root handler has had its
  // say, so `defaultPrevented` is the real answer.
  await page.evaluate(() => {
    window.__uncancelledDrags = 0
    document.addEventListener('dragstart', (e) => { if (!e.defaultPrevented) window.__uncancelledDrags++ })
  })

  // Four gestures rather than one: the failure being guarded against is "it works
  // and then it stops", which a single drag cannot show.
  //
  // Movement is only asserted as "it moved at all". How far a pan *can* move
  // depends on how much the photo overflows the canvas, which is layout-dependent —
  // at fit it correctly cannot move at all — and a per-pan assertion here failed
  // for exactly that reason rather than for a real defect.
  const readTransform = () => image.evaluate((el) => (el as HTMLElement).style.transform)
  const beforePan = await readTransform()
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(tx, ty)
    await page.mouse.down()
    await page.mouse.move(tx, ty + 15, { steps: 3 })
    await page.mouse.up()
  }
  expect(await readTransform()).not.toBe(beforePan)

  // The two assertions that actually pin the reported bug. A hijacked drag takes
  // the pointer and the gesture silently dies, so: no drag escaped, and the mode
  // is still the one the gesture started in.
  expect(await page.evaluate(() => window.__uncancelledDrags)).toBe(0)
  await expect(page.getByRole('button', { name: 'Moving', exact: true })).toBeVisible()

  // Back to drawing, and the stray click above must not have drawn anything: the
  // submit below still says two.
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: 'Move photo', exact: true })).toBeVisible()

  const done = page.waitForResponse((res) => res.url().includes('/upload/unpack/manual'))
  await page.getByRole('button', { name: 'Create 2 drafts', exact: true }).click()
  expect((await done).status()).toBe(200)

  await page.goto('/drafts')
  await expect(page.getByRole('textbox')).toHaveCount(2)
  const values = await page.getByRole('textbox').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))
  expect([...values].sort()).toEqual(['Left thing', 'Right thing'])
})
