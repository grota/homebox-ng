import { useState } from 'react'
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

// Backup & restore. These are raw `fetch` endpoints (not tRPC):
//   GET /backup            → streamed archive; download as a Blob.
//   POST /upload/backup    → multipart file → { preview, restoreId }.
//   POST /backup/restore   → { restoreId } → { ok: true } (destructive).
export function AdminBackupTab() {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/backup')
      if (!res.ok) throw new Error('bad status')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'homebox-backup.tar.gz'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(t('admin.backup.downloadFailed'))
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

      <div className="flex flex-col gap-4 max-w-[30rem]">
        <Button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="w-fit"
        >
          {t('admin.backup.download')}
        </Button>

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
              <Button
                type="button"
                onClick={cancelRestore}
                disabled={busy}
              >
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
