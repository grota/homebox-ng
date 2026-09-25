import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUserSettings } from '../../lib/settings/useUserSettings'
import { lightThemes, darkThemes } from '../../lib/theme/registry'
import { ITEM_SORT_OPTIONS } from '../../lib/itemSort'
import {
  ITEMS_PER_PAGE_MAX,
  ITEMS_PER_PAGE_MIN,
  LOCALES,
  type ItemSortPreference,
  type Locale,
  type ThemeMode,
} from '@homebox/shared'
import { Button, Field, Input, Select } from '../../ui'

// Curated locale labels used in the <select>. Each value is a valid `Intl` locale.
const localeOptions = LOCALES.map((l) => ({ value: l, label: l }))

// The fields this page owns, as the form holds them. `itemsPerPage` is the odd one
// out: a number in the DTO, but a *string* here, because the input can hold "" and
// a half-typed "5" on the way to "50", neither of which is a number.
type Draft = {
  locale: Locale
  themeMode: ThemeMode
  lightThemeId: string
  darkThemeId: string
  itemsSort: ItemSortPreference
  itemsPerPage: string
  confirmTrash: boolean
}

// A form rather than a row of controls that each write as they change. One Save is
// easier to reason about, and it is what makes the theme preview possible: with
// per-control writes, changing a `<select>` *is* the commit, so there is nothing
// left to preview.
export function SettingsPage() {
  const { t } = useTranslation()
  const {
    // Deliberately `storedSettings`, not the four fields below: `useUserSettings`
    // returns the *previewed* settings, and seeding the draft from those makes a
    // preview look like a write — which is how toggling the preview off quietly
    // threw away whatever the form was holding.
    storedSettings,
    updateSettings,
    setPreview,
    formatDate,
  } = useUserSettings()
  const { locale, themeMode, lightThemeId, darkThemeId, itemsSort, itemsPerPage, confirmTrash } = storedSettings

  // What the server holds, in the form's shape. Recomputed each render (cheap) and
  // used for both the initial draft and the "has anything changed" test.
  const stored: Draft = {
    locale,
    themeMode,
    lightThemeId,
    darkThemeId,
    itemsSort,
    itemsPerPage: String(itemsPerPage),
    confirmTrash,
  }

  const [draft, setDraft] = useState<Draft>(stored)
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  // Re-seed the draft when the *stored* settings change: on first load (`settings.get`
  // resolves after mount, so the draft starts on the spec defaults), and after a
  // save. Keyed on the values rather than the object, so an unchanged refetch does
  // not throw away what is being typed.
  useEffect(() => {
    setDraft(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, themeMode, lightThemeId, darkThemeId, itemsSort, itemsPerPage, confirmTrash])

  // A page size the API would reject is not offered: the button that would send it
  // is disabled, so nothing is coerced behind the user's back. `min`/`max` on the
  // input bound the spinner, not the keyboard.
  const perPage = Number(draft.itemsPerPage)
  const perPageValid =
    draft.itemsPerPage.trim() !== '' &&
    Number.isInteger(perPage) &&
    perPage >= ITEMS_PER_PAGE_MIN &&
    perPage <= ITEMS_PER_PAGE_MAX

  const dirty = (Object.keys(stored) as (keyof Draft)[]).some((key) => stored[key] !== draft[key])

  const save = () => {
    // The whole set rather than a diff: the write is a partial merge, so a field
    // that did not change is a no-op, and a diff would have to track which control
    // was touched to get the same result.
    void updateSettings({
      locale: draft.locale,
      themeMode: draft.themeMode,
      lightThemeId: draft.lightThemeId,
      darkThemeId: draft.darkThemeId,
      itemsSort: draft.itemsSort,
      itemsPerPage: perPage,
      confirmTrash: draft.confirmTrash,
    })
    // A preview stands in for the stored value; once that value is stored it would
    // otherwise go on overriding it.
    setPreview(null)
    setPreviewing(false)
  }

  // The theme is the one control with something to look at, and under one Save it
  // would do nothing until committed. `Preview` pushes the drafted theme into the
  // provider without writing it; pressing it again, or saving, drops it.
  const [previewing, setPreviewing] = useState(false)
  const togglePreview = () => {
    if (previewing) {
      setPreview(null)
      setPreviewing(false)
      return
    }
    setPreview({ themeMode: draft.themeMode, lightThemeId: draft.lightThemeId, darkThemeId: draft.darkThemeId })
    setPreviewing(true)
  }

  // Leaving the page drops a preview: it describes settings that were never stored,
  // and the pages you land on have no way to know they are looking at one.
  useEffect(() => () => setPreview(null), [setPreview])

  return (
    <section className="flex flex-col gap-4 max-w-[32rem] mx-auto">
      <h1>{t('settings.title')}</h1>

      <Field label={t('settings.language')} htmlFor="settings-language">
        <Select id="settings-language" value="en" disabled>
          <option value="en">English</option>
        </Select>
      </Field>

      <Field label={t('settings.locale')} htmlFor="settings-locale">
        <Select
          id="settings-locale"
          value={draft.locale}
          onChange={(e) => edit('locale', e.target.value as Locale)}
        >
          {localeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      <Field label={t('settings.themeMode')} htmlFor="settings-theme-mode">
        <Select
          id="settings-theme-mode"
          value={draft.themeMode}
          onChange={(e) => edit('themeMode', e.target.value as ThemeMode)}
        >
          <option value="auto">{t('settings.auto')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </Select>
      </Field>

      <Field label={t('settings.lightPalette')} htmlFor="settings-light-palette">
        <Select
          id="settings-light-palette"
          value={draft.lightThemeId}
          onChange={(e) => edit('lightThemeId', e.target.value)}
        >
          {lightThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </Select>
      </Field>

      <Field label={t('settings.darkPalette')} htmlFor="settings-dark-palette">
        <Select
          id="settings-dark-palette"
          value={draft.darkThemeId}
          onChange={(e) => edit('darkThemeId', e.target.value)}
        >
          {darkThemes.map((th) => (
            <option key={th.id} value={th.id}>{th.name}</option>
          ))}
        </Select>
      </Field>

      {/* Sits under the three controls it applies to, which are the ones with
          something to look at. A toggle, so it says which state it is in — the
          same accent-as-on convention the catalog's toggles use. */}
      <Button
        size="sm"
        className="self-start"
        variant={previewing ? 'primary' : 'secondary'}
        aria-pressed={previewing}
        onClick={togglePreview}
      >
        {t('settings.previewTheme')}
      </Button>

      {/* The catalog list's order. `relevance` is absent: it is a consequence of
          searching rather than something to store. */}
      <Field label={t('settings.itemsSort')} htmlFor="settings-items-sort">
        <Select
          id="settings-items-sort"
          value={draft.itemsSort}
          onChange={(e) => edit('itemsSort', e.target.value as ItemSortPreference)}
        >
          {ITEM_SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>

      {/* How many rows a page of a paged list holds — the catalog, the drafts, the
          trash. Bounded by `ITEMS_PER_PAGE_*` in `@homebox/shared`, which is also
          what the list procedures accept, so the stored value and the wire agree. */}
      <Field label={t('settings.itemsPerPage')} htmlFor="settings-items-per-page">
        <Input
          id="settings-items-per-page"
          type="number"
          min={ITEMS_PER_PAGE_MIN}
          max={ITEMS_PER_PAGE_MAX}
          value={draft.itemsPerPage}
          onChange={(e) => edit('itemsPerPage', e.target.value)}
        />
      </Field>

      {/* Whether the app asks before moving something to the trash. It governs
          *every* move-to-trash — the catalog's selection, a draft, one item —
          which is why it is here rather than beside any one of those buttons.
          Purging the trash still always asks: that one cannot be undone. */}
      <Field label={t('settings.confirmTrash')} htmlFor="settings-confirm-trash">
        <input
          id="settings-confirm-trash"
          type="checkbox"
          className="self-start"
          checked={draft.confirmTrash}
          onChange={(e) => edit('confirmTrash', e.target.checked)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button disabled={!dirty || !perPageValid} onClick={save}>
          {t('settings.save')}
        </Button>
        {/* Disabled with no reason given is a dead end, so the one field that can
            hold something unsendable says what it wants. */}
        {!perPageValid && (
          <span className="text-sm text-danger">
            {t('settings.itemsPerPageRange', { min: ITEMS_PER_PAGE_MIN, max: ITEMS_PER_PAGE_MAX })}
          </span>
        )}
      </div>

      {/* Live locale preview so changes take visible effect; also gives the e2e
          (Task 10) a localized date to assert on. It follows the *stored* locale,
          not the draft: the theme preview above is the one control that shows an
          unstored value, and it says so by staying pressed. */}
      <p className="text-text-muted" data-testid="locale-date">
        {t('settings.datePreview')}: {formatDate(new Date())}
      </p>

      {/* Which build this is. The release image bakes its git tag in at build
          time as `VITE_APP_VERSION` (see the Dockerfile's `APP_VERSION`), so a
          running instance can answer "what am I running?" without anyone reading
          image labels off the host. Small, and last on purpose: it answers a
          question, it is not a control. A source checkout says `dev`. */}
      <p className="text-xs text-text-muted" data-testid="app-version">
        {t('settings.version')}: {import.meta.env.VITE_APP_VERSION ?? 'dev'}
      </p>
    </section>
  )
}
