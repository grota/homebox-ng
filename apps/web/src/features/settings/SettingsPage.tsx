import { useTranslation } from 'react-i18next'
import { useUserSettings } from '../../lib/settings/useUserSettings'
import { lightThemes, darkThemes } from '../../lib/theme/registry'
import { LOCALES } from '@homebox/shared'
import { Field, Select } from '../../ui'

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
      <h1>{t('settings.title')}</h1>

      <Field label={t('settings.language')} htmlFor="settings-language">
        <Select id="settings-language" value="en" disabled>
          <option value="en">English</option>
        </Select>
      </Field>

      <Field label={t('settings.locale')} htmlFor="settings-locale">
        <Select id="settings-locale" value={locale} onChange={(e) => setLocale(e.target.value)}>
          {localeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <Field label={t('settings.themeMode')} htmlFor="settings-theme-mode">
        <Select id="settings-theme-mode" value={themeMode} onChange={(e) => setThemeMode(e.target.value)}>
          <option value="auto">{t('settings.auto')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </Select>
      </Field>

      <Field label={t('settings.lightPalette')} htmlFor="settings-light-palette">
        <Select
          id="settings-light-palette"
          value={lightThemeId}
          onChange={(e) => setLight(e.target.value)}
        >
          {lightThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </Select>
      </Field>

      <Field label={t('settings.darkPalette')} htmlFor="settings-dark-palette">
        <Select
          id="settings-dark-palette"
          value={darkThemeId}
          onChange={(e) => setDark(e.target.value)}
        >
          {darkThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </Select>
      </Field>

      {/* Live locale preview so changes take visible effect; also gives the e2e
          (Task 10) a localized date to assert on. */}
      <p className="text-text-muted" data-testid="locale-date">
        {t('settings.datePreview')}: {formatDate(new Date())}
      </p>
    </section>
  )
}
