import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import admin from './locales/en/admin.json'
import auth from './locales/en/auth.json'
import baseline from './locales/en/baseline.json'
import common from './locales/en/common.json'
import conversation from './locales/en/conversation.json'
import errors from './locales/en/errors.json'
import exceptions from './locales/en/exceptions.json'
import configuration from './locales/en/configuration.json'
import masterData from './locales/en/masterData.json'
import objectivePolicy from './locales/en/objectivePolicy.json'
import scheduling from './locales/en/scheduling.json'
import scorecard from './locales/en/scorecard.json'
import whatif from './locales/en/whatif.json'
import workforce from './locales/en/workforce.json'
import workList from './locales/en/workList.json'

/**
 * i18n (UI-ARCHITECTURE.md §9). All user-facing copy goes through here.
 * errors.json mirrors the API's error codes — resolve a message with
 * getApiErrorCode(err) → t(`errors:${code}`). initI18n() is idempotent.
 */
export const resources = { en: { common, auth, errors, admin, masterData, scheduling, scorecard, workforce, workList, exceptions, objectivePolicy, configuration, whatif, baseline, conversation } } as const
export const defaultNS = 'common'

export function initI18n(): typeof i18next {
  if (i18next.isInitialized) return i18next
  void i18next.use(initReactI18next).init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    defaultNS,
    ns: ['common', 'auth', 'errors', 'admin', 'masterData', 'scheduling', 'scorecard', 'workforce', 'workList', 'exceptions', 'objectivePolicy', 'configuration', 'whatif', 'baseline', 'conversation'],
    interpolation: { escapeValue: false },
  })
  return i18next
}

/**
 * Resolve a backend-supplied i18n key of the form `namespace.path.to.key` (e.g.
 * `whatif.factorLabel.lateness`, `baseline.frozenLabel`) — the first dotted segment
 * is the namespace, the rest the nested key. Used for the structured rationale /
 * baseline keys the API emits.
 */
export function resolveKey(key: string, params?: Record<string, unknown>): string {
  const [ns, ...rest] = key.split('.')
  return i18next.t(rest.join('.'), { ns, ...params })
}

export { useTranslation } from 'react-i18next'

/** Resolve an API error code (from getApiErrorCode) to a localized message. */
export function translateError(code: string | null): string {
  return i18next.t(code ?? 'GENERIC', {
    ns: 'errors',
    defaultValue: i18next.t('GENERIC', { ns: 'errors' }),
  })
}
