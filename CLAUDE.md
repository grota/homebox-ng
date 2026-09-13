# homebox-ng

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `grota/homebox-ng`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles use the canonical vocabulary as-is (e.g. `needs-triage`, `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Testing a worktree

Work on a branch that lives in a `git worktree` is **not** in the main checkout, and testing it
from there shows the main checkout's code. Run the stack from the worktree's own directory:

```sh
cd .claude/worktrees/<name>
PORT=3200 WEB_PORT=5273 pnpm dev     # then browse :5273
```

**Which ports.** The main checkout's stack already holds `3000` (API) and `5173` (Vite), so a
worktree must use others. `pnpm dev` takes `PORT` and `WEB_PORT`, and Vite's proxy follows `PORT`
— so the API and the SPA stay pointed at each other on whatever pair you pick.

Pick two free ports and **avoid `3100`**: that is the Playwright suite's default `E2E_PORT`, so
putting the dev API there means `pnpm test:e2e` cannot run without stopping your stack first.
`3200` (API) and `5273` (Vite) are free of every default here; run the e2e alongside with
`E2E_PORT=3300`. Check before starting with `ss -ltnpH 'sport = :3200'` — no output means free.
`scripts/dev.sh` refuses to start on an occupied port before it does the slow build, and names
the pid holding it, so a wrong guess costs seconds rather than a half-dead stack.

**`pnpm build` is not needed for `pnpm dev`.** `dev.sh` runs `turbo run build
--filter=@homebox/api...` itself (the API and its workspace dependencies), seeds, and starts —
the SPA is served from source by Vite, so nothing has to be pre-built. Root `pnpm build` builds
every package *including* the web bundle, which you need only for the **built** stack: the
`pnpm --filter @homebox/api start` mode the e2e suite uses, where one Fastify process serves
`/trpc` and the compiled SPA on one port. Plain `pnpm build` starts nothing by itself.

**First time only in a fresh worktree:** `pnpm install --ignore-scripts` (a plain install aborts
— `sharp`'s build script fails on Node 26), then build the workspace packages before anything
can typecheck: `pnpm --filter @homebox/shared build && pnpm --filter @homebox/db build`.
Skipping that makes every API test fail to collect, *and* makes `tsc` in `apps/web` emit phantom
errors that look real (`Property 'useUtils' does not exist on type "…collides with a built-in
method…"`) — the web's tRPC types resolve through `@homebox/api`'s `dist/`, which does not exist
yet. Build `@homebox/api` and they all vanish; do not debug them.

**A worktree has its own `data/`** (gitignored), so its stack seeds its own database and uploads.
Trashing items, unpacking photos and the rest cannot touch the real inventory.

## Planning a cross-cutting change

When a plan changes a pattern across the codebase, every file containing an instance of
that pattern must appear in some task's file list — and the verification step must be able
to find instances that carry **none** of the old pattern (a control with no classes at all
defeats a grep for old class strings). Before dispatching, enumerate the files by searching
for the *thing* being converted, not for the strings being removed.
