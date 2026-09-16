# Server-side backup history

**Date:** 2026-09-14
**Status:** Approved
**Supersedes the storage model in:** `2026-09-06-phase5-admin-backup-design.md`

## Problem

`GET /backup` builds an archive in a temp directory, streams it to the browser,
and deletes the temp directory when the response closes (`backupRoutes.ts:55`).
There are tests asserting that no temp file leaks, so this is deliberate — but
the consequence is that the server keeps nothing. Every press of "Download
backup" produces a `homebox-backup.tar.gz` in the browser's download folder, and
the only history is whatever the browser does with repeated same-name downloads
(`homebox-backup (1).tar.gz`, `(2)`, …). Those files are mutually
indistinguishable: the name carries no timestamp, the server has no record of
them, and there is no way to restore anything except a file you personally saved
and can find again.

## Goal

Backups are created and stored on the server. Admin → Backup & restore lists
them as a table — **Created / Status / Size / Actions** — where each row can be
downloaded, restored directly, or deleted. Restoring no longer requires finding
the file on your own machine.

The existing "restore from an uploaded archive" path is unchanged.

## Non-goals

- Retention or automatic pruning (explicitly: no cap).
- Scheduled / cron / automatic backups.
- Copying backups off-server, encryption, or integrity signing.
- Progress reporting while a backup runs (see *No polling* below).

## Storage

`data/backups/`, created lazily by `writeBackupMeta` — the first write makes the
directory. The readers tolerate its absence rather than depending on a boot-time
mkdir: `listBackups` and `sweepRunningToFailed` return empty on ENOENT, so a
fresh install that has never taken a backup needs no directory at all. Each
backup is two files:

```
data/backups/<id>.tar.gz    the archive (homebox.db + uploads/, unchanged layout)
data/backups/<id>.json      sidecar metadata
```

`<id>` is a `randomUUID()`. The sidecar is:

```json
{ "id": "…", "status": "running" | "completed" | "failed",
  "createdAt": "2026-09-14T07:22:20.000Z", "error": "…" }
```

`error` is present only on `failed`.

**Size is never stored.** It is read from `stat()` at list time, so it cannot
disagree with what is actually on disk. A `failed` backup normally has no
archive, and so no size (`—` in the table) — but a create that died mid-tar can
leave a partial `.tar.gz` behind, and that partial file's size IS reported. Size
is a fact read from disk, not a claim derived from status, and a failed row's
leftover bytes are exactly what an admin managing disk needs to see.

**The two files must not be allowed to disagree silently.** Two files per backup
can drift if one is deleted by hand. A sidecar claiming `completed` whose
`.tar.gz` is missing is reported as `failed` with `error: "archive missing"`,
and its stray sidecar is left for the admin to delete — the row never claims a
downloadable file that isn't there.

### Why sidecar files and not a `backups` table (ADR 0006)

`applyRestore` (`service.ts:102`) replaces `homebox.db` outright. A `backups`
table would therefore roll back to whatever it held when the restored archive
was taken: restore a month-old backup and every backup you have taken since
disappears from the list, while its `.tar.gz` stays on disk — invisible, and
undeletable through the UI. Metadata stored beside the files is immune to this,
needs no migration, and cannot drift from the directory it describes.

The archive deliberately contains only `homebox.db` and `uploads/`. Because
`data/backups/` sits outside `uploads/`, backups cannot nest inside backups;
restoring an archive never disturbs the backup store.

## Lifecycle of one "Create backup"

1. **In-process concurrency guard.** If a create is already in flight, respond
   `409 { error: "backup_in_progress" }`. Prevents a double-click from running
   two multi-megabyte tars concurrently.
2. **Write `<id>.json` with `status: "running"`** and await it to completion
   (including the file handle's fsync) *before* responding. The row the client
   receives is durable, never a projection of work that might not start.
3. **Respond** with the running row.
4. **Background**, after the response has been sent: `createBackup` writes the
   tar to `data/backups/<id>.tar.gz`, then rewrites the sidecar as `completed`.
   If it throws, the sidecar is rewritten as `failed` with the error message.
   The rejection is caught — it must not become an unhandled rejection.
5. **Startup sweep.** `registerBackupRoutes` flips any leftover `running`
   sidecar to `failed` when the server boots. Nothing can be mid-flight before
   the process starts, so this is exact rather than a timeout heuristic, and it
   is what guarantees no row is stuck on "running" forever after a crash.

### No polling

The frontend does not poll. After creating a backup the tab says *"Backup
started — refresh to see it finish."* and the admin refreshes when they care.
This is a deliberate trade: it removes a job runner, a polling loop, and
stuck-job recovery from the design, at the cost of the status column being stale
until refresh. It is acceptable because this is an administrative action taken
by hand, not a workflow anything waits on.

## API surface

All routes are admin-gated (`401` unauthenticated, `403` non-admin) using the
existing `admin()` helper, which reads `dbHolder.current`.

| Method   | Path                     | Purpose                                          |
| -------- | ------------------------ | ------------------------------------------------ |
| `POST`   | `/backups`               | create + store → running row                     |
| `GET`    | `/backups`               | list, newest first                               |
| `GET`    | `/backups/:id/download`  | stream the archive, timestamped filename         |
| `DELETE` | `/backups/:id`           | remove archive + sidecar (`409` if running)      |
| `POST`   | `/backups/:id/restore`   | validate the **stored** archive → `{preview, restoreId}` |
| `POST`   | `/backup/restore`        | confirm a restore — **unchanged**                |
| `POST`   | `/upload/backup`         | validate an **uploaded** archive — **unchanged** |

**`GET /backup` is deleted.** It exists only to build-and-stream, and the
per-row download replaces it. One way to obtain a file beats two.

Download filename: `homebox-backup-<YYYY-MM-DDTHH-mm-ssZ>.tar.gz`, derived from
`createdAt` — the timestamp the old fixed name lacked.

### Actions are gated by status

Only a `completed` backup has an archive, so **Download and Restore are
available only on `completed` rows** — the tab renders them disabled otherwise,
and both routes return `409` if called against a `running` or `failed` row
rather than trusting the UI to have hidden them. Delete is available on any row,
but refuses a `running` one.

Restore-from-row reuses the existing two-phase flow exactly: the stored archive
is fed to the same `validateBackup`, returning the same `{ preview, restoreId }`
against the same in-memory map and 15-minute TTL, and the same **preview card +
confirm** applies it. Restoring stays two clicks; the row action opens the card
rather than restoring on click.

### `:id` is a trust boundary

`<id>` is interpolated into a filesystem path, so it is validated against a
strict UUID pattern *and* the resolved path is checked to remain inside
`data/backups/` before any read or delete. An id that fails either check is a
`404`, never a filesystem operation. This is not simplified away.

## Service changes (`modules/backup/service.ts`)

- `createBackup(db, dataDir, destPath)` — tars the dump and uploads copy
  directly to `destPath`. The temp directory now stages only the dump and the
  uploads copy, and is removed in a `finally` on both paths. It no longer
  returns `baseDir`; the route has nothing to clean up.
- `validateBackup` and `applyRestore` — unchanged, reused as-is.
- New, small and filesystem-backed: `listBackups(dir)`, `readBackupMeta`,
  `writeBackupMeta`, `deleteBackup`, `sweepRunningToFailed`.

No schema change and no migration.

## Frontend (`features/admin/AdminBackupTab.tsx`)

- The `download()` handler and the Download button become **Create backup** →
  `POST /backups`.
- A `<table>` — the first in this codebase (`<th scope="col">`; the users tab
  uses a `<ul>`). Built inline in the tab: a shared `ui/Table.tsx` for a single
  consumer is not worth its own module.
- Row actions **Download · Restore · Delete**, matching the approved mockup.
  Delete confirms first (`window.confirm`, the same pattern as every other
  destructive action in the app) and reports the `409` on a `running` row as
  "still running" rather than as a failure. A `failed` row renders the sidecar's
  `error` text under its status, so the reason is visible without the server log.
- The upload `<Field>` and its preview `<Card>` are untouched.
- Data is refetched on mount and after each mutation. No timer.

New i18n keys under `admin.backup` in `locales/en/admin.json`: `create`,
`created`, `status`, `size`, `actions`, `delete`, `restore`, `empty`, the three
status labels, and the started/deleted/delete-failed messages.

## Tests

`apps/api/test/backup.test.ts` — the `GET /backup` cases are removed; added:

- create → row is `running` and its archive lands on disk, sidecar flips to
  `completed`
- the concurrency guard returns `409` while a create is in flight
- a create that fails leaves a `failed` sidecar, not a stuck `running` one
- a manually planted `running` sidecar is swept to `failed` on boot
- `GET /backups` ordering and size-from-stat
- download, delete (including `409` on a running row), and a `:id` traversal
  attempt rejected as `404`
- full create → list → restore-from-row → confirm round trip
- `401`/`403` gating on every new route

The create-failure case ("a create that fails leaves a `failed` sidecar") lives
in its own file, `apps/api/test/backupCreateFailure.test.ts`: it `vi.mock`s
`createBackup` to reject, which is the only way to reach the route's own catch
deterministically — driving it end-to-end would need the live DB handle the auth
check reads.

`apps/web/e2e/admin.spec.ts` — updated for the new flow: create, row appears,
download from the row, then the existing upload-a-file restore.

## Deliberate simplifications

- **In-process promise, not a durable queue.** If the API is killed mid-backup
  the archive is lost and the row reads `failed`. A real queue is substantial
  machinery for an admin-triggered job nobody waits on. Marked with a
  `ponytail:` comment naming the ceiling and the upgrade path.
- **No retention cap**, per decision. Disk management is manual.
- **Delete refuses `running`** rows, so a file cannot be removed from under an
  active tar.
