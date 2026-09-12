import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ApiError } from '../auth/api.js'
import { listPicks, pickStudent } from './api.js'

const panelStyle = { width: '100%', maxWidth: 500, background: 'rgba(255,255,255,.06)', borderRadius: 16, padding: 20, marginTop: 24 }
const btnStyle = { padding: '10px 20px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer' }

export default function RandomPickerPanel({ sessionId }) {
  const { t } = useI18n()
  const [picked, setPicked] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)
  const [picking, setPicking] = useState(false)

  const loadHistory = useCallback(async () => {
    const result = await listPicks(sessionId)
    setHistory(result.picks)
  }, [sessionId])

  useEffect(() => { loadHistory() }, [loadHistory])

  async function handlePick() {
    setPicking(true)
    setError(null)
    try {
      const result = await pickStudent(sessionId)
      setPicked(result.picked)
      await loadHistory()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_ELIGIBLE_STUDENTS') setError(t('noEligibleStudents'))
      else setError(t('genericError'))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('randomPickerHeading')}</div>
      <button type="button" style={btnStyle} onClick={handlePick} disabled={picking}>{t('pickStudentCta')}</button>

      {error && <p style={{ color: '#f87171', fontSize: '.85rem', marginTop: 12 }}>{error}</p>}
      {picked && !error && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: '.8rem', color: '#94a3b8' }}>{t('pickedStudentLabel')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{picked.displayName}</div>
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,.15)' }}>
        <div style={{ fontSize: '.8rem', color: '#94a3b8', marginBottom: 8 }}>{t('pickHistoryHeading')}</div>
        {history.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '.85rem' }}>{t('pickHistoryEmpty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {history.map((pick, index) => (
              <div key={`${pick.user_id}-${pick.picked_at}`} style={{ fontSize: '.85rem', display: 'flex', justifyContent: 'space-between' }}>
                <span>{history.length - index}. {pick.display_name}</span>
                <span style={{ color: '#64748b' }}>{new Date(pick.picked_at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
