import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button } from '../../ui'

// System-level admin actions: the search-index rebuild (FTS) and the thumbnail
// regeneration.
export function AdminSystemTab() {
  const { t } = useTranslation()
  const [result, setResult] = useState<number | null>(null)

  const rebuild = trpc.system.rebuildFts.useMutation({
    onSuccess: (data) => setResult(data.reindexed),
  })

  const run = () => {
    setResult(null)
    rebuild.mutate()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('admin.system.title')}</h2>

      <div className="flex flex-col gap-4 max-w-[30rem]">
        <Button
          type="button"
          variant="primary"
          onClick={run}
          disabled={rebuild.isPending}
          className="w-fit"
        >
          {t('admin.system.rebuildFts')}
        </Button>
        {result !== null && (
          <p role="status" data-testid="rebuild-count">
            {t('admin.system.rebuilt', { count: result })}
          </p>
        )}
        {rebuild.error && <p role="alert">{rebuild.error.message}</p>}
      </div>

      <ThumbnailsSection />
    </div>
  )
}

// The thumbnail run is a background job on the server: starting it returns at
// once, and the status is polled while it runs. Leaving the tab does not stop it,
// and coming back shows its progress or its last result.
function ThumbnailsSection() {
  const { t } = useTranslation()
  const utils = trpc.useUtils()
  const status = trpc.system.thumbnailsStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1000 : false),
  })
  const start = trpc.system.regenerateThumbnails.useMutation({
    // Seeding the cache with the running job is what switches the polling on.
    onSuccess: (job) => utils.system.thumbnailsStatus.setData(undefined, job),
  })
  const job = status.data
  const running = job?.status === 'running'

  return (
    <div className="flex flex-col gap-3 max-w-[40rem]">
      <h3 className="font-semibold">{t('admin.system.thumbnails.title')}</h3>
      <p className="text-sm text-text-muted">{t('admin.system.thumbnails.help')}</p>
      <Button
        type="button"
        variant="primary"
        onClick={() => start.mutate()}
        disabled={running || start.isPending}
        className="w-fit"
      >
        {t('admin.system.thumbnails.run')}
      </Button>

      {job?.status === 'running' && (
        <div className="flex flex-col gap-1" data-testid="thumbnails-progress">
          <progress value={job.done} max={job.total || 1} aria-label={t('admin.system.thumbnails.title')} className="w-full" />
          <p className="text-sm">{t('admin.system.thumbnails.progress', { done: job.done, total: job.total })}</p>
        </div>
      )}

      {job?.status === 'done' && (
        <div className="flex flex-col gap-1" data-testid="thumbnails-result">
          <p>{t('admin.system.thumbnails.result', { rewritten: job.rewritten, skipped: job.skippedCount, resized: job.resized })}</p>
          {job.skipped.length > 0 && (
            <ul className="text-sm text-text-muted list-disc pl-5">
              {job.skipped.map((s) => (
                <li key={s.path}>{s.path}: {s.reason}</li>
              ))}
              {job.skippedCount > job.skipped.length && (
                <li>{t('admin.system.thumbnails.more', { count: job.skippedCount - job.skipped.length })}</li>
              )}
            </ul>
          )}
        </div>
      )}

      {job?.status === 'failed' && <p role="alert">{t('admin.system.thumbnails.failed', { error: job.error })}</p>}
      {start.error && <p role="alert">{start.error.message}</p>}
    </div>
  )
}
