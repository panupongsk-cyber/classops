import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { joinSection } from './api.js'

export default function JoinCodeModal({ onClose, onJoined }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await joinSection(code.trim())
      onJoined(result.sectionId)
    } catch {
      setError(t('joinInvalidCode'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(23,32,51,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
      <form onSubmit={handleSubmit} className="v2-card" style={{ width: 'min(90%, 380px)' }}>
        <h2 className="v2-h1">{t('joinModalHeading')}</h2>
        <p className="v2-subtext">{t('joinModalSubtext')}</p>
        <div className="v2-field">
          <label htmlFor="join-code-input">{t('joinCodeLabel')}</label>
          <input
            id="join-code-input"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
          {error && <p className="v2-field-error">{error}</p>}
        </div>
        <div className="v2-btn-row">
          <button type="button" className="v2-btn v2-btn-secondary" onClick={onClose}>{t('joinCancel')}</button>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={submitting || !code.trim()}>{t('joinConfirm')}</button>
        </div>
      </form>
    </div>
  )
}
