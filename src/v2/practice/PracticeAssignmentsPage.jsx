import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../auth/api.js'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import { createAssignment, deleteAssignment, listAssignments, listExams, startAssignment, updateAssignment } from './api.js'

// Practice assignments (PS-TASK-20260926-785). Learners see the open and closed ones with their
// own attempts; staff also create them and open, close, or re-date them. An assignment is always
// taken exam-style (routes/practice.ts attempt pages).
// Known error codes have their own message; anything else (a 429, a network error) falls back.
function errorText(t, err) {
  if (!(err instanceof ApiError)) return t('genericError')
  const key = `assignError_${err.code}`
  const text = t(key)
  return text === key ? t('genericError') : text
}
const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 1000) / 10}%`)
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

function statusOf(a, t) {
  if (a.status === 'draft') return { cls: 'v2-badge-student', text: t('assignStatusDraft') }
  if (a.status === 'closed' || (a.dueAt && new Date(a.dueAt) <= new Date())) return { cls: 'v2-badge-suspended', text: t('assignStatusClosed') }
  if (a.opensAt && new Date(a.opensAt) > new Date()) return { cls: 'v2-badge-ta', text: t('assignStatusScheduled') }
  return { cls: 'v2-badge-active', text: t('assignStatusOpen') }
}

function CreateForm({ sectionId, exams, onCreated }) {
  const { t } = useI18n()
  const [form, setForm] = useState({ title: '', kind: 'exam', examId: exams[0]?.id ?? '', category: '', count: 20, timed: true, minutes: '', opensAt: '', dueAt: '', maxAttempts: 1, evidencePolicy: 'best', reviewPolicy: 'after_due' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const exam = exams.find((e) => e.id === form.examId)
  const categories = exam?.categories ?? exams[0]?.categories ?? []

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createAssignment(sectionId, {
        title: form.title,
        kind: form.kind,
        examId: form.examId === 'all' ? null : form.examId || null,
        category: form.kind === 'set' && form.category ? form.category : null,
        count: Number(form.count),
        timed: form.timed,
        timeLimitMinutes: form.timed && form.minutes ? Number(form.minutes) : null,
        opensAt: fromLocalInput(form.opensAt),
        dueAt: fromLocalInput(form.dueAt),
        maxAttempts: form.maxAttempts ? Number(form.maxAttempts) : null,
        evidencePolicy: form.evidencePolicy,
        reviewPolicy: form.reviewPolicy,
      })
      setForm((f) => ({ ...f, title: '' }))
      onCreated()
    } catch (err) {
      setError(errorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="v2-card" style={{ marginBottom: 16 }} onSubmit={submit}>
      <h2 className="v2-h1" style={{ fontSize: '1.05rem' }}>{t('assignCreateHeading')}</h2>
      <label className="v2-field"><span>{t('assignTitle')}</span><input value={form.title} onChange={set('title')} required maxLength={200} /></label>
      <div className="v2-pill-group" role="radiogroup" style={{ marginBottom: 14 }}>
        {['exam', 'set'].map((k) => (
          <button key={k} type="button" className={`v2-pill-option ${form.kind === k ? 'is-selected' : ''}`} onClick={() => setForm((f) => ({ ...f, kind: k, examId: k === 'exam' && f.examId === 'all' ? exams[0]?.id ?? '' : f.examId }))}>
            <span className="v2-pill-label">{t(`assignKind_${k}`)}</span>
          </button>
        ))}
      </div>
      <label className="v2-field"><span>{t('practiceExamLabel')}</span>
        <select value={form.examId} onChange={set('examId')}>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          {form.kind === 'set' && <option value="all">{t('practiceAllExams')}</option>}
        </select>
      </label>
      {form.kind === 'set' && (
        <div className="v2-control-row" style={{ marginBottom: 14 }}>
          <label className="v2-inline-field">{t('practiceCategoryLabel')}
            <select value={form.category} onChange={set('category')}>
              <option value="">{t('practiceAllCategories')}</option>
              {categories.map((c) => <option key={c.name} value={c.name}>{c.field} · {c.name}</option>)}
            </select>
          </label>
          <label className="v2-inline-field">{t('assignCount')}<input type="number" min="1" max="100" value={form.count} onChange={set('count')} style={{ width: 80 }} /></label>
        </div>
      )}
      <div className="v2-control-row" style={{ marginBottom: 14 }}>
        <label className="v2-inline-field"><input type="checkbox" checked={form.timed} onChange={set('timed')} /> {t('assignTimed')}</label>
        {form.timed && (
          <label className="v2-inline-field">{t('assignMinutes')}
            <input type="number" min="1" max="600" value={form.minutes} placeholder={form.kind === 'exam' && exam?.time_limit_minutes ? String(exam.time_limit_minutes) : ''} onChange={set('minutes')} style={{ width: 90 }} />
          </label>
        )}
      </div>
      <div className="v2-control-row" style={{ marginBottom: 14 }}>
        <label className="v2-inline-field">{t('assignOpensAt')}<input type="datetime-local" value={form.opensAt} onChange={set('opensAt')} /></label>
        <label className="v2-inline-field">{t('assignDueAt')}<input type="datetime-local" value={form.dueAt} onChange={set('dueAt')} /></label>
      </div>
      <div className="v2-control-row" style={{ marginBottom: 14 }}>
        <label className="v2-inline-field">{t('assignMaxAttempts')}<input type="number" min="1" max="100" value={form.maxAttempts} onChange={set('maxAttempts')} style={{ width: 80 }} /></label>
        <label className="v2-inline-field">{t('assignEvidence')}
          <select value={form.evidencePolicy} onChange={set('evidencePolicy')}>
            {['best', 'first', 'last', 'mean'].map((p) => <option key={p} value={p}>{t(`assignPolicy_${p}`)}</option>)}
          </select>
        </label>
        <label className="v2-inline-field">{t('assignReview')}
          <select value={form.reviewPolicy} onChange={set('reviewPolicy')}>
            {['after_due', 'after_submit'].map((p) => <option key={p} value={p}>{t(`assignReview_${p}`)}</option>)}
          </select>
        </label>
      </div>
      <p className="v2-field-hint">{t('assignLockNote')}</p>
      {error && <p className="v2-field-error">{error}</p>}
      <button type="submit" className="v2-btn v2-btn-primary" disabled={busy}>{t('assignCreate')}</button>
    </form>
  )
}

function StaffControls({ a, sectionId, onChanged }) {
  const { t } = useI18n()
  const [due, setDue] = useState(toLocalInput(a.dueAt))
  const [error, setError] = useState(null)
  async function run(task) {
    setError(null)
    try { await task(); onChanged() } catch (err) { setError(errorText(t, err)) }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <div className="v2-control-row">
        {a.status !== 'open' && <button type="button" className="v2-btn-sm v2-btn-outline" onClick={() => run(() => updateAssignment(a.id, { status: 'open' }))}>{t('assignOpen')}</button>}
        {a.status === 'open' && <button type="button" className="v2-btn-sm v2-btn-outline" onClick={() => run(() => updateAssignment(a.id, { status: 'closed' }))}>{t('assignClose')}</button>}
        <label className="v2-inline-field">{t('assignDueAt')}<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="button" className="v2-btn-sm v2-btn-outline" onClick={() => run(() => updateAssignment(a.id, { dueAt: fromLocalInput(due) }))}>{t('assignSaveDue')}</button>
        <Link to={`/v2/sections/${sectionId}/practice/assignments/${a.id}/results`} className="v2-btn-sm v2-btn-outline">{t('resultsOpen')}</Link>
        {a.progress?.started === 0 && <button type="button" className="v2-btn-sm v2-btn-danger" onClick={() => run(() => deleteAssignment(a.id))}>{t('remove')}</button>}
      </div>
      {error && <p className="v2-field-error">{error}</p>}
    </div>
  )
}

export default function PracticeAssignmentsPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [exams, setExams] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const result = await listAssignments(sectionId)
      setData(result)
      if (result.canManage) listExams(sectionId).then((r) => setExams(r.exams)).catch(() => setExams([]))
      setStatus('ok')
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error')
    }
  }, [sectionId])
  useEffect(() => { load() }, [load])

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  async function start(a) {
    setError(null)
    try {
      const result = await startAssignment(a.id, 'en')
      navigate(`/v2/sections/${sectionId}/practice/attempts/${result.attemptId}`)
    } catch (err) {
      setError(errorText(t, err))
    }
  }

  return (
    <div className="v2-content-narrow">
      <Link to={`/v2/sections/${sectionId}/practice`} className="v2-subtext">← {t('practiceBack')}</Link>
      <h1 className="v2-h1" style={{ margin: '8px 0 14px' }}>{t('assignTitlePage')}</h1>
      {data.canManage && exams.length > 0 && <CreateForm sectionId={sectionId} exams={exams} onCreated={load} />}
      {error && <div className="v2-notice v2-notice-error">{error}</div>}
      {data.assignments.length === 0 ? <p className="v2-subtext">{t('assignNone')}</p> : data.assignments.map((a) => {
        const s = statusOf(a, t)
        const last = a.myAttempts[a.myAttempts.length - 1]
        return (
          <div key={a.id} className="v2-card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <strong>{a.title}</strong>
              <span className={`v2-badge ${s.cls}`}>{s.text}</span>
            </div>
            <p className="v2-subtext" style={{ margin: '4px 0 8px' }}>
              {t(`assignKind_${a.kind}`)} · {t('assignQuestions', { n: a.questionCount })} · {a.timeLimitSeconds ? t('assignMinutesShort', { n: Math.round(a.timeLimitSeconds / 60) }) : t('examUntimed')}
              {a.dueAt ? ` · ${t('assignDueShort', { when: new Date(a.dueAt).toLocaleString() })}` : ''}
              {a.maxAttempts ? ` · ${t('assignAttemptsLeft', { left: a.attemptsLeft, max: a.maxAttempts })}` : ''}
            </p>
            {a.myAttempts.length > 0 && (
              <p className="v2-subtext" style={{ margin: '0 0 8px' }}>
                {t('assignMyScore', { score: pct(a.myScoreRatio), policy: t(`assignPolicy_${a.evidencePolicy}`) })}
              </p>
            )}
            {data.canManage && a.progress && <p className="v2-subtext" style={{ margin: '0 0 8px' }}>{t('assignProgress', { started: a.progress.started, submitted: a.progress.submitted })}</p>}
            <div className="v2-control-row">
              {a.myInProgressAttemptId
                ? <Link to={`/v2/sections/${sectionId}/practice/attempts/${a.myInProgressAttemptId}`} className="v2-btn v2-btn-primary">{t('assignResume')}</Link>
                : a.availableNow && (a.attemptsLeft === null || a.attemptsLeft > 0) && <button type="button" className="v2-btn v2-btn-primary" onClick={() => start(a)}>{a.myAttempts.length ? t('assignRetry') : t('assignStart')}</button>}
              {last && last.status === 'finished' && <Link to={`/v2/sections/${sectionId}/practice/attempts/${last.id}`} className="v2-btn v2-btn-secondary">{t('assignViewResult')}</Link>}
            </div>
            {data.canManage && <StaffControls a={a} sectionId={sectionId} onChanged={load} />}
          </div>
        )
      })}
    </div>
  )
}
