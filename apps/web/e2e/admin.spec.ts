import { test, expect, type Page } from '@playwright/test'
import { E2E_BASE_URL } from './base-url'

// Seeded admin account, shared with catalog.spec.ts. `auth.setup` only allows a
// bootstrap when no user exists yet, so admin.spec.ts bootstraps it idempotently
// (via the API) rather than replaying the first-run `/setup` UI.
const ADMIN = { name: 'Admin', email: 'admin@b.co', password: 'password123' }

// Make sure the admin exists. Idempotent: check `requiresSetup` and run /setup
// only when no user exists. If another spec file (catalog.spec.ts) bootstrapped
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
// is carried into `page.goto` calls.
async function loginAdmin(page: Page) {
  await ensureAdmin(page)
  const login = await page.request.post('/trpc/auth.login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  })
  expect(login.ok()).toBeTruthy()
}

test('admin invites a user who is forced to change their password on first login', async ({ page, browser }) => {
  await loginAdmin(page)

  // Admin reaches the back-office and the default Users tab is active.
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin/)
  await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible()

  // Invite a new user; the one-time temp password is surfaced once via the
  // `data-testid="temp-password"` banner. The email is unique per run so the
  // create never trips the users.create CONFLICT on a reused/repopulated DB.
  const inviting = `invited-${Date.now()}@test.co`
  const tempPw = 'temp-pass-1234'
  await page.fill('#admin-user-name', 'Invited User')
  await page.fill('#admin-user-email', inviting)
  await page.fill('#admin-user-password', tempPw)
  await page.selectOption('#admin-user-role', 'user')
  await page.click('button:has-text("Invite user")')
  await expect(page.getByTestId('temp-password')).toHaveText(tempPw)

  // Log in AS the invited user in a FRESH context (the admin session cookie must
  // not leak). Drive the real sign-in form so the app's forced-change navigation
  // runs: a must-change account is routed to /change-password.
  // `baseURL` is passed explicitly: a context created by hand does not inherit
  // the project's `use`, so a relative path would not resolve without it. That
  // is why the port has a single definition in `./base-url` for both this and
  // the config, rather than a literal repeated here.
  const userCtx = await browser.newContext({ baseURL: E2E_BASE_URL })
  const userPage = await userCtx.newPage()
  try {
    await userPage.goto('/login')
    await userPage.fill('#email', inviting)
    await userPage.fill('#password', tempPw)
    await userPage.click('button:has-text("Sign in")')
    await expect(userPage).toHaveURL(/\/change-password/)

    // Change the password (the flag is cleared server-side) → the catalog. The
    // app navigates to `/` and routes.tsx redirects that to `/items`, so `/` is
    // a state this assertion can never observe — hence `/items`, not `/`.
    const newPw = 'new-pass-5678'
    await userPage.fill('#current-password', tempPw)
    await userPage.fill('#new-password', newPw)
    await userPage.click('button:has-text("Change password")')
    await expect(userPage).toHaveURL(/\/items$/)

    // Log out and log back in with the NEW password: no forced-change screen.
    await userPage.request.post('/trpc/auth.logout')
    await userPage.goto('/login')
    await userPage.fill('#email', inviting)
    await userPage.fill('#password', newPw)
    await userPage.click('button:has-text("Sign in")')
    await expect(userPage).toHaveURL(/\/items$/)
  } finally {
    await userCtx.close()
  }
})

test('admin creates a stored backup, downloads it, and restores it', async ({ page }) => {
  await loginAdmin(page)

  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Backup & restore' }).click()

  // Create: stored server-side, and the tab says to refresh rather than polling.
  await page.getByRole('button', { name: 'Create backup' }).click()
  await expect(page.getByRole('status')).toHaveText('Backup started — refresh to see it finish.')

  // There is no polling, so a reload is how the row reaches `completed`. The
  // selected tab is local React state (AdminPage), not a URL param, so every
  // reload drops back to Users and the tab must be re-opened each time.
  await expect(async () => {
    await page.reload()
    await page.getByRole('tab', { name: 'Backup & restore' }).click()
    await expect(page.getByRole('cell', { name: 'completed' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 20000 })

  // Download from the row (a real blob download).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).first().click(),
  ])
  const backupPath = test.info().outputPath('homebox-backup.tar.gz')
  await download.saveAs(backupPath)

  // Restore-from-row is non-destructive and stays two clicks. The row action
  // opens the same preview card the upload path uses and applies NOTHING by
  // itself — that is the whole safety property, so assert both halves: the card
  // appears, and the destructive outcome has not happened.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click()
  await expect(page.getByText('Backup preview')).toBeVisible()
  await expect(page.getByText('Restore complete.')).toBeHidden()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Backup preview')).toBeHidden()

  // Delete is the row's only data-removing action. It drops the row here, and
  // the archive + sidecar on disk (asserted in the API suite).
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'completed' })).toBeHidden()
  await expect(page.getByRole('status')).toHaveText('Backup deleted.')

  // The upload path is unchanged: non-destructive preview, then confirm.
  await page.setInputFiles('#admin-backup-file', backupPath)
  await expect(page.getByText('Backup preview')).toBeVisible()
  // Anchored on digits so raw `{placeholder}` text cannot satisfy it: i18next
  // interpolates `{{ }}`, and a single-brace key would render the braces
  // literally to the user. Asserting the rendered counts proves interpolation.
  await expect(page.getByText(/\d+ users · \d+ items · \d+ uploads · max [\d.]+ MB/)).toBeVisible()
  await expect(page.getByText('This replaces all current data.')).toBeVisible()
  await page.getByRole('button', { name: 'Restore this backup' }).click()
  await expect(page.getByRole('status')).toHaveText('Restore complete.')
})
