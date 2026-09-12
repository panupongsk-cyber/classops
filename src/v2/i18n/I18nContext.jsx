import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { t as translate } from './translations.js'

const STORAGE_KEY = 'classops_v2_lang'
const I18nContext = createContext(null)

function readStoredLang() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'en' ? 'en' : 'th'
  } catch {
    return 'th'
  }
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang)

  const setLang = useCallback((next) => {
    const value = next === 'en' ? 'en' : 'th'
    setLangState(value)
    try {
      window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Client-side persistence is a convenience, not a requirement -- ignore a blocked store.
    }
  }, [])

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (key, values) => translate(lang, key, values),
  }), [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
