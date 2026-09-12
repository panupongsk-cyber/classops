import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import { bulkSetScores, getAssignmentScores, getGradebook } from './api.js'

export default function AssignmentScoresPage() {
  const { t } = useI18n()
  const { sectionId, assignmentId } = useParams()
  const navigate = useNavigate()

  const [students, setStudents] = useState(null)
  const [values, setValues] = useState({})
  const [status, setStatus] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [gradebookResult, scoresResult] = await Promise.all([
        getGradebook(sectionId), getAssignmentScores(assignmentId),
      ])
      setStudents(gradebookResult.students)
      const initial = {}
      for (const score of scoresResult.scores) initial[score.user_id] = String(score.points_earned)
      setValues(initial)
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [sectionId, assignmentId])

  useEffect(() => { load() }, [load])

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const scores = Object.entries(values)
        .filter(([, value]) => value !== '')
        .map(([userId, value]) => ({ userId, pointsEarned: Number(value) }))
      if (scores.length > 0) await bulkSetScores(assignmentId, scores)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  return (
    <div className="v2-content-narrow">
      <h1 className="v2-h1">{t('scoresPageHeading')}</h1>
      <form onSubmit={handleSave}>
        <table className="v2-table" style={{ marginBottom: 16 }}>
          <thead>
            <tr>
              <th>{t('colName')}</th>
              <th>{t('pointsEarnedLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.userId}>
                <td>{student.displayName}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={values[student.userId] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [student.userId]: e.target.value }))}
                    style={{ width: 100, padding: '6px 10px', border: '1px solid var(--v2-border-strong)', borderRadius: 8 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {saved && <p style={{ fontSize: '.82rem', color: 'var(--v2-ink-muted)', margin: '0 0 12px' }}>{t('scoresSaved')}</p>}
        <div className="v2-btn-row">
          <button type="button" className="v2-btn v2-btn-secondary" onClick={() => navigate(`/v2/sections/${sectionId}/gradebook`)}>{t('cancel')}</button>
          <button type="submit" className="v2-btn v2-btn-primary" disabled={saving}>{t('saveScores')}</button>
        </div>
      </form>
    </div>
  )
}
