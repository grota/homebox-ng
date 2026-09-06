import { useContext, useMemo } from 'react'
import { SettingsContext } from './SettingsProvider'
import { createFormatters } from './format'

// The settings object plus locale-aware formatters bound to the user's `locale`.
// This is the canonical way consuming components read settings and format values.
export function useUserSettings() {
  const { settings, updateSettings } = useContext(SettingsContext)
  const formatters = useMemo(() => createFormatters(settings.locale), [settings.locale])
  return { ...settings, ...formatters, updateSettings }
}
