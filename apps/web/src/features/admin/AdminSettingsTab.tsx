import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { trpc } from '../../api/trpc'
import type { DetectionProvider } from '@homebox/shared'

// Instance-wide settings: max upload size, detection provider, and the provider
// sub-options persisted into the free-form `detectionConfig` object. The concrete
// providers are wired in a later phase; here we edit + persist the config shape.
export function AdminSettingsTab() {
  const utils = trpc.useUtils()
  const { t } = useTranslation()
  const { data, isLoading } = trpc.instanceSettings.get.useQuery()
  const update = trpc.instanceSettings.update.useMutation()

  const [maxUploadMb, setMaxUploadMb] = useState(10)
  const [provider, setProvider] = useState<DetectionProvider>('google')
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    setMaxUploadMb(data.maxUploadMb)
    setProvider(data.detectionProvider)
    const config = (data.detectionConfig ?? {}) as Record<string, unknown>
    setModel(typeof config.model === 'string' ? config.model : '')
  }, [data])

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const detectionConfig = { model: model.trim() }
    await update.mutateAsync({ maxUploadMb, detectionProvider: provider, detectionConfig })
    setSaved(true)
    await utils.instanceSettings.get.invalidate()
  }

  if (isLoading) return <p>Loading…</p>

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('admin.settings.title')}</h2>

      <form className="flex flex-col gap-4 max-w-[30rem]" onSubmit={handleSave}>
        <div className="flex flex-col gap-1">
          <label htmlFor="admin-settings-max-upload">{t('admin.settings.maxUploadMb')}</label>
          <input
            id="admin-settings-max-upload"
            type="number"
            min={1}
            value={maxUploadMb}
            onChange={(e) => setMaxUploadMb(Number(e.target.value))}
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-text-muted">{t('admin.settings.detectionProvider')}</span>
          <div className="flex gap-4">
            {(['local', 'google', 'openai'] as DetectionProvider[]).map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="detectionProvider"
                  value={p}
                  checked={provider === p}
                  onChange={(e) => setProvider(e.target.value as DetectionProvider)}
                />
                {t(`admin.settings.provider.${p}`)}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="admin-settings-model">{t('admin.settings.model')}</label>
          <input
            id="admin-settings-model"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="px-2 py-1 border border-border rounded-md bg-surface text-text"
          />
        </div>

        <button
          type="submit"
          disabled={update.isPending}
          className="px-3 py-1.5 rounded-md border border-border bg-surface text-text w-fit"
        >
          {t('admin.settings.save')}
        </button>
        {saved && <p role="status">{t('admin.settings.saved')}</p>}
        {update.error && <p role="alert">{update.error.message}</p>}
      </form>
    </div>
  )
}
