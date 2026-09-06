# Phase 4 — Per-user settings + responsive — Completion record

**Plan:** `docs/superpowers/plans/2026-09-06-phase4-settings-responsive.md`
**Spec:** `docs/superpowers/specs/2026-09-06-phase4-settings-responsive-design.md`
**Branch:** `phase4-settings-responsive` (worktree `.worktrees/phase4-settings-responsive`)
**Method:** Subagent-Driven Development (fresh implementer per task + task review + final whole-branch review)

## Commit sequence

`19b2817` (base/merge-base → main) → `3b66c5a` T1 → `dd4cff5` T2 → `c492376` T3 → `cac90f4` T4 → `153e36a` T5 → `8ded9d6` T5-fix → `d142647` T6 → `e483a9d` T7 → `4d6cf51` T8 → `682f05d` T9 → `4f74db3` T9-fix → `9de5563` T10 → `8984c7` final-fix

## Per-task review verdicts

| Task | Verdict | Blocking | Ruling / note |
|---|---|---|---|
| T1 user_settings + shared schemas | APPROVE | 1 nit | — |
| T2 API settings module | APPROVE | 1 minor + 3 nits | read-then-write safe under better-sqlite3 single-connection sync model |
| T3 Tailwind v4 + tokens | APPROVE | 1 minor + 2 nits | unused `@theme` tokens tree-shaken until referenced (expected) |
| T4 ThemeProvider | APPROVE | 1 minor + 2 nits | jsdom ^30 has no `window.matchMedia`; added test-only shim (`matches:false`→light) |
| T5 i18n | APPROVE | 1 minor + 1 nit | **Ruling:** first install resolved `i18next ^26`/`react-i18next ^17`, exceeding Global Constraint; pinned to `^24.2.3`/`^15.7.4` |
| T6 SettingsProvider | APPROVE | 1 minor + 3 nits | **Ruling (deviation):** wiring SettingsProvider into AppProviders broke 3 trpc-mocked tests; added minimal `settings` mount to each — accepted |
| T7 /settings page | APPROVE | 3 nits | **Ruling (plan defect):** brief's static `import { __updateSettings }` failed TS2305; replaced with dynamic `await import(...)` in test body (same as `searchFacets.test.tsx`) |
| T8 Shell layout | APPROVE | 3 nits | a11y/i18n polish deferred to carry-over |
| T9 responsive migration | CHANGES_REQUESTED→fix→RESOLVED | 1 major | **Ruling (plan defect):** brief's verbatim facet-overlay markup left the mobile overlay with no dismiss affordance; fix round 1 raised the toggle above it (`relative z-[60]` + "Close" label). Both implementer deviations (`flex-1 min-w-0`, `bg-surface text-text`) approved |
| T10 e2e settings leg | APPROVE | 2 nits | `data-theme="dark-dracula"` primary assertion held; no fallback needed |
| **Final whole-branch** | CHANGES_REQUESTED→fix→RESOLVED | 1 major | **Ruling (cross-layer defect):** `SettingsProvider` (mounted above router, never unmounts) 401s on logged-out visit and login invalidated nothing → persisted settings didn't apply until reload. Fix refetches settings after login |

## Cross-layer verification (final whole-branch review)

- `ctx.user!.id` on both protected procedures (`settings.get`/`settings.update`).
- Semantic Tailwind color utilities only; no `tailwind.config.js`.
- Field/type coherence across all six layers (db migration → shared → API → web settings/theme/i18n).
- Correct `0002_add_user_settings` migration (snapshot prevId chain).

## Test totals (head after final fix, `8984c7`)

- `@homebox/web`: 11 files / 20 unit tests pass; `tsc --noEmit` + `vite build` pass.
- `@homebox/api`: 13 files / 50 tests pass.
- `@homebox/db`: 2; `@homebox/shared`: 9.
- e2e (`@homebox/web test:e2e`): 4 passed incl. the new `settings persist across reload and drive locale formatting` leg.

## Carried non-issues (accepted, not blocking)

- Login/setup page labels and the Shell drawer `aria-label` are plain-English strings (i18n of a11y copy deferred).
- No e2e exercises the same-session SPA login → settings refetch path (existing e2e uses a full `goto`).
