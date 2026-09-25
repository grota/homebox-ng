import { useContext, useMemo } from 'react'
import { SettingsContext } from './SettingsProvider'
import { createFormatters } from './format'

// The settings object plus locale-aware formatters bound to the user's `locale`.
// This is the canonical way consuming components read settings and format values.
//
// Two extras ride along for their one consumer each: `setPreview`, and
// `storedSettings` (the values as stored, without a preview) for the settings
// page, which must not mistake a preview for a write.
export function useUserSettings() {
  const { settings, storedSettings, updateSettings, setPreview } = useContext(SettingsContext)
  const formatters = useMemo(() => createFormatters(settings.locale), [settings.locale])
  return { ...settings, ...formatters, updateSettings, setPreview, storedSettings }
}

// Whether to go ahead with a move-to-trash, asking the page's own question only
// if the user asked to be asked. Every move-to-trash in the app routes through
// this, because the rule is the *setting* — five call sites each writing their
// own `if (confirmTrash && …)` is how they drift apart on it.
//
// The message is the caller's, not this hook's: what is being trashed differs
// (a selection, a draft, one item) and the wording differs with it.
export function useTrashConfirmation() {
  const { confirmTrash } = useUserSettings()
  return (message: string): boolean => !confirmTrash || confirm(message)
}
