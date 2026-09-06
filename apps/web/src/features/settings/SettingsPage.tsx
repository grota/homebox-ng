import { useTranslation } from 'react-i18next'
import { useUserSettings } from '../../lib/settings/useUserSettings'
import { lightThemes, darkThemes } from '../../lib/theme/registry'
import { LOCALES } from '@homebox/shared'

// Curated locale labels used in the <select>. Each value is a valid `Intl` locale.
const localeOptions = LOCALES.map((l) => ({ value: l, label: l }))

export function SettingsPage() {
  const { t } = useTranslation()
  const { locale, themeMode, lightThemeId, darkThemeId, updateSettings, formatDate } = useUserSettings()

  const setLocale = (value: string) => updateSettings({ locale: value as (typeof LOCALES)[number] })
  const setThemeMode = (value: string) =>
    updateSettings({ themeMode: value as 'auto' | 'light' | 'dark' })
  const setLight = (value: string) => updateSettings({ lightThemeId: value })
  const setDark = (value: string) => updateSettings({ darkThemeId: value })

  return (
    <section className="flex flex-col gap-4 max-w-[32rem]">
      <h1 className="text-2xl">{t('settings.title')}</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-language">{t('settings.language')}</label>
        <select id="settings-language" value="en" disabled className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          <option value="en">English</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-locale">{t('settings.locale')}</label>
        <select id="settings-locale" value={locale} onChange={(e) => setLocale(e.target.value)} className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          {localeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-theme-mode">{t('settings.themeMode')}</label>
        <select id="settings-theme-mode" value={themeMode} onChange={(e) => setThemeMode(e.target.value)} className="px-2 py-1 border border-border rounded-md bg-surface text-text">
          <option value="auto">{t('settings.auto')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-light-palette">{t('settings.lightPalette')}</label>
        <select
          id="settings-light-palette"
          value={lightThemeId}
          onChange={(e) => setLight(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          {lightThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="settings-dark-palette">{t('settings.darkPalette')}</label>
        <select
          id="settings-dark-palette"
          value={darkThemeId}
          onChange={(e) => setDark(e.target.value)}
          className="px-2 py-1 border border-border rounded-md bg-surface text-text"
        >
          {darkThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </select>
      </div>

      {/* Live locale preview so changes take visible effect; also gives the e2e
          (Task 10) a localized date to assert on. */}
      <p className="text-text-muted" data-testid="locale-date">
        {t('settings.datePreview')}: {formatDate(new Date())}
      </p>
    </section>
  )
}
