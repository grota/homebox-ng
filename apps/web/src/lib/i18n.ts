import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../public/locales/en/translation.json'
import admin from '../../public/locales/en/admin.json'

// English ships in Phase 4; adding a language later is a resources entry + a
// `LANGUAGES` registry entry (no code change elsewhere).
//
// `admin.json` (Phase 5) is merged NESTED under `nav` so its `nav.admin` entry
// augments the existing nav keys rather than replacing the whole `nav` block.
void i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: { ...en, ...admin, nav: { ...en.nav, ...admin.nav } },
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
