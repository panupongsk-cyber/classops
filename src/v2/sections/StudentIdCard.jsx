import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { getMyStudentId, setMyStudentId } from './api.js'

const STUDENT_ID_RE = /^[0-9A-Za-z-]{1,32}$/

// The learner's own student ID for this Section. It labels their activity evidence for staff;
// classmates never see it.
export default function StudentIdCard({ sectionId }) {
  const { t } = useI18n()
  const [saved, setSaved] = useState(undefined) // undefined = loading
  const [value, setValue] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMyStudentId(sectionId)
      .then((r) => { if (!cancelled) { setSaved(r.studentId); setValue(r.studentId ?? '') } })
      .catch(() => { if (!cancelled) setSaved(null) })
    return () => { cancelled = true }
  }, [sectionId])

  const trimmed = value.trim()
  const valid = trimmed === '' || STUDENT_ID_RE.test(trimmed)

  async function handleSave(event) {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setMessage(null)
    try {
      const r = await setMyStudentId(sectionId, trimmed === '' ? null : trimmed)
      setSaved(r.studentId)
      setMessage(t('studentIdSaved'))
    } catch {
      setMessage(t('studentIdSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (saved === undefined) return null
  return (
    <form className="v2-card" style={{ marginBottom: 14 }} onSubmit={handleSave}>
      <div className="v2-field" style={{ marginBottom: 8 }}>
        <label htmlFor="student-id-input">{t('studentIdLabel')}</label>
        <div className="v2-invite-row" style={{ marginBottom: 0 }}>
          <input id="student-id-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('studentIdPlaceholder')} maxLength={32} />
          <button type="submit" className="v2-btn v2-btn-secondary" disabled={busy || !valid || trimmed === (saved ?? '')}>{t('studentIdSave')}</button>
        </div>
        {!valid && <p className="v2-field-error">{t('studentIdInvalid')}</p>}
        <p className="v2-field-hint">{saved ? t('studentIdHint') : t('studentIdMissingHint')}</p>
        {message && <p className="v2-field-hint" role="status">{message}</p>}
      </div>
    </form>
  )
}
