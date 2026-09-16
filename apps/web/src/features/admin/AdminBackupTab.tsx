import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Field, Input } from '../../ui'

type BackupPreview = {
  dbBytes: number
  uploadCount: number
  maxUploadMb: number
  userCount: number
  itemCount: number
}

type BackupStatus = 'running' | 'completed' | 'failed'

type BackupRow = {
  id: string
  status: BackupStatus
  createdAt: string
  error?: string
  sizeBytes: number | null
}

// Sizes and counts come back as bytes; the table shows MB (rounding to 1 KB
// below that, so a tiny instance does not read as "0 MB").
const formatSize = (bytes: number | null): string => {
  if (bytes === null) return '—'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Backup & restore. These are raw `fetch` endpoints (not tRPC):
//   POST   /backups              → { backup } — starts a server-side backup.
//   GET    /backups              → { backups }
//   GET    /backups/:id/download → the archive (navigated to, not fetched).
//   DELETE /backups/:id          → { ok: true }
//   POST   /backups/:id/restore  → { preview, restoreId } (non-destructive).
//   POST   /upload/backup        → multipart file → { preview, restoreId }.
//   POST   /backup/restore       → { restoreId } → { ok: true } (destructive).
export function AdminBackupTab() {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/backups')
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { backups: BackupRow[] }
      setBackups(data.backups)
    } catch {
      setError(t('admin.backup.loadFailed'))
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // No polling by design: the backup runs server-side and the admin refreshes
  // when they care. The message says so rather than implying live progress.
  const create = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/backups', { method: 'POST' })
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.started'))
      await load()
    } catch {
      setError(t('admin.backup.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  // A navigation, not a fetch: the endpoint sets `Content-Disposition`, so the
  // browser names and saves the file for us.
  const download = (row: BackupRow) => {
    const a = document.createElement('a')
    a.href = `/backups/${row.id}/download`
    a.click()
  }

  const remove = async (row: BackupRow) => {
    // Deleting removes the only copy of the archive, and the three row actions
    // sit adjacent — so a misclick aimed at Restore or Download can land here.
    // Same `window.confirm` the other destructive actions in this app use.
    if (!window.confirm(t('admin.backup.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/backups/${row.id}`, { method: 'DELETE' })
      // A `running` row is refused (409), which is not a failure: say so rather
      // than reporting that the delete failed when nothing did.
      if (res.status === 409) {
        setError(t('admin.backup.deleteInProgress'))
        return
      }
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.deleted'))
      await load()
    } catch {
      setError(t('admin.backup.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Non-destructive: opens the same preview card the upload path uses.
  const startRestore = async (row: BackupRow) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    setPreview(null)
    setRestoreId(null)
    try {
      const res = await fetch(`/backups/${row.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { preview: BackupPreview; restoreId: string }
      setPreview(data.preview)
      setRestoreId(data.restoreId)
    } catch {
      setError(t('admin.backup.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/upload/backup', { method: 'POST', body })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { preview: BackupPreview; restoreId: string }
      setPreview(data.preview)
      setRestoreId(data.restoreId)
    } catch {
      setError(t('admin.backup.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!restoreId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restoreId }),
      })
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.restored'))
      setPreview(null)
      setRestoreId(null)
    } catch {
      setError(t('admin.backup.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelRestore = () => {
    setPreview(null)
    setRestoreId(null)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('admin.backup.title')}</h2>

      <div className="flex flex-col gap-4 max-w-[40rem]">
        <Button type="button" variant="primary" onClick={() => void create()} disabled={busy} className="w-fit">
          {t('admin.backup.create')}
        </Button>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-border">
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.created')}</th>
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.status')}</th>
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.size')}</th>
              <th scope="col" className="py-2 font-semibold text-right">{t('admin.backup.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((row) => {
              // Only a completed backup has an archive to serve or apply.
              const ready = row.status === 'completed'
              return (
                <tr key={row.id} className="border-b border-border">
                  <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-2">
                    {t(`admin.backup.statusLabel.${row.status}`)}
                    {/* The sidecar records why a create failed (ADR-0006:
                        diagnosable failures are the point of the sidecar), so
                        show it — otherwise the admin has to read the server. */}
                    {row.error && <span className="block text-text-muted text-xs">{row.error}</span>}
                  </td>
                  <td className="py-2">{formatSize(row.sizeBytes)}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        className="text-accent underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => download(row)}
                        disabled={!ready || busy}
                      >
                        {t('admin.backup.download')}
                      </button>
                      <button
                        type="button"
                        className="text-accent underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void startRestore(row)}
                        disabled={!ready || busy}
                      >
                        {t('admin.backup.restore')}
                      </button>
                      <button
                        type="button"
                        className="text-danger underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void remove(row)}
                        disabled={busy}
                      >
                        {t('admin.backup.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {backups.length === 0 && <p className="text-text-muted">{t('admin.backup.empty')}</p>}

        <Field label={t('admin.backup.uploadLabel')} htmlFor="admin-backup-file">
          <Input
            id="admin-backup-file"
            type="file"
            accept=".tar.gz,application/gzip"
            onChange={(e) => void onFile(e)}
            disabled={busy}
          />
        </Field>

        {preview && (
          <Card>
            <p className="font-semibold">{t('admin.backup.preview')}</p>
            <p className="text-text-muted">
              {t('admin.backup.previewDetail', {
                users: preview.userCount,
                items: preview.itemCount,
                uploads: preview.uploadCount,
                mb: preview.maxUploadMb,
              })}
            </p>
            <p className="text-text-muted">{t('admin.backup.replaceWarning')}</p>
            <div className="flex gap-2 mt-2">
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmRestore()}
                disabled={busy || !restoreId}
              >
                {t('admin.backup.confirm')}
              </Button>
              <Button type="button" onClick={cancelRestore} disabled={busy}>
                {t('admin.backup.cancel')}
              </Button>
            </div>
          </Card>
        )}

        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  )
}
