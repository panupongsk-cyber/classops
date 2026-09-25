import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { applyGradebookSync, downloadEvidenceCsv, getEvidence, getGradebookSync, localized, percent } from './api.js'

// Manager-only participation evidence: every learner in the Section, their attempts, and the
// attempt the activity's evidence policy counts.
export default function EvidencePage() {
  const { t, lang } = useI18n()
  const { sectionId, activityId } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')

  // `silent` refreshes the table in place (after a gradebook sync) without unmounting the page.
  const load = useCallback(async (silent = false) => {
    if (!silent) setStatus('loading')
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
  if (status === 'error') return <RetryableError onRetry={() => load()} />

  const { activity, students } = data
  const finishedCount = students.filter((s) => s.evidence).length
  const cell = (attempt) =>
    attempt ? (
      <Link to={`/v2/sections/${sectionId}/activities/attempts/${attempt.id}`}>{percent(attempt.scoreRatio)}</Link>
    ) : (
      <span className="is-muted">—</span>
    )
  // The policy's evidence: one attempt (linked), or a mean over several (not one attempt).
  const evidenceCell = (evidence) => {
    if (!evidence) return <span className="is-muted">—</span>
    if (evidence.attemptId) return cell({ id: evidence.attemptId, scoreRatio: evidence.scoreRatio })
    return (
      <span>
        {percent(evidence.scoreRatio)}
        <div className="is-muted" style={{ fontWeight: 400 }}>{t('activityMeanOf', { n: evidence.attemptCount })}</div>
      </span>
    )
  }

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
                  <td style={{ fontWeight: 600 }}>{evidenceCell(s.evidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="v2-field-hint" style={{ marginTop: 12 }}>{t('activityEvidenceNote')}</p>
      <GradebookSyncPanel activity={activity} onSynced={() => load(true)} />
    </div>
  )
}

const SYNC_STATUSES = ['new', 'changed', 'manual', 'unchanged', 'no_attempt']

// Teacher-triggered gradebook sync: preview every learner, tick hand-edited cells to overwrite
// them, then confirm. The server recomputes on confirm with the same rules as the preview.
function GradebookSyncPanel({ activity, onSynced }) {
  const { t } = useI18n()
  const [plan, setPlan] = useState(null)
  const [overwrite, setOverwrite] = useState(() => new Set())
  const [state, setState] = useState('idle') // idle | loading | ready | applying | error
  const [written, setWritten] = useState(null)

  async function loadPreview() {
    setState('loading')
    setWritten(null)
    try {
      setPlan(await getGradebookSync(activity.id))
      setOverwrite(new Set())
      setState('ready')
    } catch {
      setState('error')
    }
  }

  async function confirm() {
    setState('applying')
    try {
      const result = await applyGradebookSync(activity.id, [...overwrite])
      setWritten(result.written.length)
      setPlan(await getGradebookSync(activity.id))
      setOverwrite(new Set())
      setState('ready')
      onSynced?.()
    } catch {
      setState('error')
    }
  }

  if (!activity.assignmentId) {
    return <div className="v2-notice v2-notice-info" style={{ marginTop: 16 }}>{t('activitySyncNotLinked')}</div>
  }

  const toWrite = plan ? plan.rows.filter((r) => r.status === 'new' || r.status === 'changed' || (r.status === 'manual' && overwrite.has(r.userId))).length : 0
  const points = (value) => (value === null || value === undefined ? '—' : value)

  return (
    <div className="v2-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem', margin: 0 }}>{t('activitySyncHeading')}</h2>
        <button type="button" className="v2-btn v2-btn-secondary" disabled={state === 'loading' || state === 'applying'} onClick={loadPreview}>
          {plan ? t('activitySyncRefresh') : t('activitySyncPreviewCta')}
        </button>
      </div>
      <p className="v2-field-hint">{t('activitySyncRules')}</p>
      {state === 'error' && <p className="v2-field-error">{t('genericError')}</p>}
      {written !== null && <div className="v2-notice v2-notice-info">{t('activitySyncDone', { n: written })}</div>}
      {plan && (
        <>
          <p className="v2-subtext">
            {t('activitySyncTarget', { name: plan.assignment.name, max: plan.assignment.maxPoints })} ·{' '}
            {SYNC_STATUSES.map((s) => `${t(`activitySyncStatus_${s}`)} ${plan.rows.filter((r) => r.status === s).length}`).join(' · ')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>{t('activityColLearner')}</th>
                  <th>{t('activitySyncColCurrent')}</th>
                  <th>{t('activitySyncColNew')}</th>
                  <th>{t('activitySyncColStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.displayName}{r.studentId && <div className="is-muted">{r.studentId}</div>}</td>
                    <td>{points(r.currentPoints)}</td>
                    <td>{points(r.newPoints)}</td>
                    <td>
                      {r.status === 'manual' ? (
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={overwrite.has(r.userId)}
                            onChange={(e) => {
                              const next = new Set(overwrite)
                              if (e.target.checked) next.add(r.userId)
                              else next.delete(r.userId)
                              setOverwrite(next)
                            }}
                          />
                          {t('activitySyncStatus_manual')} — {t('activitySyncOverwrite')}
                        </label>
                      ) : (
                        t(`activitySyncStatus_${r.status}`)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="v2-btn-row">
            <button type="button" className="v2-btn v2-btn-primary" disabled={toWrite === 0 || state === 'applying'} onClick={confirm}>
              {t('activitySyncConfirm', { n: toWrite })}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
