# Non-destructive item-type field editing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editing an item type's custom fields non-destructive by default, so that adding, renaming, reordering and toggling `required` on a field never destroys stored values, and the one destructive operation (deleting a field, or retyping one whose values no longer fit) is explicit, enumerated and acknowledged.

**Architecture:** `itemTypes.update` stops treating `fields` as a replaceable blob. A new `itemTypes.updateFields` applies an **explicit diff** — upserts carrying an `id` update in place (same row id, so the cascading FK from `item_custom_field_values.field_id` never fires), upserts without an `id` insert, and `deletedIds` delete. Only `fieldType` changes are gated: allowed while every non-empty value fits the new type, otherwise refused with the offending items enumerated. A shared `fitsFieldType` predicate mirrors **the browser's** constraints, because those are what actually break the item form. Destruction requires an explicit acknowledgment flag plus a count pin that the server re-validates inside the transaction.

**Tech Stack:** TypeScript, pnpm/Turbo monorepo, Fastify + tRPC v11, Drizzle ORM + better-sqlite3 (SQLite), Zod, React 19 + React Query via tRPC hooks, Vitest (+ Testing Library for web), drizzle-kit for migrations.

**Spec:** `docs/superpowers/specs/2026-09-12-item-type-field-editing-design.md` (decision record: `docs/adr/0003-non-destructive-field-edits.md`)

## Global Constraints

- **Worktree:** work in the existing worktree on branch `feat/item-type-field-editing` (`.claude/worktrees/crud-locations-types-tags`). It is stacked on `feat/manage-locations-types-tags` deliberately — do not rebase.
- **Workspace packages must be built before typechecking or testing** in a fresh worktree: `pnpm --filter @homebox/shared build` then `pnpm --filter @homebox/db build`. In a fresh worktree the install is `pnpm install --ignore-scripts` (a plain `pnpm install` dies on `sharp@0.34.5`).
- **The emptiness predicate is `value IS NOT NULL AND value <> ''`.** Never "a row exists", never "value is not null" — a blank field still writes a row with `''`. Not a truthiness test either: `'0'` in a number field is real data. Do not trim before the emptiness test.
- **Field type values are exactly** `'text' | 'number' | 'currency' | 'date' | 'boolean' | 'url'`.
- **The predicate must match the browser, and err strict.** The item form renders `type="url"` for `url` (a bad value blocks submit entirely), `type="number"` for `number`/`currency`, `type="date"` for `date`, and `text` for `text`/`boolean` (`apps/web/src/features/items/ItemForm.tsx:232`).
- **Omission never means deletion.** A field is only removed when its id appears in `deletedIds`.
- **`required` is never enforced server-side.** Enforcing it would make unpack-created drafts unsaveable — `unpack/service.ts` calls `repo.createItem` directly with `fieldValues: []` and `published: false`.
- **Error code semantics:** `PRECONDITION_FAILED` = a required acknowledgment is missing; `CONFLICT` = the acknowledged count no longer matches; `BAD_REQUEST` = an id does not belong to the type. Messages are user-facing sentences, because the UI renders them verbatim.
- **Commit style:** `type(scope): imperative summary`, ending with the trailer
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **Commands are run from the repo root** unless a step says otherwise.

---

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `packages/shared/src/fieldValue.ts` | `FIELD_TYPES`, `FieldType`, `fitsFieldType` — the one compatibility predicate |
| `packages/shared/test/fieldValue.test.ts` | Table test for the predicate |
| `apps/api/test/itemTypeFields.test.ts` | API tests for the diff, the gates and `fieldValueUsage` |
| `apps/web/src/features/itemTypes/TypeFields.tsx` | The field-set editor: inline rows, add, save, delete, `required` |
| `apps/web/src/features/itemTypes/IncompatibleValuesDialog.tsx` | The offenders dialog + clear-and-convert |
| `apps/web/test/typeFields.test.tsx` | Tests for the field editor |
| `apps/web/test/incompatibleValuesDialog.test.tsx` | Tests for the dialog |
| `apps/api/scripts/seed.ts` | Dev fixtures |
| `packages/db/drizzle/0005_*.sql` | Generated: the two indexes |

**Modify**

| Path | Change |
|---|---|
| `packages/shared/src/index.ts` | Export `./fieldValue.js` |
| `packages/db/src/schema.ts` | Declare the two indexes on `itemCustomFieldValues` |
| `packages/db/test/migrate.test.ts` | Assert both indexes exist |
| `apps/api/src/modules/itemTypes/repo.ts` | Add `applyFieldOps`, `getField`, `listNonEmptyValues`, `clearValue`, `countPublishedItemsOfType`; delete `replaceTypeFields` (Task 4) |
| `apps/api/src/modules/itemTypes/service.ts` | Add `updateFields`, `fieldValueUsage`; `updateItemType` loses `fields` (Task 4) |
| `apps/api/src/modules/itemTypes/router.ts` | Add `updateFields`/`fieldValueUsage` inputs; `update` loses `fields`; derive the field-type enum from `FIELD_TYPES` |
| `apps/api/package.json` | Add the `seed` script |
| `apps/web/src/features/itemTypes/ItemTypesPage.tsx` | Split: type form + list, delegating fields to `TypeFields`; drop the obsolete `signature` guard |
| `apps/web/test/itemTypes.test.tsx` | Follow the restructure |

**Boundary — deliberately NOT touched.** `itemCustomFieldValues` is read/written in
`apps/api/src/modules/items/{repo,router}.ts` and `apps/api/src/modules/items/fts.ts`.
`updateItem` still replaces an item's values wholesale, and no guard yet checks that a value's
`fieldId` belongs to the item's type. Both are recorded as out of scope in the spec; do not
"fix" them in passing.

### Pattern-change enumeration (per `CLAUDE.md`)

`replaceTypeFields` is replaced by `applyFieldOps`. Its callers, found by searching for the
**thing** rather than for the strings being removed:

- `apps/api/src/modules/itemTypes/repo.ts:80` — the definition (deleted in Task 4).
- `apps/api/src/modules/itemTypes/service.ts:92` — the **only** caller (rewritten in Task 4).
- `apps/web/src/features/itemTypes/ItemTypesPage.tsx` — the only client that sends `fields` to
  `update` (rewritten in Task 4).

Verification for this is Task 4's final step: `grep -rn "replaceTypeFields" apps packages
--include='*.ts' --include='*.tsx'` must return nothing outside `dist/`.

---

## Task 1: The shared compatibility predicate

**Files:**
- Create: `packages/shared/src/fieldValue.ts`
- Create: `packages/shared/test/fieldValue.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/modules/itemTypes/router.ts` (use `FIELD_TYPES` for the zod enum)
- Modify: `apps/web/src/features/itemTypes/ItemTypesPage.tsx` (import `FIELD_TYPES`, drop the local copy)

**Interfaces:**
- Produces:
  - `FIELD_TYPES: readonly ['text', 'number', 'currency', 'date', 'boolean', 'url']`
  - `type FieldType = (typeof FIELD_TYPES)[number]`
  - `fitsFieldType(fieldType: FieldType, value: string): boolean`

Consumed by: Task 3 (the gate and the `fieldValueUsage` filter), Task 4 (the row's type select
and the `required` toggle), Task 5 (the retype warning and the dialog).

There is deliberately **no** JS "is this value empty" helper: the emptiness predicate lives in
SQL (`item_*` queries), which is the only place it is needed, and the design's constraint is
that it reads `IS NOT NULL AND <> ''`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/fieldValue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FIELD_TYPES, fitsFieldType } from '../src/fieldValue'

describe('fitsFieldType', () => {
  // text accepts anything, including an empty string: the emptiness rule is
  // about whether a value counts as *data*, not about fitting a type.
  it('accepts anything for text', () => {
    for (const v of ['', 'large', '120 cm', 'not a url']) expect(fitsFieldType('text', v)).toBe(true)
  })

  it('accepts only real numbers for number and currency', () => {
    for (const v of ['1', '-2.5', '1e3', '.5', '120.00', ' 7 ']) {
      expect(fitsFieldType('number', v)).toBe(true)
      expect(fitsFieldType('currency', v)).toBe(true)
    }
    // '' is not a number (Number('') is 0), and these are the cases where
    // Number() is more permissive than the browser's valid floating-point number.
    for (const v of ['', '   ', 'large', '120 cm', '1,000', '0x10', 'Infinity', 'NaN']) {
      expect(fitsFieldType('number', v)).toBe(false)
      expect(fitsFieldType('currency', v)).toBe(false)
    }
  })

  it('requires an HTML date the browser will keep', () => {
    expect(fitsFieldType('date', '2026-09-12')).toBe(true)
    // <input type="date"> only holds YYYY-MM-DD, and only a real calendar date.
    for (const v of ['', '12/09/2026', '2026-9-1', '2026-13-01', '2026-02-30', 'large']) {
      expect(fitsFieldType('date', v)).toBe(false)
    }
  })

  it('accepts only the four boolean spellings, case-insensitively', () => {
    for (const v of ['true', 'false', '0', '1', 'TRUE', ' False ']) expect(fitsFieldType('boolean', v)).toBe(true)
    for (const v of ['', 'yes', 'no', '2', 'large']) expect(fitsFieldType('boolean', v)).toBe(false)
  })

  it('requires an absolute URL for url', () => {
    for (const v of ['https://example.com', 'http://a.b/c?d=1', 'mailto:a@b.co']) {
      expect(fitsFieldType('url', v)).toBe(true)
    }
    for (const v of ['', 'example.com', 'not a url', '/relative', 'large']) {
      expect(fitsFieldType('url', v)).toBe(false)
    }
  })

  it('lists exactly the six field types', () => {
    expect([...FIELD_TYPES]).toEqual(['text', 'number', 'currency', 'date', 'boolean', 'url'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @homebox/shared test`
Expected: FAIL — `Cannot find module '../src/fieldValue'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/shared/src/fieldValue.ts`:

```ts
// One definition of "does this stored value make sense as this field type",
// shared by the API's gate and the web's pre-warning so the two cannot drift.
//
// The predicate mirrors what the *browser* accepts, because that is what
// actually breaks: the item form renders `type="url"` for `url` (a value that is
// not a valid absolute URL fails constraint validation and blocks submit
// entirely) and `type="number"`/`type="date"` for the rest, whose value
// sanitization silently BLANKS the display while React state keeps the old
// value. A value that does not fit must never be allowed to survive a type
// change.
//
// It errs strict: `number` uses an explicit floating-point grammar rather than
// `Number()`, which would wrongly accept '0x10' and 'Infinity'.

export const FIELD_TYPES = ['text', 'number', 'currency', 'date', 'boolean', 'url'] as const

export type FieldType = (typeof FIELD_TYPES)[number]

// HTML's "valid floating-point number", which is what a number input holds.
const FLOAT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

// `<input type="date">` holds exactly YYYY-MM-DD, and only a real calendar date
// fits it — the Date constructor rolls '2026-02-30' over into March, so the
// round-trip check is what rejects it.
const isRealDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const BOOLEANS = new Set(['true', 'false', '0', '1'])

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

export const fitsFieldType = (fieldType: FieldType, value: string): boolean => {
  switch (fieldType) {
    case 'text':
      return true
    case 'number':
    case 'currency': {
      const trimmed = value.trim()
      // `trimmed !== ''` matters: Number('') is 0, and Number('  ') too.
      return trimmed !== '' && FLOAT.test(trimmed)
    }
    case 'date':
      return isRealDate(value)
    case 'boolean':
      return BOOLEANS.has(value.trim().toLowerCase())
    case 'url':
      return isAbsoluteUrl(value)
  }
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts`, add the line (keeping the existing exports):

```ts
export * from './fieldValue.js'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @homebox/shared test`
Expected: PASS, 6 new tests (plus the package's pre-existing ones).

- [ ] **Step 6: Point the two existing field-type lists at the shared one**

`apps/api/src/modules/itemTypes/router.ts` — replace the literal enum with:

```ts
import { FIELD_TYPES } from '@homebox/shared'
// ...
  fieldType: z.enum(FIELD_TYPES),
```

`apps/web/src/features/itemTypes/ItemTypesPage.tsx` — delete the local
`const FIELD_TYPES = [...] as const` and the local field-type union, importing instead:

```ts
import { FIELD_TYPES } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
```

Use `FieldType` for `DraftField['fieldType']` and `fieldType: FieldType` wherever the local
union was used. `FIELD_TYPES` still drives the `<option>` list.

- [ ] **Step 7: Build and verify nothing regressed**

Run: `pnpm --filter @homebox/shared build && pnpm --filter @homebox/api build && pnpm --filter @homebox/web exec tsc --noEmit`
Expected: all succeed, no output.

Run: `pnpm --filter @homebox/api test && pnpm --filter @homebox/web test`
Expected: all pass — this step changes no behaviour.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/fieldValue.ts packages/shared/test/fieldValue.test.ts packages/shared/src/index.ts apps/api/src/modules/itemTypes/router.ts apps/web/src/features/itemTypes/ItemTypesPage.tsx
git commit -m "feat(shared): one browser-matching predicate for field values

The API's type gate and the web's warning must agree about what a stored
value can hold, so the predicate lives where both can import it. It mirrors
the browser's constraints rather than Number()/Date parsing, because those
constraints are what actually break the item form: type=\"url\" blocks submit
outright, type=\"number\"/\"date\" blank the display silently.

FIELD_TYPES moves here too — it was duplicated between the API's zod enum and
the web page's option list."
```

---

## Task 2: Index the value table

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0005_*.sql` (generated — do not hand-write)
- Create: `packages/db/drizzle/meta/0005_snapshot.json` (generated)
- Modify: `packages/db/drizzle/meta/_journal.json` (generated)
- Modify: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Produces: nothing importable. The indexes are read by Task 3's usage queries (performance only, never correctness).

The migrations are drizzle-generated from `schema.ts`; the migrator reads
`drizzle/meta/_journal.json`, so a hand-written `.sql` would never be applied. There are
currently **no** `CREATE INDEX` statements in any migration and SQLite does not index FK
columns, so `WHERE field_id = ?` is a full scan.

- [ ] **Step 1: Write the failing test**

In `packages/db/test/migrate.test.ts`, add to the existing `describe('db schema')` block:

```ts
  it('indexes the custom-field value lookups', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]
    const set = new Set(names.map(n => n.name))
    // `field_id` answers "how many values does this field hold", which gates
    // every destructive field operation; `item_id` answers the per-item read.
    expect(set.has('idx_icfv_field_id')).toBe(true)
    expect(set.has('idx_icfv_item_id')).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @homebox/db test`
Expected: FAIL — both `toBe(true)` assertions fail.

- [ ] **Step 3: Declare the indexes on the table**

In `packages/db/src/schema.ts`, the `itemCustomFieldValues` table is the third argument slot
(the same array-returning form `itemTags` already uses for its `primaryKey`). Add the import
and the extras callback:

```ts
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core'
```

```ts
export const itemCustomFieldValues = sqliteTable(
  'item_custom_field_values',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id').notNull().references(() => items.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id').notNull().references(() => itemTypeFields.id, { onDelete: 'cascade' }),
    value: text('value'),
  },
  (t) => [index('idx_icfv_field_id').on(t.fieldId), index('idx_icfv_item_id').on(t.itemId)]
)
```

- [ ] **Step 4: Generate the migration**

Run from the repo root:

```bash
pnpm --filter @homebox/db exec drizzle-kit generate --name add_custom_field_value_indexes
```

Expected: a new `packages/db/drizzle/0005_*.sql` containing two `CREATE INDEX` statements, a new
`meta/0005_snapshot.json`, and a new entry in `meta/_journal.json`. **Open the generated `.sql`
and confirm it contains only the two `CREATE INDEX` lines** — if it contains a `CREATE TABLE` or
a `DROP`, the schema and the last snapshot had drifted; stop and report before continuing.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @homebox/db build && pnpm --filter @homebox/db test`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the API suite is unaffected**

Run: `pnpm --filter @homebox/api test`
Expected: PASS — the migration is additive.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/test/migrate.test.ts
git commit -m "perf(db): index the custom-field value lookups by field and item

Every destructive field operation counts a field's non-empty values first, and
SQLite does not index FK columns, so that count was a full scan of
item_custom_field_values. The per-item read had the same problem.

Declared in schema.ts and generated, not hand-written: the migrator reads
meta/_journal.json, so a stray .sql would never be applied."
```

---

## Task 3: The explicit diff, the gates, and the usage query

One task, because any subset of it leaves a state that is either lossy or broken: a diff with
no gate lets a retype through and blanks the item form; a gate with no diff destroys values;
and the usage query is what both the gate's refusal message and the web's warning count come
from.

**Files:**
- Create: `apps/api/test/itemTypeFields.test.ts`
- Modify: `apps/api/src/modules/itemTypes/repo.ts`
- Modify: `apps/api/src/modules/itemTypes/service.ts`
- Modify: `apps/api/src/modules/itemTypes/router.ts`

**Interfaces:**
- Consumes: `fitsFieldType`, `isRealDataValue`, `FieldType` from `@homebox/shared` (Task 1).
- Produces (repo):
  - `applyFieldOps(db, typeId: number, upserts: FieldUpsert[], deletedIds: number[]): ItemTypeFieldRow[]` — does **not** open a transaction (the service owns it), mirroring `items/repo.ts`'s `replaceFieldValues`.
  - `getField(db, id: number): ItemTypeFieldRow | undefined`
  - `listNonEmptyValues(db, fieldId: number): { itemId: number; name: string; value: string; published: boolean }[]`
  - `clearValue(db, itemId: number, fieldId: number): void` — deletes the row
  - `countPublishedItemsOfType(db, typeId: number): number`
- Produces (service):
  - `updateFields(db, input: UpdateFieldsInput): ItemTypeDto`
  - `fieldValueUsage(db, input: { typeId: number; fieldId: number; fieldType?: FieldType }): FieldValueUsage`
  - `type FieldValueUsage = { total: number; missing: number; items: { itemId: number; name: string; value: string }[] }`
- Produces (router inputs):

```ts
const FieldUpsertInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
})

const updateFieldsInput = z.object({
  id: z.number().int().positive(),
  upserts: z.array(FieldUpsertInputSchema).default([]),
  deletedIds: z.array(z.number().int().positive()).default([]),
  clearIncompatible: z.boolean().optional(),
  acknowledgeValueLoss: z.boolean().optional(),
  acknowledgedValueCount: z.number().int().nonnegative().optional(),
})

const fieldValueUsageInput = z.object({
  typeId: z.number().int().positive(),
  fieldId: z.number().int().positive(),
  fieldType: z.enum(FIELD_TYPES).optional(),
})
```

Consumed by: Task 4 (the web calls `updateFields` and `fieldValueUsage`), Task 5 (the web
renders `FieldValueUsage['items']` and `total`).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/itemTypeFields.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { items } from '@homebox/db'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
// Kept at module scope: one case inserts an unpublished item directly, because
// the only other way to make a draft is the unpack flow, which needs a provider.
let db: ReturnType<typeof createDb>
let cookie: string

const post = async (path: string, payload: unknown) =>
  (await app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { cookie }, payload })).json()

const data = async (path: string, payload: unknown) => (await post(path, payload))?.result?.data
const code = async (path: string, payload: unknown) => (await post(path, payload))?.error?.data?.code

// `fieldValueUsage` and `itemTypes.list` are QUERIES, so they go over GET with the
// input as a JSON query param — and the param must be omitted entirely when there
// is none, or the server is asked to parse the string "undefined".
const getRaw = async (path: string, input?: unknown) =>
  (await app.inject({
    method: 'GET',
    url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
    headers: { cookie },
  })).json()

const get = async (path: string, input?: unknown) => (await getRaw(path, input))?.result?.data
const getCode = async (path: string, input?: unknown) => (await getRaw(path, input))?.error?.data?.code

// An item type with two fields and one item holding a value for each.
const fixture = async (name: string, values: [string, string] = ['large', 'hello']) => {
  const type = await data('itemTypes.create', {
    name,
    fields: [
      { name: 'size', fieldType: 'text' },
      { name: 'note', fieldType: 'text' },
    ],
  })
  const item = await data('items.create', {
    name: `${name} item`,
    itemTypeId: type.id,
    locationId: null,
    quantity: 1,
    fieldValues: [
      { fieldId: type.fields[0].id, value: values[0] },
      { fieldId: type.fields[1].id, value: values[1] },
    ],
  })
  return { type, item, size: type.fields[0], note: type.fields[1] }
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  cookie = login.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('the field diff is non-destructive', () => {
  // THE REGRESSION. `replaceTypeFields` deleted every field row and re-inserted
  // it, so the cascade from `item_custom_field_values.field_id` took every value
  // with it. A rename must now be an UPDATE of the same row.
  it('keeps stored values when a field is renamed', async () => {
    const { type, item, size } = await fixture('RenameType')
    await data('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size (cm)', fieldType: 'text' }], deletedIds: [] })
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  it('keeps stored values when a field is reordered and required flips', async () => {
    const { type, item, size, note } = await fixture('ReorderType')
    await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [
        { id: note.id, name: 'note', fieldType: 'text', sortOrder: 0 },
        { id: size.id, name: 'size', fieldType: 'text', sortOrder: 1, required: true },
      ],
      deletedIds: [],
    })
    const after = await get('items.get', { id: item.id })
    expect(after.customFields).toHaveLength(2)
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  it('adds a field without touching the existing ones', async () => {
    const { type, item, size } = await fixture('AddType')
    const updated = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ name: 'colour', fieldType: 'text' }],
      deletedIds: [],
    })
    expect(updated.fields).toHaveLength(3)
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
  })

  // An inline "save this row" sends one upsert. It must never mean "delete the rest".
  it('leaves sibling fields alone when one row is saved', async () => {
    const { type, size, note } = await fixture('SiblingType')
    const updated = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'renamed', fieldType: 'text' }],
      deletedIds: [],
    })
    expect(updated.fields.map((f: { id: number }) => f.id).sort()).toEqual([size.id, note.id].sort())
  })

  it('rejects an upsert id and a deletedId from another type', async () => {
    const a = await fixture('ScopeA')
    const b = await fixture('ScopeB')
    expect(await code('itemTypes.updateFields', { id: a.type.id, upserts: [{ id: b.size.id, name: 'x', fieldType: 'text' }], deletedIds: [] })).toBe('BAD_REQUEST')
    expect(await code('itemTypes.updateFields', { id: a.type.id, upserts: [], deletedIds: [b.size.id] })).toBe('BAD_REQUEST')
  })
})

describe('deleting a field is acknowledged', () => {
  it('refuses without the acknowledgment while values exist', async () => {
    const { type, size } = await fixture('DeleteGate')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [size.id] })).toBe('PRECONDITION_FAILED')
    // Nothing was written.
    expect((await get('itemTypes.list')).find((t: { id: number }) => t.id === type.id).fields).toHaveLength(2)
  })

  it('deletes the field and its values once acknowledged', async () => {
    const { type, item, size, note } = await fixture('DeleteOk')
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [size.id], acknowledgeValueLoss: true })
    expect(res.fields.map((f: { id: number }) => f.id)).toEqual([note.id])
    const after = await get('items.get', { id: item.id })
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)).toBeUndefined()
  })

  // A field nothing has a value for is not destructive, so it needs no flag.
  it('deletes a field with no values without an acknowledgment', async () => {
    const { type, note, item } = await fixture('DeleteEmpty', ['large', ''])
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [], deletedIds: [note.id] })
    expect(res.fields).toHaveLength(1)
    expect((await get('items.get', { id: item.id })).customFields).toHaveLength(1)
  })
})

describe('a retype is gated on the values it would strand', () => {
  it('allows a retype when every value fits, with no flag', async () => {
    const { type, size } = await fixture('RetypeClean', ['120', 'hello'])
    const res = await data('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'number' }], deletedIds: [] })
    expect(res.fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('number')
  })

  it('refuses a retype when a value does not fit', async () => {
    const { type, size } = await fixture('RetypeBlocked')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'number' }], deletedIds: [] })).toBe('PRECONDITION_FAILED')
  })

  // The dangerous case the spec calls out: `url` renders a real `type="url"`
  // input, so a surviving non-URL value would block the item form's submit.
  it('refuses a retype to url when a value is not a URL', async () => {
    const { type, size } = await fixture('RetypeUrl')
    expect(await code('itemTypes.updateFields', { id: type.id, upserts: [{ id: size.id, name: 'size', fieldType: 'url' }], deletedIds: [] })).toBe('PRECONDITION_FAILED')
  })

  it('clears the stranded values and retypes when acknowledged', async () => {
    const { type, item, size, note } = await fixture('RetypeClear')
    const res = await data('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'size', fieldType: 'number' }],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 1,
    })
    expect(res.fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('number')
    const after = await get('items.get', { id: item.id })
    // The stranded value is gone; the other field's value is untouched.
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === size.id)).toBeUndefined()
    expect(after.customFields.find((f: { fieldId: number }) => f.fieldId === note.id)?.value).toBe('hello')
  })

  // The count pin: a value that appeared after the modal was opened must not be
  // destroyed unseen.
  it('refuses when the acknowledged count no longer matches, and writes nothing', async () => {
    const { type, item, size } = await fixture('RetypeStale', ['large', 'hello'])
    // A second item acquires a value for the same field after the count was taken.
    await data('items.create', { name: 'Stale second', itemTypeId: type.id, locationId: null, quantity: 1, fieldValues: [{ fieldId: size.id, value: 'huge' }] })

    expect(await code('itemTypes.updateFields', {
      id: type.id,
      upserts: [{ id: size.id, name: 'size', fieldType: 'number' }],
      deletedIds: [],
      clearIncompatible: true,
      acknowledgedValueCount: 1,
    })).toBe('CONFLICT')

    // Both values are still there, and the type is unchanged.
    expect((await get('items.get', { id: item.id })).customFields.find((f: { fieldId: number }) => f.fieldId === size.id)?.value).toBe('large')
    const types = await get('itemTypes.list', undefined)
    expect(types.find((t: { id: number }) => t.id === type.id).fields.find((f: { id: number }) => f.id === size.id).fieldType).toBe('text')
  })
})

describe('fieldValueUsage', () => {
  it('counts only non-empty values, and lists the offenders with their values', async () => {
    const { type, size, note } = await fixture('UsageCount', ['large', ''])
    // The blank `note` must not be counted as data, nor offered as an offender.
    const all = await get('fieldValueUsage', { typeId: type.id, fieldId: size.id })
    expect(all.total).toBe(1)
    expect(all.items).toEqual([{ itemId: expect.any(Number), name: 'UsageCount item', value: 'large' }])

    const blank = await get('fieldValueUsage', { typeId: type.id, fieldId: note.id })
    expect(blank.total).toBe(0)
    expect(blank.items).toEqual([])
  })

  it('narrows to values that do not fit the given type', async () => {
    const { type, size } = await fixture('UsageFit', ['120', 'hello'])
    expect((await get('fieldValueUsage', { typeId: type.id, fieldId: size.id, fieldType: 'number' })).total).toBe(0)
  })

  it('reports published items missing a value, excluding drafts', async () => {
    const { type, size } = await fixture('UsageMissing', ['large', 'hello'])
    // A published item of the type that leaves the field blank…
    await data('items.create', { name: 'Blank item', itemTypeId: type.id, locationId: null, quantity: 1, fieldValues: [] })
    // …and a draft. Drafts come from the unpack flow, which needs a detection
    // provider, so it is inserted directly here.
    db.insert(items).values({ name: 'Draft item', description: '', quantity: 1, itemTypeId: type.id, locationId: null, createdBy: 1, published: false }).run()

    const usage = await get('fieldValueUsage', { typeId: type.id, fieldId: size.id })
    expect(usage.total).toBe(1) // only the one item that really holds a value
    expect(usage.missing).toBe(1) // the blank published item — the draft is not counted
  })

  it('rejects a field that does not belong to the type', async () => {
    const a = await fixture('UsageScopeA')
    const b = await fixture('UsageScopeB')
    expect(await getCode('fieldValueUsage', { typeId: a.type.id, fieldId: b.size.id })).toBe('BAD_REQUEST')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @homebox/api exec vitest run test/itemTypeFields.test.ts`
Expected: FAIL — `itemTypes.updateFields` is not a procedure (`NOT_FOUND`/undefined), so every
case fails.

- [ ] **Step 3: Add the repo helpers**

In `apps/api/src/modules/itemTypes/repo.ts`, add the imports and helpers:

```ts
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { itemTypes, itemTypeFields, items, itemCustomFieldValues } from '@homebox/db'
```

```ts
export const getField = (db: DrizzleDb, id: number): ItemTypeFieldRow | undefined =>
  db.select(FIELD_FIELDS).from(itemTypeFields).where(eq(itemTypeFields.id, id)).get()

export type FieldUpsert = {
  id?: number
  name: string
  fieldType: ItemTypeFieldRow['fieldType']
  required: boolean
  config: unknown
  sortOrder: number
}

// Apply an explicit field-set diff. An upsert WITH an `id` updates that row in
// place, so the id is unchanged and the `item_custom_field_values.field_id`
// cascade never fires — that is the whole fix. An upsert WITHOUT an id inserts.
// Only `deletedIds` deletes: omission never means deletion, because an inline
// "save this row" sends a single upsert and must not be able to mean "delete the
// rest".
//
// Does NOT open its own transaction — it is always called from within
// `service.updateFields`'s transaction, so the value clearing and the field ops
// commit together (same convention as `items/repo.ts`'s `replaceFieldValues`).
export const applyFieldOps = (db: DrizzleDb, typeId: number, upserts: FieldUpsert[], deletedIds: number[]): ItemTypeFieldRow[] => {
  for (const id of deletedIds) db.delete(itemTypeFields).where(eq(itemTypeFields.id, id)).run()
  for (const field of upserts) {
    if (field.id !== undefined) {
      db.update(itemTypeFields)
        .set({ name: field.name, fieldType: field.fieldType, required: field.required, config: field.config, sortOrder: field.sortOrder })
        .where(eq(itemTypeFields.id, field.id))
        .run()
    } else {
      db.insert(itemTypeFields)
        .values({ itemTypeId: typeId, name: field.name, fieldType: field.fieldType, required: field.required, config: field.config, sortOrder: field.sortOrder })
        .run()
    }
  }
  return db.select(FIELD_FIELDS).from(itemTypeFields).where(eq(itemTypeFields.itemTypeId, typeId)).all()
}

export type FieldValueRow = { itemId: number; name: string; value: string; published: boolean }

// Every NON-EMPTY value of one field, with the owning item's name. The emptiness
// predicate is `IS NOT NULL AND <> ''` and it is not negotiable: a blank field
// still has a row, so counting rows over-reports (see the design spec). SQL's
// three-valued logic already drops NULLs from `<> ''`, but both conditions are
// spelled out so the intent survives a reader who does not remember that.
export const listNonEmptyValues = (db: DrizzleDb, fieldId: number): FieldValueRow[] =>
  db
    .select({ itemId: itemCustomFieldValues.itemId, name: items.name, value: itemCustomFieldValues.value, published: items.published })
    .from(itemCustomFieldValues)
    .innerJoin(items, eq(items.id, itemCustomFieldValues.itemId))
    .where(and(eq(itemCustomFieldValues.fieldId, fieldId), isNotNull(itemCustomFieldValues.value), ne(itemCustomFieldValues.value, '')))
    .all() as FieldValueRow[]

// Drop one item's value for one field. Deleting the row (rather than storing
// '') keeps "no value" unambiguous: the item form reads a missing row as ''.
export const clearValue = (db: DrizzleDb, itemId: number, fieldId: number): void => {
  db.delete(itemCustomFieldValues).where(and(eq(itemCustomFieldValues.itemId, itemId), eq(itemCustomFieldValues.fieldId, fieldId))).run()
}

// Published items of the type — the population that can actually be edited, and
// so the only one that matters for a "items missing a value" count. Drafts are
// created value-less by the unpack flow (repo.createItem with fieldValues: [])
// and are only renamable, so including them would be noise.
export const countPublishedItemsOfType = (db: DrizzleDb, typeId: number): number =>
  db.select({ n: sql<number>`count(*)` }).from(items).where(and(eq(items.itemTypeId, typeId), eq(items.published, true))).get()?.n ?? 0
```

- [ ] **Step 4: Add the service functions**

In `apps/api/src/modules/itemTypes/service.ts`, extend the imports and add:

```ts
import { fitsFieldType } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
import { reindexItem, reindexItemType } from '../items/fts.js'
```

```ts
export type FieldUpsertInput = {
  id?: number
  name: string
  fieldType: FieldType
  required?: boolean
  config?: Record<string, unknown>
  sortOrder?: number
}

export type UpdateFieldsInput = {
  id: number
  upserts: FieldUpsertInput[]
  deletedIds: number[]
  clearIncompatible?: boolean
  acknowledgeValueLoss?: boolean
  acknowledgedValueCount?: number
}

export type FieldValueUsage = {
  total: number
  missing: number
  items: { itemId: number; name: string; value: string }[]
}

// `missing` is derived from the same value read as `total`: a published item of
// the type that has no non-empty value for this field. Computed from the
// UNFILTERED set, so asking "which values do not fit `url`" still reports how
// many items are simply blank.
export const fieldValueUsage = (
  db: DrizzleDb,
  input: { typeId: number; fieldId: number; fieldType?: FieldType }
): FieldValueUsage => {
  const field = repo.getField(db, input.fieldId)
  if (!field || field.itemTypeId !== input.typeId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })

  const rows = repo.listNonEmptyValues(db, input.fieldId)
  const ids = new Set(rows.filter((r) => r.published).map((r) => r.itemId))
  return {
    // `fieldType` narrows to the values a retype would strand; without it this
    // is every non-empty value, which is what a field deletion destroys.
    items: rows
      .filter((r) => input.fieldType === undefined || !fitsFieldType(input.fieldType, r.value))
      .map(({ itemId, name, value }) => ({ itemId, name, value })),
    total: rows.filter((r) => input.fieldType === undefined || !fitsFieldType(input.fieldType, r.value)).length,
    missing: Math.max(0, repo.countPublishedItemsOfType(db, input.typeId) - ids.size),
  }
}

// Rewrite the type's field set. Non-destructive except where explicitly
// acknowledged; see the design spec §5-§7.
export const updateFields = (db: DrizzleDb, input: UpdateFieldsInput): ItemTypeDto => {
  const type = repo.getType(db, input.id)
  if (!type) throw new TRPCError({ code: 'NOT_FOUND' })

  const existing = repo.getTypeFields(db, input.id)
  const byId = new Map(existing.map((f) => [f.id, f]))
  for (const field of input.upserts) {
    if (field.id !== undefined && !byId.has(field.id)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })
  }
  for (const id of input.deletedIds) {
    if (!byId.has(id)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That field does not belong to this item type.' })
  }

  // Every value this write is about to destroy, collected BEFORE it is gone.
  const doomed = new Set<number>()

  for (const field of input.upserts) {
    if (field.id === undefined) continue
    const current = byId.get(field.id)!
    if (current.fieldType === field.fieldType) continue
    const offenders = repo.listNonEmptyValues(db, field.id).filter((v) => !fitsFieldType(field.fieldType, v.value))
    if (offenders.length === 0) continue
    if (!input.clearIncompatible) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `${offenders.length} value${offenders.length === 1 ? '' : 's'} held by “${current.name}” cannot be read as ${field.fieldType}. Fix or clear them first.`,
      })
    }
    // The count pin: the modal's list is a snapshot, so a value added since must
    // not be destroyed unseen. Refuse rather than write.
    if (input.acknowledgedValueCount !== offenders.length) {
      throw new TRPCError({ code: 'CONFLICT', message: 'The values changed since you last looked. Re-check and try again.' })
    }
    for (const value of offenders) doomed.add(value.itemId)
  }

  if (input.deletedIds.length > 0 && !input.acknowledgeValueLoss) {
    const values = input.deletedIds.flatMap((id) => repo.listNonEmptyValues(db, id))
    if (values.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Deleting ${input.deletedIds.length === 1 ? 'this field' : 'these fields'} destroys ${values.length} stored value${values.length === 1 ? '' : 's'}.`,
      })
    }
  }
  // A cascade is about to remove these rows, so their item ids must be read now.
  for (const id of input.deletedIds) for (const value of repo.listNonEmptyValues(db, id)) doomed.add(value.itemId)

  // An omitted attribute PRESERVES the stored one rather than clearing it —
  // omission is not a delete anywhere in this diff, and a caller that only wants
  // to rename a field must not silently drop its `required` or `config`.
  let nextSortOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder ?? 0), 0)
  const upserts: repo.FieldUpsert[] = input.upserts.map((field) => {
    const current = field.id === undefined ? undefined : byId.get(field.id)!
    return {
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      required: field.required ?? current?.required ?? false,
      // `config` is undefined for a field that never had one, which the column
      // stores as NULL.
      config: field.config ?? current?.config ?? null,
      sortOrder: field.sortOrder ?? current?.sortOrder ?? (nextSortOrder += 1),
    }
  })

  const rows = db.transaction((tx) => {
    const t = tx as unknown as DrizzleDb
    // Clearing and retyping commit together: a failure between them would leave
    // the values destroyed AND the type unchanged, which is the worst outcome.
    for (const field of input.upserts) {
      if (field.id === undefined || !input.clearIncompatible) continue
      const current = byId.get(field.id)!
      if (current.fieldType === field.fieldType) continue
      for (const value of repo.listNonEmptyValues(t, field.id)) {
        if (!fitsFieldType(field.fieldType, value.value)) repo.clearValue(t, value.itemId, field.id)
      }
    }
    const next = repo.applyFieldOps(t, input.id, upserts, input.deletedIds)
    // The FTS blob carries the item's field VALUES, not the field's name, so it
    // only changes for items that just lost a value.
    for (const itemId of doomed) reindexItem(t, itemId)
    return next
  })

  return toDto(type, rows)
}
```

- [ ] **Step 5: Wire the router**

In `apps/api/src/modules/itemTypes/router.ts`, add `import { FIELD_TYPES } from '@homebox/shared'`, add the three input schemas from the **Interfaces** block above, and add the procedures:

```ts
  list: protectedProcedure.query(({ ctx }) => service.listItemTypes(ctx.db)),
  create: adminProcedure.input(createInput).mutation(({ ctx, input }) => service.createItemType(ctx.db, input)),
  update: adminProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateItemType(ctx.db, input)),
  updateFields: adminProcedure.input(updateFieldsInput).mutation(({ ctx, input }) => service.updateFields(ctx.db, input)),
  fieldValueUsage: adminProcedure.input(fieldValueUsageInput).query(({ ctx, input }) => service.fieldValueUsage(ctx.db, input)),
  delete: adminProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteItemType(ctx.db, input.id)),
```

`fieldValueUsage` is admin-gated because only the admin-only type editor calls it.

> Do **not** remove `fields` from `updateInput` in this task — the web page still sends it until
> Task 4. Removing both in one step would leave the page silently dropping field changes.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @homebox/api build && pnpm --filter @homebox/api exec vitest run test/itemTypeFields.test.ts`
Expected: PASS — every case in the file, including the five `describe` groups (the diff's
non-destructiveness, the deletion acknowledgment, the retype gate, the count pin, and
`fieldValueUsage`).

- [ ] **Step 7: Run the whole API suite**

Run: `pnpm --filter @homebox/api test`
Expected: PASS — Task 3 adds procedures and changes no existing behaviour.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/itemTypes apps/api/test/itemTypeFields.test.ts
git commit -m "feat(api): non-destructive field-set edits, gated where they destroy

Editing an item type's fields deleted every stored value of that type: the write
was a delete-and-reinsert of the field rows, and item_custom_field_values.field_id
cascades. It fired on ANY change to the set, including a rename.

applyFieldOps applies an explicit diff instead. An upsert carrying an id updates
that row in place, so the cascade never fires; only deletedIds delete, so an
inline single-row save cannot mean 'delete the rest'.

Only fieldType is gated, because only it can strand a value in a form that then
blanks it or refuses to submit: a retype is refused while any non-empty value does
not fit the new type, and allowed otherwise. Destroying requires
clearIncompatible plus a count the server re-validates inside the transaction, so
a value added while the confirmation was open cannot be destroyed unseen.
fieldValueUsage serves the refusal, the deletion count and the web's warning from
one query, and counts only non-empty values — a blank field still has a row."
```

---

## Task 4: The web field editor

**Files:**
- Create: `apps/web/src/features/itemTypes/TypeFields.tsx`
- Create: `apps/web/test/typeFields.test.tsx`
- Modify: `apps/web/src/features/itemTypes/ItemTypesPage.tsx`
- Modify: `apps/web/test/itemTypes.test.tsx`
- Modify: `apps/web/test/catalog.test.tsx`, `apps/web/test/itemDetail.test.tsx` (mock `itemTypes.updateFields`)
- Modify: `apps/api/src/modules/itemTypes/router.ts` (remove `fields` from `updateInput`)
- Modify: `apps/api/src/modules/itemTypes/service.ts` (remove `fields` from `updateItemType`)
- Modify: `apps/api/src/modules/itemTypes/repo.ts` (delete `replaceTypeFields`)

**Interfaces:**
- Consumes: `updateFields`, `fieldValueUsage` (Task 3); `FIELD_TYPES`, `FieldType`, `fitsFieldType` (Task 1).
- Produces: `TypeFields({ typeId, fields, canEdit }: { typeId: number; fields: TypeField[]; canEdit: boolean })`, where

```ts
type TypeField = { id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }
```

This task covers add / rename / reorder-by-order / `required` / delete. The retype flow (the
per-row warning and the dialog) is Task 5; here a retype that the server refuses simply surfaces
its message in the row.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/typeFields.test.tsx` with the mock scaffold the other web tests use, plus:

```tsx
const mocks = vi.hoisted(() => ({
  updateFields: vi.fn(async (input: unknown) => input),
  // The component reads the usage imperatively (before a confirm, and before a
  // retype), so the mock has to provide `utils.client`, not a `useQuery`.
  usageQuery: vi.fn(async (): Promise<{ total: number; missing: number; items: { itemId: number; name: string; value: string }[] }> => ({ total: 0, missing: 0, items: [] })),
  invalidate: vi.fn(),
  confirm: vi.fn((_message: string) => true),
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({
        itemTypes: { list: { invalidate: mocks.invalidate } },
        items: { list: { invalidate: mocks.invalidate } },
        client: { itemTypes: { fieldValueUsage: { query: mocks.usageQuery } } },
      }),
      itemTypes: {
        updateFields: { useMutation: () => ({ mutateAsync: mocks.updateFields, isPending: false, error: null }) },
      },
      settings: { get: { useQuery: () => ({ data: undefined, isLoading: false }) }, update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }) } },
    },
  }
})
```

`window.confirm` is not the mock's `confirm` unless the test routes it there:

```tsx
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockImplementation((message) => mocks.confirm(String(message)))
})
```

```tsx
const fields = [
  { id: 11, name: 'size', fieldType: 'text' as const, required: false, sortOrder: 0 },
  { id: 12, name: 'note', fieldType: 'text' as const, required: false, sortOrder: 1 },
]

// The editor talks only to tRPC and the `ui` primitives, so no provider wrapper is
// needed. The dialog's offender links are plain <a href>, so no router either.
const renderFields = ({ canEdit = true }: { canEdit?: boolean } = {}) =>
  render(<TypeFields typeId={7} fields={fields} canEdit={canEdit} />)

describe('type fields editor', () => {
  it('renders a row per field with a required toggle', async () => {
    renderFields()
    expect(screen.getByDisplayValue('size')).toBeInTheDocument()
    expect(screen.getByDisplayValue('note')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox', { name: /required/i })).toHaveLength(2)
  })

  // Saving one row must send ONE upsert, so the server's diff can never read it
  // as "delete the others".
  it('renames a single field with a single upsert and no deletions', async () => {
    renderFields()
    fireEvent.change(screen.getByDisplayValue('size'), { target: { value: 'size (cm)' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^save/i })[0])
    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({
        id: 7,
        upserts: [{ id: 11, name: 'size (cm)', fieldType: 'text', required: false, sortOrder: 0 }],
        deletedIds: [],
      })
    )
  })

  it('adds a field without a sortOrder, letting the server append it', async () => {
    renderFields()
    fireEvent.change(screen.getByLabelText('New field name'), { target: { value: 'colour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() =>
      expect(mocks.updateFields).toHaveBeenCalledWith({ id: 7, upserts: [{ name: 'colour', fieldType: 'text' }], deletedIds: [] })
    )
  })

  it('toggles required on one row only', async () => {
    renderFields()
    fireEvent.click(screen.getAllByRole('checkbox', { name: /required/i })[0])
    fireEvent.click(screen.getAllByRole('button', { name: /^save/i })[0])
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalledWith(expect.objectContaining({ upserts: [expect.objectContaining({ id: 11, required: true })] })))
  })

  // Deleting destroys, so the confirmation must name the count and the request
  // must carry the acknowledgment.
  it('asks for the value count, confirms, then acknowledges the loss', async () => {
    mocks.usageQuery.mockResolvedValueOnce({ total: 3, missing: 0, items: [] })
    renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining('3 stored values')))
    await waitFor(() => expect(mocks.updateFields).toHaveBeenCalledWith({ id: 7, upserts: [], deletedIds: [11], acknowledgeValueLoss: true }))
  })

  it('does nothing when the deletion is declined', async () => {
    mocks.confirm.mockReturnValueOnce(false)
    renderFields()
    fireEvent.click(screen.getAllByRole('button', { name: /^delete/i })[0])
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.updateFields).not.toHaveBeenCalled()
  })

  it('hides every control from a non-admin', () => {
    renderFields({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /required/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @homebox/web exec vitest run test/typeFields.test.tsx`
Expected: FAIL — `../src/features/itemTypes/TypeFields` does not exist.

- [ ] **Step 3: Write `TypeFields.tsx`**

```tsx
import { useState } from 'react'
import { FIELD_TYPES } from '@homebox/shared'
import type { FieldType } from '@homebox/shared'
import { trpc } from '../../api/trpc'
import { Button, Field, Input, Select } from '../../ui'

export type TypeField = { id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// A locally-edited copy of one row, so a rename is only sent when Save is hit.
type DraftRow = { key: number; id: number; name: string; fieldType: FieldType; required: boolean; sortOrder: number }

// The field-set editor. Every row saves on its own, and each save sends exactly
// one upsert plus no deletions — which is only safe because the API's diff never
// infers a deletion from an omission (see ADR-0003).
export function TypeFields({ typeId, fields, canEdit }: { typeId: number; fields: TypeField[]; canEdit: boolean }) {
  const utils = trpc.useUtils()
  const updateFields = trpc.itemTypes.updateFields.useMutation()

  const [rows, setRows] = useState<DraftRow[]>(() => fields.map((f, index) => ({ key: index, ...f })))
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<FieldType>('text')
  const [error, setError] = useState<string | null>(null)

  const run = async (input: Parameters<typeof updateFields.mutateAsync>[0]) => {
    setError(null)
    try {
      await updateFields.mutateAsync(input)
      await utils.itemTypes.list.invalidate()
      await utils.items.list.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the field')
    }
  }

  const patch = (key: number, next: Partial<DraftRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)))

  const isDirty = (row: DraftRow) => {
    const saved = fields.find((f) => f.id === row.id)
    return !saved || saved.name !== row.name || saved.fieldType !== row.fieldType || saved.required !== row.required
  }

  const save = (row: DraftRow) =>
    run({ id: typeId, upserts: [{ id: row.id, name: row.name, fieldType: row.fieldType, required: row.required, sortOrder: row.sortOrder }], deletedIds: [] })

  const add = () =>
    run({ id: typeId, upserts: [{ name: newName, fieldType: newType }], deletedIds: [] }).then(() => {
      setNewName('')
      setNewType('text')
    })

  // The count is read first so the confirmation can name what it destroys.
  const remove = async (row: DraftRow) => {
    const usage = await utils.client.itemTypes.fieldValueUsage.query({ typeId, fieldId: row.id })
    const warning = usage.total === 0 ? `Delete the field “${row.name}”?` : `Delete the field “${row.name}”? This also destroys ${usage.total} stored value${usage.total === 1 ? '' : 's'}.`
    if (!window.confirm(warning)) return
    await run({ id: typeId, upserts: [], deletedIds: [row.id], acknowledgeValueLoss: true })
  }

  return (
    <div className="border border-border rounded-lg p-3 flex flex-col gap-2">
      <span className="text-text-muted">Custom fields</span>

      {rows.map((row) => (
        <div className="flex gap-3 items-end" key={row.key}>
          <Field label="Name" htmlFor={`field-name-${row.key}`} className="flex-1 min-w-0">
            <Input id={`field-name-${row.key}`} value={row.name} disabled={!canEdit} onChange={(e) => patch(row.key, { name: e.target.value })} className="w-full" />
          </Field>
          <Field label="Type" htmlFor={`field-type-${row.key}`}>
            <Select id={`field-type-${row.key}`} value={row.fieldType} disabled={!canEdit} onChange={(e) => patch(row.key, { fieldType: e.target.value as FieldType })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-1">
            <input type="checkbox" aria-label={`${row.name} required`} checked={row.required} disabled={!canEdit} onChange={(e) => patch(row.key, { required: e.target.checked })} />
            required
          </label>
          {canEdit && (
            <>
              <Button size="sm" variant="primary" disabled={!isDirty(row) || updateFields.isPending} onClick={() => save(row)}>
                Save
              </Button>
              <Button size="sm" variant="danger" disabled={updateFields.isPending} onClick={() => remove(row)}>
                Delete
              </Button>
            </>
          )}
        </div>
      ))}

      {canEdit && (
        <div className="flex gap-3 items-end">
          <Field label="New field name" htmlFor="new-field-name" className="flex-1 min-w-0">
            <Input id="new-field-name" value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full" />
          </Field>
          <Field label="New field type" htmlFor="new-field-type">
            <Select id="new-field-type" value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Button disabled={newName.trim() === '' || updateFields.isPending} onClick={add}>
            Add field
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @homebox/web exec vitest run test/typeFields.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Restructure `ItemTypesPage.tsx`**

Replace the inline `fields` editing with `<TypeFields>`:

- Keep: the `<h1>`, the admin gate, the type list, the create form (name + description + an
  initial field list, which still posts to `itemTypes.create` with `fields`).
- Remove: the `signature` helper, `loadedFields` state and the `fieldSetChanged` guard — the
  diff makes them unnecessary, since an unchanged set is now harmless to resend.
- Change: the edit form sends only `{ id, name, description }` to `itemTypes.update`.
- Add: below the edit form, `<TypeFields typeId={editingId} fields={editing.fields} canEdit={isAdmin} />`,
  rendered only while editing an existing type.

The create form keeps its `DraftField[]` rows (name, fieldType, required) and submits
`fields: rows.map(...)` including `required`, so the toggle is live on creation too.

- [ ] **Step 6: Update the page's test**

In `apps/web/test/itemTypes.test.tsx`: add `updateFields` and `fieldValueUsage` to the `itemTypes`
mock, assert that a name-only edit now sends `{ id, name, description }` **with no `fields` key**,
and replace the two `fields`-signature tests (create still sends `fields`; the retype and dialog
cases move to Task 5's tests).

- [ ] **Step 7: Verify the web suite**

Neither `catalog.test.tsx` (which renders `ItemsPage`) nor `itemDetail.test.tsx` renders the
item-types page or `TypeFields`, so neither mock needs `updateFields` — no change is expected
there. Only add it if a test in this step actually throws for a missing procedure.

Run: `pnpm --filter @homebox/web test`
Expected: PASS, all files.

- [ ] **Step 8: Remove the dead API surface**

Now that nothing sends `fields` to update:

- `apps/api/src/modules/itemTypes/router.ts`: `updateInput` becomes `{ id, name?, description? }`
  (keep `createInput`'s `fields`).
- `apps/api/src/modules/itemTypes/service.ts`: `updateItemType` no longer takes or applies
  `fields`; drop the `replaceTypeFields` call and the unused `repos`/`ItemTypeFieldInput` imports.
- `apps/api/src/modules/itemTypes/repo.ts`: delete `replaceTypeFields`.

Then run the pattern-change verification from the File Structure section:

```bash
grep -rn "replaceTypeFields" apps packages --include='*.ts' --include='*.tsx'
```

Expected: no hits outside `apps/api/dist/`. Remove any leftover `fields` mention in the web page
too: `grep -rn "fields:" apps/web/src/features/itemTypes/ItemTypesPage.tsx` should match only the
create call.

- [ ] **Step 9: Build, typecheck, and run both suites**

Run: `pnpm --filter @homebox/api build && pnpm --filter @homebox/web exec tsc --noEmit && pnpm --filter @homebox/api test && pnpm --filter @homebox/web test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/itemTypes apps/web/src/features/itemTypes apps/web/test
git commit -m "feat(web): edit item-type fields inline, one row at a time

Each field row saves on its own, sending exactly one upsert and no deletions —
safe only because the API's diff never infers a deletion from an omission. That
also retires the old 'send the whole set only if it changed' guard, which existed
to dodge the destructive replace and is now unnecessary.

Deleting a row reads fieldValueUsage first so the confirmation names what it
destroys, then sends acknowledgeValueLoss.

With the last caller gone, itemTypes.update drops \`fields\` and replaceTypeFields
is deleted."
```

---

## Task 5: The retype flow and the offenders dialog

**Files:**
- Create: `apps/web/src/features/itemTypes/IncompatibleValuesDialog.tsx`
- Create: `apps/web/test/incompatibleValuesDialog.test.tsx`
- Modify: `apps/web/src/features/itemTypes/TypeFields.tsx`
- Modify: `apps/web/test/typeFields.test.tsx`

**Interfaces:**
- Consumes: `fieldValueUsage` (Task 3), `TypeFields` (Task 4), `ui/Modal` (existing).
- Produces:

```tsx
export type Offender = { itemId: number; name: string; value: string }

export function IncompatibleValuesDialog({
  open, fieldName, targetType, offenders, total, onConfirm, onCancel,
}: {
  open: boolean
  fieldName: string
  targetType: FieldType
  offenders: Offender[]   // already truncated to the cap by the caller
  total: number           // the true count, which is what the button commits to
  onConfirm: () => void
  onCancel: () => void
})
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/incompatibleValuesDialog.test.tsx` covering:

- the count of **values** (not rows) is stated, and the button reads `Clear N values and convert`;
- each offender renders its item name, its value, and a link to `/items/<id>` with
  `target="_blank"`;
- only the first 50 rows render, with a `+ N more` line when `total` exceeds them;
- `onConfirm` fires only after the second confirmation (`window.confirm`), and `onCancel` fires
  without it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @homebox/web exec vitest run test/incompatibleValuesDialog.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the dialog**

```tsx
import type { FieldType } from '@homebox/shared'
import { Button, Modal } from '../../ui'

export type Offender = { itemId: number; name: string; value: string }

// The rows are a sample for judgement; `total` is what the destructive button
// commits to deleting, which is why they are separate props.
const MAX_ROWS = 50

export function IncompatibleValuesDialog({
  open, fieldName, targetType, offenders, total, onConfirm, onCancel,
}: {
  open: boolean
  fieldName: string
  targetType: FieldType
  offenders: Offender[]
  total: number
  onConfirm: () => void
  onCancel: () => void
}) {
  const shown = offenders.slice(0, MAX_ROWS)
  const plural = total === 1 ? '' : 's'

  return (
    // `Modal` is controlled via `onOpenChange`, and its `title` prop renders
    // `sr-only` (it exists for the accessible name), so the VISIBLE heading is
    // ours. Nothing here autofocuses: per issue #1 an effect that focuses inside
    // the portalled content during mount leaves Modal's opener capture null.
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onCancel() }}
      title={`“${fieldName}” cannot become ${targetType}`}
    >
      <h2>“{fieldName}” cannot become {targetType}</h2>
      <p>
        {total} stored value{plural} cannot be read as {targetType}. Fix them, or clear them and convert.
      </p>

      {/* The destructive action sits at the top, and asks again: it is
          irreversible and this dialog is easy to reach by accident. */}
      <div className="flex justify-end">
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(`Clear ${total} stored value${plural}? This cannot be undone.`)) onConfirm()
          }}
        >
          Clear {total} value{plural} and convert
        </Button>
      </div>

      <ul className="list-none pl-0 max-h-[50vh] overflow-auto">
        {shown.map((row) => (
          <li key={row.itemId}>
            {/* A plain anchor, not a router Link: the point is a new tab, and the
                Link component cannot carry target/rel cleanly. */}
            <a href={`/items/${row.itemId}`} target="_blank" rel="noreferrer" className="no-underline">
              {row.name}
            </a>
            {' — '}
            <span className="text-text-muted">“{row.value}”</span>
          </li>
        ))}
      </ul>
      {total > shown.length && <p className="text-text-muted">+ {total - shown.length} more</p>}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @homebox/web exec vitest run test/incompatibleValuesDialog.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the retype flow into `TypeFields`**

Add to `TypeFields.tsx`:

```tsx
  const [pending, setPending] = useState<{ row: DraftRow; usage: FieldValueUsage } | null>(null)
  const [usageFor, setUsageFor] = useState<{ key: number; total: number } | null>(null)

  // Changing a row's type asks what would be stranded, so the warning is there
  // BEFORE Save rather than as a failure after it.
  const previewRetype = async (row: DraftRow, fieldType: FieldType) => {
    patch(row.key, { fieldType })
    const usage = await utils.client.itemTypes.fieldValueUsage.query({ typeId, fieldId: row.id, fieldType })
    setUsageFor(usage.total > 0 ? { key: row.key, total: usage.total } : null)
    return usage
  }

  const save = async (row: DraftRow) => {
    const saved = fields.find((f) => f.id === row.id)
    if (saved && saved.fieldType !== row.fieldType) {
      const usage = await utils.client.itemTypes.fieldValueUsage.query({ typeId, fieldId: row.id, fieldType: row.fieldType })
      if (usage.total > 0) {
        // The dialog opens with the offenders; the count it sends back is the
        // one the server re-validates.
        setPending({ row, usage: { ...usage, total: usage.total } })
        return
      }
    }
    await run({ id: typeId, upserts: [{ id: row.id, name: row.name, fieldType: row.fieldType, required: row.required, sortOrder: row.sortOrder }], deletedIds: [] })
  }
```

`previewRetype` replaces the row's `onChange`, and `usageFor` renders the inline warning
(`<span className="text-danger">{usageFor.total} values don't fit {row.fieldType}</span>`).

> **Stale-list rule:** the dialog re-queries on window focus and on open, because the whole point
> of the links is that the user leaves to fix items. Wire a `focus` listener that re-runs
> `fieldValueUsage` and updates both `pending.usage` and the warning while the dialog is open.

The dialog's `onConfirm` sends the acknowledged write:

```tsx
  <IncompatibleValuesDialog
    open={pending !== null}
    fieldName={pending?.row.name ?? ''}
    targetType={pending?.row.fieldType ?? 'text'}
    offenders={pending?.usage.items ?? []}
    total={pending?.usage.total ?? 0}
    onCancel={() => setPending(null)}
    onConfirm={async () => {
      if (!pending) return
      const { row, usage } = pending
      setPending(null)
      await run({
        id: typeId,
        upserts: [{ id: row.id, name: row.name, fieldType: row.fieldType, required: row.required, sortOrder: row.sortOrder }],
        deletedIds: [],
        clearIncompatible: true,
        acknowledgedValueCount: usage.total,
      })
    }}
  />
```

- [ ] **Step 6: Add the TypeFields tests for the flow**

Extend `apps/web/test/typeFields.test.tsx`:

- a type change with zero stranded values saves immediately, with no dialog;
- a type change with stranded values opens the dialog and sends **nothing**;
- confirming sends `clearIncompatible: true` and `acknowledgedValueCount: <the count shown>`;
- cancelling leaves the type unchanged and sends nothing;
- the inline warning appears on the row when `total > 0`.

- [ ] **Step 7: Run the web suite and typecheck**

Run: `pnpm --filter @homebox/web exec tsc --noEmit && pnpm --filter @homebox/web test`
Expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/itemTypes apps/web/test
git commit -m "feat(web): warn, list and gate a retype that would strand values

Changing a field's type now asks the API what would be stranded before saving, so
the warning lands on the row. When values do not fit, the offenders dialog lists
the items with the values that blocked the change and links each one in a new tab,
so the user can go and fix them — the list re-checks on focus, because leaving to
fix them is the point.

The one destructive action is a top-of-dialog button behind a second confirm, and
it sends clearIncompatible plus the count it displayed; the server re-validates
that count, so a value added while the dialog was open is refused rather than
destroyed unseen."
```

---

## Task 6: Dev fixtures

**Files:**
- Create: `apps/api/scripts/seed.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `createDb`, `runMigrations` from `@homebox/db`; `hashPassword` from `../src/auth/password.js`; the item-type/location repos.
- Produces: nothing importable. Run with `pnpm --filter @homebox/api seed`.

- [ ] **Step 1: Write the script**

Follow `scripts/detection-model.ts`'s pattern: read the environment **directly**, never through
`loadEnv` (which would demand `SESSION_SECRET`), and hold no Fastify app.

```ts
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createDb, runMigrations } from '@homebox/db'
import { hashPassword } from '../src/auth/password.js'

// Dev fixtures for eyeballing the catalog and the item-type editor. Runs
// directly against the database — no Fastify, no SESSION_SECRET — and is
// idempotent by name, so re-running it neither duplicates the catalog nor fails.
//
// The item types are chosen to make the destructive paths REACHABLE BY HAND:
// `Probe texture` holds a "finish" field with values that are not numbers, so
// retyping it to `number` exercises the refusal and the offenders dialog.
const ADMIN = { name: 'Admin', email: 'a@a.com', password: 'aaaaaaaa' }

const dbPath = process.env.DATABASE_PATH ?? './data/homebox.db'
const dataDir = process.env.DATA_DIR ?? './data'
```

Then:

1. `await mkdir(dataDir, { recursive: true })`, `const db = createDb(dbPath)`, `runMigrations(db)`.
2. **Admin** — insert if absent:
   ```ts
   const users = db.select().from(usersTable).all()
   ```
   Insert with `{ name, email, passwordHash: await hashPassword(ADMIN.password), role: 'admin', mustChangePassword: false }`.
3. **Locations** — insert a small tree if the `locations` table is empty: `Home`, `Home / Garage`,
   `Home / Study`, `Shed`.
4. **Item types** — for each of three definitions, insert if no type of that name exists:
   - `Probe texture`, fields: `finish` (text), `width` (number, required),
   - `Furniture`, fields: `material` (text), `price` (currency),
   - `Electronics`, fields: `serial` (text), `manual` (url).
5. **Items** — only when the `items` table is empty, so re-running does not multiply them. Create
   ~10 published items spread across the types and locations, each with values — and for
   `Probe texture`, at least three with `finish` values that are deliberately **not** numbers
   (`'matte'`, `'brushed steel'`, `'n/a'`), plus one item that leaves `width` blank so the
   "missing a value" warning has something to report.
6. Print a summary of what was created versus already present, and `process.exit(0)`.

- [ ] **Step 2: Add the script entry**

In `apps/api/package.json`:

```json
    "seed": "tsx scripts/seed.ts",
```

- [ ] **Step 3: Run it against a scratch database**

Run:

```bash
DATABASE_PATH=./data/seed-check.db DATA_DIR=./data pnpm --filter @homebox/api seed
```

Expected: it reports the fixtures it created. Then run it a **second** time and expect it to
report them as already present, with no duplicates — that is the idempotency check.

- [ ] **Step 4: Verify the fixtures reach the app**

Start the API against the scratch db, log in as `a@a.com` / `aaaaaaaa`, and confirm `itemTypes.list`
returns three types and `items.list` returns the seeded items. Then delete the scratch database.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/seed.ts apps/api/package.json
git commit -m "feat(api): a seed script for dev fixtures

Idempotent by name, so re-running it neither duplicates the catalog nor fails, and
runs straight against the database without Fastify or SESSION_SECRET — the same
shape as scripts/detection-model.ts.

The types are picked so the destructive paths are reachable by hand: 'Probe
texture' carries non-numeric 'finish' values, so retyping it to number exercises
the refusal and the offenders dialog, and one item leaves a required field blank
so the 'missing a value' warning has something to report."
```

---

## Task 7: Whole-suite verification and manual pass

**Files:** none — verification only. If a check fails, fix it and re-run.

- [ ] **Step 1: Build everything and typecheck**

Run:
```bash
pnpm --filter @homebox/shared build && pnpm --filter @homebox/db build && pnpm --filter @homebox/api build && pnpm --filter @homebox/web exec tsc --noEmit
```
Expected: all clean.

- [ ] **Step 2: Run every suite**

Run: `pnpm test`
Expected: shared, db, api and web all pass. Report the counts.

- [ ] **Step 3: Re-run the pattern-change verification**

Run: `grep -rn "replaceTypeFields" apps packages --include='*.ts' --include='*.tsx'`
Expected: nothing outside `dist/`.

Run: `grep -rn "fields" apps/web/src/features/itemTypes/ItemTypesPage.tsx`
Expected: only the create call passes `fields`; the update call does not.

Run: `grep -rn "itemCustomFieldValues" apps packages --include='*.ts' | grep -v test | grep -v dist`
Expected: exactly the files listed in the File Structure "Boundary" note —
`items/{router,repo,fts}.ts`, `itemTypes/repo.ts` and `schema.ts`. Any *new* file here is scope
creep that must be justified or reverted.

- [ ] **Step 4: Manual pass against the seed**

With the fixtures seeded and the app running:

1. Rename the `finish` field on `Probe texture`. **Confirm the values `matte`, `brushed steel`
   and `n/a` are still on their items** — this is the regression that started all of it.
2. Toggle `required` on `material` and confirm the warning appears when items lack a value.
3. Retype `finish` from `text` to `number`. Expect the refusal with the offenders listed, each
   linking to its item in a new tab.
4. Open one offender, fix its value, return, and confirm the list shrinks on focus.
5. Press *Clear N values and convert*. Confirm the type changed, those values are gone, and the
   other fields' values are untouched.
6. Retype `finish` back to `text` — allowed, since nothing non-empty is left.
7. Delete a field that has values: expect the confirmation to name the count.
8. Open an affected item and confirm the form renders and submits.

- [ ] **Step 5: Commit any fixes, then report**

If the manual pass exposed anything, fix it with its own test and commit. Finish with a report
covering: the four suite results, the manual-pass outcome, and the deliberate non-goals from the
spec's *Out of scope* section.

---

## Self-review notes (for the plan's author, not the implementer)

- **Spec coverage.** §1 invariant → Task 3 (the flags). §2 emptiness → Task 1 (`isRealDataValue`),
  Task 3 (the `listNonEmptyValues` predicate), Task 3's tests. §3 explicit diff → Task 3
  (`applyFieldOps`), Task 4 (the single-upsert row). §4 predicate → Task 1. §5 per-attribute rules
  → Task 3 (only `fieldType` gated; delete needs the flag), Task 4 (`required` toggle). §6 API
  surface → Task 3, Task 4 Step 8 (dropping `fields`). §7 atomicity + count pin → Task 3
  (`doomed` capture, the mismatch → `CONFLICT`). §8 UI → Tasks 4 and 5. §9 `required` → Tasks 4
  and 6 (a seeded blank). §10 fixtures → Task 6. Testing → every task. Out of scope → Task 7's
  third grep asserts the boundary is intact.
- **Ordering constraint.** Task 3 deliberately keeps `fields` on `update` so the web page is never
  left dropping field changes; Task 4 Step 8 removes it once the last caller is gone. Do not
  reorder those two.
- **Reindex detail worth not losing:** the FTS blob carries the item's field *values*, not the
  field's *name*, so a rename needs no reindex but a cleared or cascade-deleted value does — and
  the item ids must be collected *before* the delete, because the cascade takes the rows that
  name them (the same trap `tags/service.ts`'s `deleteTag` documents).
