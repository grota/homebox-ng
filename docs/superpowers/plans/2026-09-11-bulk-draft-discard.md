# Bulk Draft Discard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Discard selected" action beside "Publish selected" on the drafts page, backed by a `drafts.discardAll` procedure that cannot be half-applied by a stale id.

**Architecture:** A new `discardAll` service function mirrors the existing `publishAll` — same optional id list, same "omitted ids means all drafts" fallback — and loops the existing `discardDraft`, which already deletes the item row (children go by FK cascade, FTS is reindexed) and best-effort unlinks the image files. The one piece of real logic is tolerance: `discardDraft` is not transactional and `deleteItem` *throws* `NOT_FOUND` for a row that is already gone, so a loop that lets that throw escape leaves the batch half-applied — some drafts deleted, the rest untouched, no rollback. `discardAll` skips a row that no longer exists. The page gets one button on the existing toolbar acting on the existing `selected` set, styled `variant="danger"`, confirming through `window.confirm`, and clearing the selection on success — the second layer of the same defence, since `selected` is never pruned when the list refetches.

**Tech Stack:** tRPC v11 + Zod, Drizzle ORM on better-sqlite3, Vitest 4 (API); React 19, `@trpc/react-query`, i18next, Vitest 4 + Testing Library (jsdom), Playwright (web).

**Spec:** `docs/superpowers/specs/2026-09-11-photo-viewer-and-bulk-discard-design.md` — section "1. Bulk discard" and the "Facts" bullets it rests on.
**Decision record:** none. Bulk discard takes no new architectural decision; ADR-0002 covers the photo viewer's `Modal`, a separate feature.

## Global Constraints

- **No existing test assertion may be edited or weakened.** The API suite's two `drafts lifecycle` cases and the web suite's two `drafts page` cases are the acceptance criteria for this work, and they must pass exactly as written. Test *stubs* may be extended where the production code grows a new call (the tRPC mock in `apps/web/test/drafts.test.tsx` is a closed object shape) — but not one `expect(...)` changes.
- **Adding tests is expected.** New cases are appended, never merged into or subtracted from existing ones.
- **No new runtime dependency.** `window.confirm` and the existing UI primitives cover this feature; nothing is added to any `package.json`.
- **The drafts page's existing per-row behaviour is unchanged.** Per-row `Publish` and `Discard` keep their current immediate, unconfirmed `onClick`. No confirmation is added anywhere else, and no confirmation primitive is introduced.
- **`apps/web` typechecks against the BUILT `@homebox/api` output**, not its sources: `apps/web/src/api/trpc.ts` imports `AppRouter` from `@homebox/api`, whose `exports["."].types` is `./dist/server.d.ts`. A new procedure is therefore invisible to `tsc` in `apps/web` until `pnpm --filter @homebox/api build` has run. That build is also what proves `discardAll` is registered on the router.
- **Every command runs from the repo root.**
- **No transaction and no change to `discardDraft`.** `drafts.discard` (single row) keeps throwing `NOT_FOUND` for an unknown id. Only the bulk loop becomes tolerant.

## File Structure

**Create:** nothing. Every change lands in an existing file.

**Modify:**
- `apps/api/src/modules/drafts/service.ts` — add `discardAll` (Task 1), add its stale-id guard (Task 2)
- `apps/api/src/modules/drafts/router.ts` — add the `discardAll` procedure, rename the shared input schema (Task 1)
- `apps/api/test/drafts.test.ts` — a draft factory, plus 3 new cases (Tasks 1-2)
- `apps/web/public/locales/en/translation.json` — two `drafts.*` keys (Task 3)
- `apps/web/test/drafts.test.tsx` — extend the tRPC and i18n stubs, add 4 cases (Task 3)
- `apps/web/src/features/drafts/DraftsPage.tsx` — the mutation and the button (Task 3)

---

### Task 1: `discardAll` in the drafts service and router

**Files:**
- Modify: `apps/api/src/modules/drafts/service.ts:19-22` (after `publishAll`)
- Modify: `apps/api/src/modules/drafts/router.ts:7,13`
- Test: `apps/api/test/drafts.test.ts`

**Interfaces:**
- Consumes: `discardDraft(db, id, dataDir)` and `itemsRepo.listDraftItems(db)` — both already imported in `service.ts`.
- Produces: `discardAll(db: DrizzleDb, ids: number[] | undefined, dataDir: string): void`; the tRPC procedure `drafts.discardAll` with input `{ ids?: number[] }`, consumed by Task 3's `DraftsPage`.

Do **not** add the stale-id guard in this task. Task 2 adds it test-first, which is what pins the tolerance requirement.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/drafts.test.ts`, extend three existing import lines and add one helper, then append two cases inside `describe('drafts lifecycle', ...)`.

The imports become:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { listDrafts, renameDraft, publishDraft, publishAll, discardDraft, discardAll } from '../src/modules/drafts/service'
import { createItemsFromImage } from '../src/modules/unpack/service'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getImagesForItem } from '../src/modules/images/repo'
import sharp from 'sharp'
```

Immediately after the `setup` function, add:

```ts
// One draft per call: the fake provider reports exactly one detected box.
const makeDraft = async (ctx: ReturnType<typeof setup>, fileName: string): Promise<number> => {
  const path = join(ctx.dataDir, fileName)
  writeFileSync(path, png)
  const { drafts } = await createItemsFromImage({ ...ctx, userId: 1, provider: fakeProvider }, { path, itemTypeId: 1 })
  return drafts[0].id
}
```

Append these two cases at the end of the `describe('drafts lifecycle', ...)` block:

```ts
  it('discardAll discards exactly the named drafts and their files', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    const c = await makeDraft(ctx, 'c.png')
    const gone = getImagesForItem(db, a)[0]

    discardAll(db, [a, b], dataDir)

    expect(listDrafts(db).map((d) => d.id)).toEqual([c])
    // `discardDraft` fires its `unlink`s without awaiting them, so a file leaves
    // the disk a tick after its row leaves the table — poll rather than race it.
    await vi.waitFor(() => expect(existsSync(join(dataDir, gone.originalPath))).toBe(false))
    expect(existsSync(join(dataDir, getImagesForItem(db, c)[0].originalPath))).toBe(true)
  })

  it('discardAll with no ids discards every draft', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    await makeDraft(ctx, 'a.png')
    await makeDraft(ctx, 'b.png')

    discardAll(db, undefined, dataDir)

    expect(listDrafts(db)).toHaveLength(0)
  })
```

The survivor assertion is what makes the first test "exactly": dropping `c`'s file would be an over-delete the row count alone would not catch.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/api test drafts
```

Expected: FAIL — both new cases error with `TypeError: discardAll is not a function`; `service.ts` does not export it yet. The two pre-existing cases still pass.

- [ ] **Step 3: Add `discardAll` to the service**

In `apps/api/src/modules/drafts/service.ts`, directly after `publishAll`:

```ts
// Bulk discard, mirroring `publishAll`: an omitted or empty `ids` means every
// draft. A loop of independent single-row deletes, each of which commits on its
// own — there is no transaction around them.
export const discardAll = (db: DrizzleDb, ids: number[] | undefined, dataDir: string): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listDraftItems(db).map((r) => r.id)
  for (const id of targets) discardDraft(db, id, dataDir)
}
```

- [ ] **Step 4: Register the procedure**

In `apps/api/src/modules/drafts/router.ts`, rename the input schema (it now serves two procedures) and add the mutation. The file becomes:

```ts
import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({ id: z.number().int().positive(), name: z.string().min(1) })
const idsInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

export const draftsRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => service.listDrafts(ctx.db)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.renameDraft(ctx.db, input.id, input.name)),
  publish: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.publishDraft(ctx.db, input.id)),
  publishAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.publishAll(ctx.db, input.ids)),
  discard: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.discardDraft(ctx.db, input.id, ctx.dataDir)),
  discardAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.discardAll(ctx.db, input.ids, ctx.dataDir)),
})
```

`idsInput` is the old `publishAllInput`, renamed because two procedures now share it; the `publishAll` line is otherwise untouched.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/api test drafts
```

Expected: PASS — `Tests 4 passed`, and `Test Files 1 passed`. The two pre-existing cases are unmodified.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/drafts/service.ts apps/api/src/modules/drafts/router.ts apps/api/test/drafts.test.ts
git commit -m "feat(api): add drafts.discardAll bulk discard"
```

---

### Task 2: A stale id must not abort the batch

`discardDraft` calls `itemsService.deleteItem`, which throws `TRPCError NOT_FOUND` for a row that is already gone — so `discardDraft`'s own `if (!deleted.ok) return false` guard is unreachable, and the loop in Task 1 propagates that throw. Because `discardDraft` is not transactional, one stale id therefore deletes the drafts before it, throws, and leaves the rest untouched with no rollback: a half-applied bulk delete. The API must not be breakable by a stale id, whatever the client sends.

**Files:**
- Modify: `apps/api/src/modules/drafts/service.ts:24-34` (`discardAll`)
- Test: `apps/api/test/drafts.test.ts`

**Interfaces:**
- Consumes: `discardAll(db, ids, dataDir)` from Task 1, `discardDraft(db, id, dataDir)`, `itemsRepo.getItem(db, id)`.
- Produces: no signature change — `discardAll` keeps its shape and only its failure behaviour changes.

- [ ] **Step 1: Write the failing test**

Append this case at the end of the `describe('drafts lifecycle', ...)` block in `apps/api/test/drafts.test.ts`:

```ts
  it('discardAll skips an id that no longer exists instead of aborting the batch', async () => {
    const ctx = setup()
    const { db, dataDir } = ctx
    const a = await makeDraft(ctx, 'a.png')
    const b = await makeDraft(ctx, 'b.png')
    discardDraft(db, a, dataDir) // `a` is already gone when the batch runs

    discardAll(db, [a, b], dataDir)

    expect(listDrafts(db)).toHaveLength(0)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/api test drafts
```

Expected: FAIL — `TRPCError: NOT_FOUND` is thrown out of `discardAll` at the first id, so the assertion on the next line never runs and `b` survives. This is the half-applied failure the plan exists to prevent.

- [ ] **Step 3: Skip a row that is already gone**

Replace `discardAll` in `apps/api/src/modules/drafts/service.ts` with:

```ts
// Bulk discard, mirroring `publishAll`: an omitted or empty `ids` means every
// draft.
//
// The batch is a loop of independent single-row deletes with no surrounding
// transaction, and `deleteItem` THROWS `NOT_FOUND` for a row that is already
// gone (which is why `discardDraft`'s `if (!deleted.ok)` branch never runs).
// Letting that throw escape would leave the batch half-applied: the drafts
// before it deleted, the ones after it untouched, no rollback. A row that no
// longer exists is already the outcome this loop wanted for it, so skip it.
// `better-sqlite3` is synchronous, so nothing can delete the row between this
// check and `deleteItem`'s own existence check.
export const discardAll = (db: DrizzleDb, ids: number[] | undefined, dataDir: string): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listDraftItems(db).map((r) => r.id)
  for (const id of targets) {
    if (!itemsRepo.getItem(db, id)) continue
    discardDraft(db, id, dataDir)
  }
}
```

`discardDraft` itself is deliberately unchanged: the single-row `drafts.discard` procedure keeps its `NOT_FOUND` response for an unknown id, and that is existing behaviour this feature does not touch. `itemsRepo` is already imported in this file (used by `publishAll`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/api test drafts
```

Expected: PASS — `Tests 5 passed`.

- [ ] **Step 5: Run the whole API suite**

```bash
pnpm --filter @homebox/api test
```

Expected: PASS — `Tests 105 passed` (102 before this plan), `Test Files 26 passed`, no assertion edited.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/drafts/service.ts apps/api/test/drafts.test.ts
git commit -m "fix(api): skip a stale id in drafts.discardAll instead of aborting the batch"
```

---

### Task 3: "Discard selected" on the drafts page

**Files:**
- Modify: `apps/web/public/locales/en/translation.json:11-22`
- Modify: `apps/web/test/drafts.test.tsx`
- Modify: `apps/web/src/features/drafts/DraftsPage.tsx:15-17,40-42`

**Interfaces:**
- Consumes: `trpc.drafts.discardAll` (Task 1), `Button` from `../../ui` (`variant?: 'danger'` already exists).
- Produces: no new interfaces. Purely a page change.

- [ ] **Step 1: Add the i18n keys**

In `apps/web/public/locales/en/translation.json`, insert two keys into the `drafts` block after `"publishSelected"`:

```json
    "publishSelected": "Publish selected",
    "discardSelected": "Discard selected",
    "discardSelectedConfirm": "Discard {{count}} draft(s) and their photos?",
```

`en` is the only locale directory under `apps/web/public/locales/`, so there is no second file to update. The double braces are i18next's default interpolation syntax and are required for the count to reach the message: the neighbouring `drafts.unpacked` key uses single braces, but it is called from nowhere in `apps/web/src`, so that form has never actually interpolated. `draft(s)` mirrors `unpacked`'s `item(s)` and avoids a plural-rules key for a one-line confirmation.

- [ ] **Step 2: Extend the test stubs**

In `apps/web/test/drafts.test.tsx`, add the locale import next to the existing imports and the mutation spy above the `vi.mock` calls:

```tsx
import en from '../public/locales/en/translation.json'
```

```tsx
// The bulk-discard action's `mutateAsync`, exposed so a case can assert what the
// button sends. Reaching it from a test is the same deferred-reference pattern as
// `draftData` below: the factory closes over it and only reads it at render.
const discardAllMutate = vi.fn()

// A minimal draft row. `DraftsPage` reads only `id`, `name` and `images`.
const draft = (id: number, name: string) => ({
  id,
  name,
  images: [{ id: id * 10, originalPath: 'uploads/originals/a.png', editedPath: null, thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true }],
})
```

Replace the `react-i18next` mock so the one message a test needs to read resolves to its real English string:

```tsx
vi.mock('react-i18next', () => ({
  // Everything still returns its key — that is what the existing assertions
  // expect. The confirmation is the exception: it is the only observable string
  // that carries a value, so it is interpolated from the real locale file.
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      k === 'drafts.discardSelectedConfirm' ? en.drafts.discardSelectedConfirm.replace('{{count}}', String(opts?.count)) : k,
  }),
}))
```

Add the mutation to the tRPC stub, next to the existing `discard` entry:

```tsx
        discardAll: {
          // `onSuccess` is wired through to the test rather than dropped: the page
          // clears its selection there, and a stub that swallowed the callback
          // would make that behaviour unassertable.
          useMutation: (options?: { onSuccess?: () => void }) => ({
            ...idleMutation,
            mutateAsync: (input: unknown) => {
              discardAllMutate(input)
              options?.onSuccess?.()
            },
          }),
        },
```

**Both existing cases must pass untouched after this step** — the mock object is a closed shape, so without the `discardAll` entry they would crash with `Cannot read properties of undefined (reading 'useMutation')` once `DraftsPage` calls it. Extending the stub is what keeps their assertions unmodified; it is not a licence to change them.

- [ ] **Step 3: Write the failing tests**

Also add `fireEvent` to the existing `@testing-library/react` import:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
```

Append these four cases to `describe('drafts page', ...)`:

```tsx
  it('offers a danger-styled "Discard selected" beside "Publish selected", disabled at zero selected', () => {
    draftData = [draft(1, 'Draft Lamp')]
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass('text-danger')
  })

  it('confirms with the number of drafts before discarding, then sends the selected ids', () => {
    draftData = [draft(1, 'Draft Lamp'), draft(2, 'Draft Cup')]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    fireEvent.click(screen.getByRole('button', { name: 'drafts.discardSelected' }))
    expect(confirmSpy).toHaveBeenCalledWith('Discard 2 draft(s) and their photos?')
    expect(discardAllMutate).toHaveBeenCalledWith({ ids: [1, 2] })
  })

  it('discards nothing when the confirmation is declined', () => {
    draftData = [draft(1, 'Draft Lamp')]
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    fireEvent.click(btn)
    expect(discardAllMutate).not.toHaveBeenCalled()
    expect(btn).toBeEnabled()
  })

  it('clears the selection once the discard succeeds', () => {
    draftData = [draft(1, 'Draft Lamp')]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <MemoryRouter>
        <DraftsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'drafts.selectAll' }))
    const btn = screen.getByRole('button', { name: 'drafts.discardSelected' })
    fireEvent.click(btn)
    expect(discardAllMutate).toHaveBeenCalledWith({ ids: [1] })
    expect(btn).toBeDisabled()
  })
```

Selecting through the select-all checkbox keeps the cases off DOM position: the row checkboxes carry no accessible name of their own, and `getByRole('checkbox', { name: 'drafts.selectAll' })` is the only named one on the page.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/web test drafts
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "drafts.discardSelected"`. The two pre-existing cases pass, which is what confirms the stub extension was correct.

- [ ] **Step 5: Add the mutation and the button**

In `apps/web/src/features/drafts/DraftsPage.tsx`, add the mutation directly after the `selected` state (it clears that state, so it must be declared below it):

```tsx
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const discardAll = trpc.drafts.discardAll.useMutation({
    onSuccess: () => {
      // `selected` is never pruned when the list refetches, so a discarded id
      // survives in the set and would be sent again by the next bulk action.
      // Clearing here is the first of the two layers that keep a bulk discard
      // from being half-applied; `discardAll`'s tolerance is the second.
      setSelected(new Set())
      void utils.drafts.list.invalidate()
    },
  })
```

Then add the button to the existing toolbar, immediately after the `publishSelected` button:

```tsx
        <Button
          variant="danger"
          disabled={selected.size === 0}
          onClick={() => {
            if (window.confirm(t('drafts.discardSelectedConfirm', { count: selected.size }))) void discardAll.mutateAsync({ ids: [...selected] })
          }}
        >
          {t('drafts.discardSelected')}
        </Button>
```

Leave the per-row buttons on lines 57-58 exactly as they are. Per-row `Discard` stays immediate and unconfirmed: the drafts page is treated as a power tool, and that is a decision of record in the spec, not an oversight. Do not add a confirmation to it or to anything else while you are in this file.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/web test drafts
```

Expected: PASS — `Tests 6 passed` in `test/drafts.test.tsx`.

- [ ] **Step 7: Build the API and typecheck the workspace**

```bash
pnpm --filter @homebox/api build && pnpm -r typecheck
```

Expected: build succeeds and typecheck is clean. The build is not optional here: `apps/web` resolves `AppRouter` from `apps/api/dist/server.d.ts`, so `trpc.drafts.discardAll` does not exist for `tsc` until it has run, and that typecheck is also the proof that the procedure is registered on the router.

- [ ] **Step 8: Run every unit suite**

```bash
pnpm test
```

Expected: PASS — `Tests 105 passed` (api) and `Tests 83 passed` (web, 79 before this plan), plus the `packages/db` and `packages/shared` suites, with no existing assertion edited.

- [ ] **Step 9: Check the e2e suite still passes**

```bash
pnpm --filter @homebox/web test:e2e
```

Expected: PASS. The drafts toolbar is exercised end-to-end by `e2e/unpack.spec.ts` (it selects all and clicks "Publish selected" by accessible name), which is the regression this change could plausibly break. The suite runs on port 3100 and starts its own server, so **nothing needs to be stopped first**. No e2e case is added for bulk discard — the confirm-and-send path is covered by the unit cases above, and a dialog-handling spec is scope the design did not ask for.

- [ ] **Step 10: Commit**

```bash
git add apps/web/public/locales/en/translation.json apps/web/src/features/drafts/DraftsPage.tsx apps/web/test/drafts.test.tsx
git commit -m "feat(web): add Discard selected bulk action to the drafts page"
```

---

## Not in this plan

- **Per-row discard keeps its immediate, unconfirmed behaviour.** It is the page's existing power-tool shape, and the spec keeps it deliberately. No confirmation is added to any other action either.
- **`publishAll`'s selection is not cleared.** Its loop silently no-ops on a row that is gone, so a stale id in its selection is benign (a spec "Facts" bullet says so explicitly); clearing it would be a change to existing behaviour with nothing to fix.
- **No new e2e spec.** The bulk path is covered by API and web unit cases; `unpack.spec.ts` is run as a regression gate, not extended.
- **No transaction around the batch, and no change to `discardDraft` or `drafts.discard`.** Tolerance lives in the bulk loop only.
- **A bulk discard cannot be undone.** The confirmation names the count and nothing else; no undo, no soft delete.
