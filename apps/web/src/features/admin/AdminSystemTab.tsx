import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import { Button } from '../../ui'

// System-level admin actions. Phase 5 ships the search-index rebuild (FTS).
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
    </div>
  )
}
