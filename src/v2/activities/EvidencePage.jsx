import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { downloadEvidenceCsv, getEvidence, localized, percent } from './api.js'

// Manager-only participation evidence: every learner in the Section, their attempts, and the
// attempt the activity's evidence policy counts.
export default function EvidencePage() {
  const { t, lang } = useI18n()
  const { sectionId, activityId } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setData(await getEvidence(activityId))
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [activityId])

  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  const { activity, students } = data
  const finishedCount = students.filter((s) => s.evidence).length
  const cell = (attempt) =>
    attempt ? (
      <Link to={`/v2/sections/${sectionId}/activities/attempts/${attempt.id}`}>{percent(attempt.scoreRatio)}</Link>
    ) : (
      <span className="is-muted">—</span>
    )

  return (
    <div>
      <Link to={`/v2/sections/${sectionId}/activities`} className="v2-subtext">← {t('activityBackToList')}</Link>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '8px 0 6px', flexWrap: 'wrap' }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{t('activityEvidenceHeading', { title: localized(activity.title, lang) })}</h1>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={() => downloadEvidenceCsv(activityId, `${activity.slug}-evidence.csv`)}>
          {t('exportCsvCta')}
        </button>
      </div>
      <p className="v2-subtext">
        {t('activityEvidenceSummary', { done: finishedCount, total: students.length })} · {t('activityEvidencePolicyLabel')}{' '}
        {t(`activityPolicy${activity.evidencePolicy[0].toUpperCase()}${activity.evidencePolicy.slice(1)}`)}
      </p>

      {students.length === 0 ? (
        <EmptyState icon="👥" heading={t('activityEvidenceEmpty')} body="" />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="v2-table">
            <thead>
              <tr>
                <th>{t('activityColLearner')}</th>
                <th>{t('activityColStudentId')}</th>
                <th>{t('activityColAttempts')}</th>
                <th>{t('activityColFirst')}</th>
                <th>{t('activityColBest')}</th>
                <th>{t('activityColLast')}</th>
                <th>{t('activityColEvidence')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.userId}>
                  <td>
                    <div>{s.displayName}</div>
                    <div className="is-muted">{s.email}</div>
                  </td>
                  <td>{s.studentId ?? <span className="is-muted">—</span>}</td>
                  <td>
                    {s.attempts}
                    {s.inProgress && <span className="v2-badge v2-badge-ta" style={{ marginLeft: 6 }}>{t('activityInProgress')}</span>}
                  </td>
                  <td>{cell(s.first)}{s.first?.finishedAt && <div className="is-muted">{new Date(s.first.finishedAt).toLocaleString()}</div>}</td>
                  <td>{cell(s.best)}</td>
                  <td>{cell(s.last)}</td>
                  <td style={{ fontWeight: 600 }}>{cell(s.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="v2-field-hint" style={{ marginTop: 12 }}>{t('activityEvidenceNote')}</p>
    </div>
  )
}
