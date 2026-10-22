import { useState } from 'react'
import { ApiError } from '../auth/api.js'
import { useI18n } from '../i18n/I18nContext.jsx'
import { setPracticeEnabled } from './api.js'

// A Section's ITPE IP practice on/off state for staff (#1995). Owner, teacher, and platform admin
// get the switch; a TA sees the state with a note instead of a button the API would refuse.
// Shown on the Practice page and on the Section page, so the switch is findable from either.
export default function PracticeSwitch({ sectionId, enabled, canToggle, onChanged, children }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await setPracticeEnabled(sectionId, !enabled)
      await onChanged?.()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403 ? t('practiceToggleForbidden') : t('genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`v2-notice ${enabled ? 'v2-notice-info' : 'v2-notice-error'}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>
        {enabled ? t('practiceEnabledForStudents') : t('practiceDisabledForStudents')}
        {children}
        {error && <span className="v2-field-error" style={{ display: 'block', margin: '4px 0 0' }}>{error}</span>}
      </span>
      {canToggle
        ? <button type="button" className="v2-btn-sm v2-btn-outline" onClick={toggle} disabled={busy}>{enabled ? t('practiceDisable') : t('practiceEnable')}</button>
        : <span style={{ fontSize: '.75rem', color: 'var(--v2-ink-muted)', maxWidth: 220 }}>{t('practiceToggleOwnerOnly')}</span>}
    </div>
  )
}
