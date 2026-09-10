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

    // Change the password (the flag is cleared server-side) → back home.
    const newPw = 'new-pass-5678'
    await userPage.fill('#current-password', tempPw)
    await userPage.fill('#new-password', newPw)
    await userPage.click('button:has-text("Change password")')
    await expect(userPage).toHaveURL(/\/$/)

    // Log out and log back in with the NEW password: no forced-change screen.
    await userPage.request.post('/trpc/auth.logout')
    await userPage.goto('/login')
    await userPage.fill('#email', inviting)
    await userPage.fill('#password', newPw)
    await userPage.click('button:has-text("Sign in")')
    await expect(userPage).toHaveURL(/\/$/)
  } finally {
    await userCtx.close()
  }
})

test('admin downloads a backup and restores it (round-trip)', async ({ page }) => {
  await loginAdmin(page)

  // Open the Backup & restore tab.
  await page.goto('/admin')
  // A tab, not a button, since AdminPage moved to a Radix-backed Tabs primitive —
  // the tablist/tab semantics are the point of that change.
  await page.getByRole('tab', { name: 'Backup & restore' }).click()

  // Download a fresh backup archive via the Download button (real blob download).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ])
  const backupPath = test.info().outputPath('homebox-backup.tar.gz')
  await download.saveAs(backupPath)

  // Upload the downloaded archive → non-destructive preview renders.
  await page.setInputFiles('#admin-backup-file', backupPath)
  await expect(page.getByText('Backup preview')).toBeVisible()
  await expect(page.getByText('This replaces all current data.')).toBeVisible()

  // Confirm the (destructive) restore → success status message.
  await page.getByRole('button', { name: 'Restore this backup' }).click()
  await expect(page.getByRole('status')).toHaveText('Restore complete.')
})
