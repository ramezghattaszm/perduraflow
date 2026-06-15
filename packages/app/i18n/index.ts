import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import admin from './locales/en/admin.json'
import auth from './locales/en/auth.json'
import common from './locales/en/common.json'
import errors from './locales/en/errors.json'
import masterData from './locales/en/masterData.json'
import scheduling from './locales/en/scheduling.json'

/**
 * i18n (UI-ARCHITECTURE.md §9). All user-facing copy goes through here.
 * errors.json mirrors the API's error codes — resolve a message with
 * getApiErrorCode(err) → t(`errors:${code}`). initI18n() is idempotent.
 */
export const resources = { en: { common, auth, errors, admin, masterData, scheduling } } as const
export const defaultNS = 'common'

export function initI18n(): typeof i18next {
  if (i18next.isInitialized) return i18next
  void i18next.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    defaultNS,
    ns: ['common', 'auth', 'errors', 'admin', 'masterData', 'scheduling'],
    interpolation: { escapeValue: false },
  })
  return i18next
}

export { useTranslation } from 'react-i18next'

/** Resolve an API error code (from getApiErrorCode) to a localized message. */
export function translateError(code: string | null): string {
  return i18next.t(code ?? 'GENERIC', {
    ns: 'errors',
    defaultValue: i18next.t('GENERIC', { ns: 'errors' }),
  })
}
