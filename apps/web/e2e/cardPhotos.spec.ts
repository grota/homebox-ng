import { test, expect, type Page } from '@playwright/test'

const ADMIN = { name: 'Admin', email: 'admin@b.co', password: 'password123' }

async function loginAdmin(page: Page) {
  const req = await page.request.get('/trpc/auth.requiresSetup')
  const { setupRequired } = (await req.json()).result.data
  if (setupRequired) await page.request.post('/trpc/auth.setup', { data: ADMIN })
  const login = await page.request.post('/trpc/auth.login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(login.ok()).toBeTruthy()
}

// One 1x1 PNG, uploaded as a distinct set of photos. The bytes are identical
// across uploads, so the *src* cannot tell two photos apart — only the badge and
// the position on the surface can, which is why these assert on those.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

// An item with `count` photos, made through the API so the spec does not depend
// on the upload form. The first upload becomes the primary on its own
// (`uploads.ts`: `isPrimary: maxSort == null`), which is where a card starts.
async function itemWithPhotos(page: Page, name: string, count: number) {
  const type = await page.request.post('/trpc/itemTypes.create', { data: { name: `Photos ${name}`, fields: [] } })
  const typeId = (await type.json()).result.data.id
  const created = await page.request.post('/trpc/items.create', {
    data: { name, itemTypeId: typeId, locationId: null, quantity: 1 },
  })
  const itemId = (await created.json()).result.data.id
  for (let i = 0; i < count; i += 1) {
    // `/upload/image` is a plain Fastify route, so it answers with the row rather
    // than a tRPC envelope.
    const res = await page.request.post('/upload/image', {
      multipart: {
        file: { name: `photo-${i}.png`, mimeType: 'image/png', buffer: PNG },
        itemId: String(itemId),
      },
    })
    expect(res.ok()).toBeTruthy()
  }
  return itemId
}

const cardLink = (page: Page, name: string) =>
  page
    .getByTestId('item-card')
    .filter({ has: page.getByRole('checkbox', { name: `Select ${name}`, exact: true }) })
    .getByRole('link')

// The one thing jsdom cannot check: that a real browser's wheel notch over a
// thumbnail actually reaches the handler, that a real drag is a drag rather than
// a click, and that the card does not navigate while either is happening. Every
// assertion here is about the *browser*, not about the React tree.
test('a card’s photo cycles on a wheel notch and a swipe, and never opens the item', async ({ page }) => {
  await loginAdmin(page)
  await itemWithPhotos(page, 'Cycled Lamp', 3)

  await page.goto('/items')
  const card = page.getByTestId('item-card').filter({ has: page.getByRole('checkbox', { name: 'Select Cycled Lamp' }) })
  // Starts on the primary, at the position you land on when you open the card.
  await expect(card.getByText(/^\d\/3$/)).toHaveText('1/3')

  // A horizontal wheel notch over the thumbnail. Chromium will not dispatch a
  // horizontal wheel from a real trackpad here, so the event is dispatched at
  // the element the listener is actually on — which is the thing under test.
  // Notches arrive faster than the throttle in a real burst, so the spec waits
  // out the window between steps — which is also what proves one notch is one
  // step rather than a burst riding through.
  const step = async (deltaX: number, deltaY = 0) => {
    await card.getByRole('link').dispatchEvent('wheel', { deltaX, deltaY })
    await page.waitForTimeout(200)
  }
  await step(60)
  await expect(card.getByText(/^\d\/3$/)).toHaveText('2/3')
  await step(60)
  await expect(card.getByText(/^\d\/3$/)).toHaveText('3/3')
  // Wraps at the end rather than sticking there.
  await step(60)
  await expect(card.getByText(/^\d\/3$/)).toHaveText('1/3')
  await step(-60)
  await expect(card.getByText(/^\d\/3$/)).toHaveText('3/3')

  // A vertical notch from standstill is the mouse's gesture: it steps, and is
  // swallowed like the horizontal one.
  await step(0, 120)
  await expect(card.getByText(/^\d\/3$/)).toHaveText('1/3')

  // A real mouse drag, which is pointer events the browser generates itself.
  const box = (await card.getByRole('link').boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * 0.7, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 })
  await page.mouse.up()

  // The gesture stepped the photos...
  await expect(card.getByText(/^\d\/3$/)).not.toHaveText('3/3')
  // ...and did not also open the item, which is the bug a naive handler has.
  await expect(page).toHaveURL(/\/items$/)
})

// The counter must not move when the badge appears. jsdom lays nothing out, so
// this is the only place the claim can be checked: the top bar centres its middle
// run, and a `Primary` badge that participated in that run's width would shove the
// counter left on the primary photo and not on the others — the controls appearing
// to jump as you page through.
test('the item surface’s counter stays put whether or not the photo is the primary', async ({ page }) => {
  await loginAdmin(page)
  const itemId = await itemWithPhotos(page, 'Steady Lamp', 2)

  await page.goto(`/items/${itemId}`)
  const counter = page.getByText(/\d of \d/).first()
  // `exact`, because a bare `getByText('Primary')` also matches the *Set primary*
  // button — which exists on every non-primary photo, the opposite of the badge.
  const badge = page.getByText('Primary', { exact: true })
  // The first photo is the primary, so the badge is up and the counter is where it
  // sits with the badge present. This is the baseline every other photo must match.
  await expect(badge).toBeVisible()
  const baseline = (await counter.boundingBox())!

  // It is still *visually* trailing the right arrow — taking it out of the flow
  // must not have pushed it under the Close button or off the end.
  const next = (await page.getByRole('button', { name: 'Next photo' }).boundingBox())!
  const at = (await badge.boundingBox())!
  expect(at.x).toBeGreaterThanOrEqual(next.x + next.width - 1)
  expect(at.y).toBeGreaterThanOrEqual(next.y - 1)

  // Off the primary: no badge, and the counter must not have moved.
  await page.getByRole('button', { name: 'Next photo' }).click()
  await expect(badge).toHaveCount(0)
  const onSecond = (await counter.boundingBox())!
  expect(Math.abs(onSecond.x - baseline.x)).toBeLessThanOrEqual(1)

  // And wrapping back onto the primary brings the badge without moving anything.
  await page.getByRole('button', { name: 'Next photo' }).click()
  await expect(badge).toBeVisible()
  const wrapped = (await counter.boundingBox())!
  expect(Math.abs(wrapped.x - baseline.x)).toBeLessThanOrEqual(1)
})

// The surface steps with Left/Right wherever the stage cannot pan. The e2e
// photos are 1x1 PNGs, so they always fit and the navigator is never up —
// exactly the fitted case, in a real browser with real focus.
test('the item surface steps photos with the arrow keys when fitted', async ({ page }) => {
  await loginAdmin(page)
  const itemId = await itemWithPhotos(page, 'Arrow Lamp', 2)

  await page.goto(`/items/${itemId}`)
  await expect(page.getByText(/\d of \d/).first()).toHaveText('1 of 2')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText(/\d of \d/).first()).toHaveText('2 of 2')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText(/\d of \d/).first()).toHaveText('1 of 2')
})

// The setting is a *default*, not a constant: the opposite split is one checkbox
// away, and both halves have to be a real target in their own right.
test('the card’s two halves swap when the setting is turned off', async ({ page }) => {
  await loginAdmin(page)
  await itemWithPhotos(page, 'Split Lamp', 2)

  // Default: the photo opens.
  await page.goto('/items')
  const card = page.getByTestId('item-card').filter({ has: page.getByRole('checkbox', { name: 'Select Split Lamp' }) })
  await expect(card.getByRole('link')).toHaveAttribute('aria-label', 'Open Split Lamp')

  await page.goto('/settings')
  const toggle = page.getByLabel(/photo opens the item/i)
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  // Wait for the write, or the reload below reads the old value and the assertion
  // fails for the wrong reason.
  await page.waitForResponse((res) => res.url().includes('/trpc/settings.update') && res.status() === 200)

  // Now the title opens, and the photo picks — and clicking the photo does *not*
  // navigate, which is the whole point of the swap.
  await page.goto('/items')
  await expect(card.getByRole('link')).toHaveText('Split Lamp')
  await card.getByRole('link').hover()
  await card.locator('img').click({ force: true })
  await expect(page).toHaveURL(/\/items$/)
  await expect(page.getByRole('checkbox', { name: 'Select Split Lamp' })).toBeChecked()

  // And the title, which is the link now, still does not pick.
  await page.getByRole('checkbox', { name: 'Select Split Lamp' }).uncheck()
  await card.getByRole('link').click()
  await expect(page).toHaveURL(/\/items\/\d+$/)
})
