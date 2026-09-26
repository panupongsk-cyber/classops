import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import GradebookSyncPanel from '../components/GradebookSyncPanel.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { listAssignments as listGradebookAssignments } from '../gradebook/api.js'
import { useI18n } from '../i18n/I18nContext.jsx'
import { applyAssignmentSync, downloadAssignmentCsv, getAssignmentResults, getAssignmentSync, updateAssignment } from './api.js'

// Staff results for one practice assignment (PS-TASK-20260926-789): completion, the score under
// the evidence policy and its spread, each learner's latest result by field, item analysis, a CSV
// export, and (owner/teacher) the opt-in gradebook link and teacher-triggered sync.
const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 1000) / 10}%`)

export default function PracticeResultsPage() {
  const { t } = useI18n()
  const { sectionId, assignmentId } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [cells, setCells] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setStatus('loading')
    try {
      const result = await getAssignmentResults(assignmentId)
      setData(result)
      if (result.canSync) listGradebookAssignments(sectionId).then((r) => setCells(r.assignments)).catch(() => setCells([]))
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [assignmentId, sectionId])
  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={() => load()} />

  const { assignment, summary, learners, items } = data
  const peak = Math.max(1, ...summary.distribution.map((b) => b.count))

  async function link(value) {
    setError(null)
    try {
      await updateAssignment(assignment.id, { gradebookAssignmentId: value || null })
      await load(true)
    } catch {
      setError(t('genericError'))
    }
  }

  return (
    <div className="v2-content-narrow" style={{ maxWidth: 820 }}>
      <Link to={`/v2/sections/${sectionId}/practice/assignments`} className="v2-subtext">← {t('assignBack')}</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '8px 0 14px' }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{t('resultsTitle', { title: assignment.title })}</h1>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={() => downloadAssignmentCsv(assignment.id, `${assignment.title}.csv`).catch(() => setError(t('genericError')))}>
          {t('resultsCsv')}
        </button>
      </div>
      {error && <div className="v2-notice v2-notice-error">{error}</div>}

      <div className="v2-stats-grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="v2-stat-card">
          <div className="v2-stat-title">{t('resultsSubmitted')}</div>
          <div className="v2-stat-value">{summary.submitted}/{summary.learners}</div>
          <div className="v2-stat-hint">{t('resultsProgressHint', { inProgress: summary.inProgress, notStarted: summary.notStarted })}</div>
        </div>
        <div className="v2-stat-card">
          <div className="v2-stat-title">{t('resultsMean')}</div>
          <div className="v2-stat-value">{pct(summary.mean)}</div>
          <div className="v2-stat-hint">{t('resultsMedian', { median: pct(summary.median), policy: t(`assignPolicy_${assignment.evidencePolicy}`) })}</div>
        </div>
      </div>

      <div className="v2-card" style={{ marginBottom: 16 }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('resultsDistribution')}</h2>
        <div className="v2-histogram" role="img" aria-label={t('resultsDistribution')}>
          {summary.distribution.map((b) => (
            <div key={b.from} className="v2-histogram-col">
              <div className="v2-histogram-count">{b.count || ''}</div>
              <div className="v2-histogram-bar" style={{ height: `${(b.count / peak) * 100}%` }} />
              <div className="v2-histogram-label">{Math.round(b.from * 100)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="v2-card" style={{ marginBottom: 16 }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('resultsLearners')}</h2>
        <table className="v2-table">
          <thead>
            <tr><th>{t('activityColLearner')}</th><th>{t('resultsColStatus')}</th><th>{t('resultsColScore', { policy: t(`assignPolicy_${assignment.evidencePolicy}`) })}</th><th>{t('resultsColFields')}</th></tr>
          </thead>
          <tbody>
            {learners.map((l) => (
              <tr key={l.userId}>
                <td>{l.displayName}{l.studentId && <div className="is-muted">{l.studentId}</div>}</td>
                <td>{t(`resultsStatus_${l.status}`)}{l.attempts > 1 ? ` · ${t('resultsAttempts', { n: l.attempts })}` : ''}</td>
                <td>{l.evidenceAttemptId ? <Link to={`/v2/sections/${sectionId}/practice/attempts/${l.evidenceAttemptId}`}>{pct(l.evidenceRatio)}</Link> : pct(l.evidenceRatio)}</td>
                <td className="is-muted">{l.fields.map((f) => `${f.field.slice(0, 4)} ${f.correct}/${f.questions}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="v2-card" style={{ marginBottom: 16 }}>
        <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('resultsItems')}</h2>
        <p className="v2-field-hint" style={{ marginTop: 0 }}>{t('resultsItemsHint')}</p>
        {items.length === 0 ? <p className="v2-subtext">{t('resultsNoItems')}</p> : (
          <div className="v2-mastery">
            {items.map((i) => (
              <div key={i.questionId} className="v2-mastery-row">
                <div className="v2-mastery-label">{i.examContentId} · Q{i.seq} · {i.category}</div>
                <div className="v2-mastery-bar" aria-hidden="true"><div style={{ width: `${i.attempts ? (i.correct / i.attempts) * 100 : 0}%` }} /></div>
                <div className="v2-mastery-value">{pct(i.attempts ? i.correct / i.attempts : null)} <span className="is-muted">({i.correct}/{i.attempts})</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.canSync && (
        <>
          <div className="v2-card">
            <label className="v2-inline-field">{t('activityGradebookLinkLabel')}
              <select value={assignment.gradebookAssignmentId ?? ''} disabled={cells === null} onChange={(e) => link(e.target.value)}>
                <option value="">{t('activityGradebookNotLinked')}</option>
                {(cells ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({Number(c.max_points)})</option>)}
              </select>
            </label>
          </div>
          <GradebookSyncPanel
            linked={Boolean(assignment.gradebookAssignmentId)}
            loadPlan={() => getAssignmentSync(assignment.id)}
            applyPlan={(ids) => applyAssignmentSync(assignment.id, ids)}
            onSynced={() => load(true)}
            notLinkedText={t('assignSyncNotLinked')}
            rulesText={t('assignSyncRules', { policy: t(`assignPolicy_${assignment.evidencePolicy}`) })}
          />
        </>
      )}
    </div>
  )
}
