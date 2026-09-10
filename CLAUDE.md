# homebox-ng

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `grota/homebox-ng`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles use the canonical vocabulary as-is (e.g. `needs-triage`, `ready-for-agent`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Planning a cross-cutting change

When a plan changes a pattern across the codebase, every file containing an instance of
that pattern must appear in some task's file list — and the verification step must be able
to find instances that carry **none** of the old pattern (a control with no classes at all
defeats a grep for old class strings). Before dispatching, enumerate the files by searching
for the *thing* being converted, not for the strings being removed.
