# homebox-ng

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `grota/homebox-ng`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles use the canonical vocabulary as-is (e.g. `needs-triage`, `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Running a branch that lives in a worktree

A branch in a `git worktree` is not in the main checkout, so running the stack there shows `main`
until it is merged. How to run a worktree's stack, and which ports to use, is in the README — see
*"Or: a branch that lives in a git worktree"*.

One trap whose **symptom** points away from its cause, so it is worth knowing before you spend a
cycle on it: in a fresh worktree, `tsc` in `apps/web` emits errors that look completely real —
`Property 'useUtils' does not exist on type "The property 'useContext' in your router collides
with a built-in method…"`, plus implicit-`any` complaints in files you never touched. They are not
real. The web's tRPC types resolve through `@homebox/api`'s built `dist/`, which a fresh worktree
does not have. `pnpm --filter @homebox/api build` and every one of them disappears. Do not debug
them, and do not "fix" the files they name.

## Planning a cross-cutting change

When a plan changes a pattern across the codebase, every file containing an instance of
that pattern must appear in some task's file list — and the verification step must be able
to find instances that carry **none** of the old pattern (a control with no classes at all
defeats a grep for old class strings). Before dispatching, enumerate the files by searching
for the *thing* being converted, not for the strings being removed.
