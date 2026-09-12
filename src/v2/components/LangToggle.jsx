import { useI18n } from '../i18n/I18nContext.jsx'

export default function LangToggle() {
  const { lang, setLang } = useI18n()
  return (
    <div className="v2-lang-toggle">
      <button type="button" className={lang === 'th' ? 'is-active' : ''} onClick={() => setLang('th')}>TH</button>
      <button type="button" className={lang === 'en' ? 'is-active' : ''} onClick={() => setLang('en')}>EN</button>
    </div>
  )
}
