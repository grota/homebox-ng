// The e2e stack runs the BUILT app: one Fastify process serving both `/trpc` and
// the SPA, on a fresh temporary database per run (see `webServer` in
// playwright.config.ts). It deliberately does NOT use port 3000.
//
// 3000 is the API's own default (`apps/api/src/env.ts`) and the Vite dev proxy's
// target (`apps/web/vite.config.ts`), so sharing it meant the suite could not run
// while a dev server was up — every run required stopping one first. The two
// stacks share no state (the e2e server mints its own DB and uploads dir), so the
// port was the only thing forcing them apart.
//
// This module is the single source for that port: both the config and the specs
// import it, so there is no second place to update. Override with `E2E_PORT` if
// 3100 is ever occupied.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100)
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
