# ADR-0006: Backup history lives beside its archives, not in the database

**Status:** Accepted (2026-09-14). Extends the storage model of
`docs/superpowers/specs/2026-09-06-phase5-admin-backup-design.md`, which is
otherwise unchanged.

## Context

The backup feature had no memory. `GET /backup`
(`apps/api/src/modules/backup/service.ts:24`) built an archive in a temp
directory, streamed it to the browser, and deleted the temp directory when the
response closed (`backupRoutes.ts:55`). Tests assert that no temp file leaks
(`apps/api/test/backup.test.ts:269`), so the amnesia was deliberate. The cost
only became visible once an admin wanted their last three backups: the server
kept none, the filename carried no timestamp, and repeated downloads piled up as
`homebox-backup (2).tar.gz` — indistinguishable files with no record of which
was which.

Reworking this means answering "where does the list of backups live?", and the
obvious answer is wrong in a way that is invisible until the worst possible
moment.

### The trap in the obvious answer

The obvious answer is a `backups` table in the instance database. It matches how
everything else here is stored, it gets types and migrations for free, and it
looks like the least surprising choice.

But `applyRestore` (`service.ts:102`) *replaces `homebox.db` wholesale* — it
copies the archive's dump over the live database file and reopens. A `backups`
table therefore does not describe the backup store; it describes the backup
store **as it existed inside whichever archive was last restored**. Restore a
backup from a month ago and every backup taken since vanishes from the list,
because its row lived in a database that no longer exists — while its `.tar.gz`
sits on disk, invisible and undeletable through the UI, consuming space with no
way to reclaim it except `rm`.

The failure is precisely inverted from the usual: it does not appear in testing
or on a fresh install, only when someone restores, which is the one moment they
are already having a bad day. And it is self-inflicted — the data describing the
recovery path is stored inside the thing being recovered.

## Decision

**Backup metadata is a sidecar JSON file beside its archive, and the filesystem
is the source of truth.** `data/backups/<id>.tar.gz` and
`data/backups/<id>.json`, where the sidecar holds only what the archive cannot
tell us — `status`, `createdAt`, and `error`.

1. **`data/backups/` is outside the archive's reach.** Archives contain only
   `homebox.db` and `uploads/`. Because the store sits outside `uploads/`,
   restoring can never disturb it, and backups cannot nest inside backups.
2. **Size is derived, never stored.** It comes from `stat()` at list time, so it
   cannot contradict the bytes on disk.
3. **The sidecar is written and durable before the response**, then rewritten on
   completion. A row the client can see is a row that exists on disk.
4. **A `running` sidecar left by a dead process is swept to `failed` at boot.**
   Nothing can be mid-flight before the process starts, so this is exact rather
   than a timeout heuristic — no age threshold to tune.
5. **The two files may not disagree silently.** A sidecar claiming `completed`
   with no archive beside it reports as `failed`.

## Consequences

### Alternatives rejected

- **A `backups` table in the instance database.** Rejected for the reason above:
  restore rolls the list back and orphans the files. It is also the answer that
  looks most correct, which is what makes it worth an ADR rather than a comment.
- **A separate SQLite file for backup metadata** (`data/backups.db`), outside
  `homebox.db`'s blast radius. Escapes the rollback and keeps SQL, but adds a
  second database, its own connection lifecycle, migrations, and a
  `dbHolder`-shaped problem — a connection that must survive a restore. Two
  files in a directory already describe themselves with none of that.
- **Derive everything from the directory listing, with no sidecar.** Tempting,
  and it removes a file to keep in sync. But a directory cannot express
  `running`, cannot express `failed`, and has no room for the error text that
  makes a failure diagnosable — so a failed backup would leave no trace at all,
  and the admin would see a button that did nothing.
- **Keep `GET /backup` and add storage alongside it.** Two ways to obtain an
  archive, one of which the new list does not know about. The route is deleted
  instead; the per-row download replaces it.

### Accepted costs

- **The background job is an in-process promise, not a durable queue.** Kill the
  API mid-backup and the archive is lost, with the row reading `failed`. A real
  queue — a worker, a lease, retry — is substantial machinery for a job an admin
  triggers by hand and nobody waits on. Marked with a `ponytail:` comment naming
  the ceiling and the upgrade path, so the next person knows it was a choice.
- **Status is stale until the admin refreshes.** There is no polling, by
  decision. The column is a record of what happened, not a live indicator, and
  the UI says so rather than implying progress it cannot show.
- **No retention cap.** Nothing prunes `data/backups/`. At ~12MB per archive
  this is the admin's disk to manage, and the list is the thing they manage it
  with. A cap wants a policy discussion this decision does not prejudge.
- **Two files per backup that can drift** if one is deleted by hand. Bounded by
  the `completed`-with-no-archive rule above rather than prevented.
- **`restore` now names three different operations** — restoring the whole
  instance from a backup, un-deleting one trashed item, and the per-row action
  this change adds. The collision is pre-existing (see ADR-0004) and is not made
  worse here, but it is now visible in one more place.

### When to revisit

- **If backups should happen without a human** — scheduled or on-write — the
  in-process promise is the first thing to replace, and the sidecar's `running`
  state is already the shape a queue needs.
- **If a second instance ever shares one `data/` directory**, the boot-time
  sweep becomes wrong: it would flip another live process's `running` row to
  `failed`. That assumption — one process owns the directory — is what makes the
  sweep exact rather than a heuristic.
- **If retention is wanted**, prune in `data/backups/` directly; nothing else
  needs to learn about it.

## Related

- `docs/superpowers/specs/2026-09-14-server-side-backups-design.md` — the full
  design this decision serves.
- `docs/superpowers/specs/2026-09-06-phase5-admin-backup-design.md` — the
  original feature; its archive layout and restore flow stand unchanged.
- ADR-0004 (`0004-trash-and-recoverable-deletion.md`) — already records that
  restoring an older backup resurrects trashed items; the same whole-file
  replacement is the reason for this ADR.
